import { Router } from 'express'
import { randomUUID } from 'crypto'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { headlessFetch } from '../lib/headlessFetch.js'
import { apifyFetchInstagram } from '../lib/apifyFetch.js'

export const socialRouter = Router()

// ── In-memory media cache ──
// When /fetch discovers a media URL, it downloads the bytes immediately
// (while CDN tokens are still valid) and stores them here. The client
// uses /api/social/media/:id for both preview and export — no more
// expired-token failures.
const mediaCache = new Map()
const MAX_CACHE = 50
const MAX_BYTES = 50 * 1024 * 1024

function evictOldest() {
  if (mediaCache.size < MAX_CACHE) return
  const oldest = mediaCache.keys().next().value
  if (oldest) mediaCache.delete(oldest)
}

/** Cache raw bytes we already have (from headless browser session). */
function cacheBuffer(buf, contentType) {
  if (!buf || buf.length < 1000 || buf.length > MAX_BYTES) return null
  const id = randomUUID()
  evictOldest()
  mediaCache.set(id, { buf, contentType: (contentType || 'application/octet-stream').split(';')[0], createdAt: Date.now() })
  return id
}

/** Download and cache (fallback when we only have a URL, not bytes). */
async function cacheMediaByUrl(url, mediaType) {
  try {
    const { data, headers } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
    })
    const buf = Buffer.from(data)
    if (buf.length < 1000) {
      console.warn(`cacheMediaByUrl: response too small (${buf.length} bytes) — likely blocked`)
      return null
    }
    const ct = headers['content-type'] || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg')
    return cacheBuffer(buf, ct)
  } catch (err) {
    console.warn('cacheMediaByUrl failed:', err.message)
    return null
  }
}

socialRouter.get('/media/:id', (req, res) => {
  const entry = mediaCache.get(req.params.id)
  if (!entry) return res.status(404).json({ error: 'Media not found or expired' })
  res.set('Content-Type', entry.contentType)
  res.set('Content-Length', String(entry.buf.length))
  res.set('Cache-Control', 'public, max-age=3600')
  res.set('Accept-Ranges', 'bytes')

  const range = req.headers.range
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : entry.buf.length - 1
      res.status(206)
      res.set('Content-Range', `bytes ${start}-${end}/${entry.buf.length}`)
      res.set('Content-Length', String(end - start + 1))
      return res.send(entry.buf.subarray(start, end + 1))
    }
  }
  res.send(entry.buf)
})

/** Accept pasted URLs without scheme (browser input type="url" often requires https://). */
function normalizePostUrl(raw) {
  if (raw == null) return null
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  return `https://${s.replace(/^\/+/, '')}`
}

/** Share links include ?utm_source=ig_web_copy_link etc.; strip for stable fetch/embed. */
function stripInstagramPostQuery(url) {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('instagram.com')) return url
    if (!/\/(reel|p|tv)\//i.test(u.pathname)) return url
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

const USE_HEADLESS = process.env.USE_HEADLESS !== 'false'
const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim() || ''

function extractMediaFromHtml(html, pageUrl) {
  const $ = cheerio.load(html)
  let mediaUrl = null
  let mediaType = 'image'

  const ogVideo = $('meta[property="og:video"]').attr('content')
  const ogVideoUrl = $('meta[property="og:video:url"]').attr('content')
  const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content')
  const videoUrl = ogVideoSecure || ogVideoUrl || ogVideo
  if (videoUrl) {
    mediaUrl = videoUrl
    mediaType = 'video'
    return { mediaUrl, mediaType }
  }

  const ogImage = $('meta[property="og:image"]').attr('content')
  if (ogImage) {
    mediaUrl = ogImage
    mediaType = 'image'
    return { mediaUrl, mediaType }
  }

  const twitterImage = $('meta[name="twitter:image"]').attr('content')
  if (twitterImage) {
    mediaUrl = twitterImage
    mediaType = 'image'
    return { mediaUrl, mediaType }
  }

  return { mediaUrl: null, mediaType: 'image' }
}


async function tryOEmbed(url) {
  const oembedEndpoints = [
    {
      url: 'https://www.tiktok.com/oembed',
      matches: (u) => u.includes('tiktok.com'),
      getMedia: (data) => ({
        url: data.thumbnail_url || data.thumbnail,
        type: 'image',
      }),
    },
    {
      url: 'https://publish.twitter.com/oembed',
      matches: (u) => u.includes('twitter.com') || u.includes('x.com'),
      getMedia: (data) => ({
        url: data.thumbnail_url,
        type: 'image',
      }),
    },
  ]

  for (const ep of oembedEndpoints) {
    if (ep.matches && ep.matches(url) && ep.getMedia) {
      try {
        const fullUrl =
          ep.url.includes('?')
            ? `${ep.url}&url=${encodeURIComponent(url)}`
            : `${ep.url}?url=${encodeURIComponent(url)}`
        const { data } = await axios.get(fullUrl, {
          timeout: 10000,
          headers: { 'User-Agent': 'Creator-Banner-Editor/1.0' },
        })
        const result = ep.getMedia(data)
        if (result?.url) return result
      } catch {
        // try next
      }
    }
  }
  return null
}

async function fetchPageMeta(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: (s) => s >= 200 && s < 400,
    })
    return extractMediaFromHtml(html, url)
  } catch (err) {
    console.warn('Fetch meta error:', err.message)
    return { mediaUrl: null, mediaType: 'image' }
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

socialRouter.get('/proxy', async (req, res) => {
  try {
    const { url, referer } = req.query
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL required' })
    }
    const ref =
      typeof referer === 'string' && referer.startsWith('http') ? referer : undefined
    let origin
    if (ref) {
      try {
        origin = new URL(ref).origin
      } catch {
        /* invalid referer */
      }
    }
    const { data, headers } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        ...(ref && { Referer: ref, ...(origin && { Origin: origin }) }),
      },
      maxRedirects: 5,
    })
    const contentType =
      headers['content-type'] ||
      (req.query.type === 'video' ? 'video/mp4' : 'image/jpeg')
    res.set('Content-Type', contentType.split(';')[0])
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(Buffer.from(data))
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : null
    const hint =
      status === 403 || status === 401
        ? 'Host blocked this download (try opening the media URL in a browser, or paste a direct CDN link).'
        : status
          ? `Upstream returned ${status}.`
          : null
    const message =
      hint ||
      (axios.isAxiosError(err) ? err.message : err?.message) ||
      'Proxy fetch failed'
    res.status(502).json({ error: message })
  }
})

socialRouter.post('/fetch', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {}
    const rawUrl = body.url
    const trimmedRaw = normalizePostUrl(rawUrl)
    if (!trimmedRaw) {
      return res.status(400).json({ error: 'URL is required' })
    }
    const trimmed = stripInstagramPostQuery(trimmedRaw)

    let mediaUrl = null
    let mediaType = 'image'
    let source = 'none'

    // 1. Headless browser (Instagram, TikTok, Facebook) - renders JS, extracts og:video / video src
    let mediaBuffer = null
    let mediaContentType = null
    if (USE_HEADLESS && /instagram\.com|tiktok\.com|facebook\.com|fb\.com|fb\.watch/.test(trimmed)) {
      try {
        const headlessResult = await headlessFetch(trimmed)
        if (headlessResult?.mediaUrl) {
          mediaUrl = headlessResult.mediaUrl
          mediaType = headlessResult.mediaType
          source = 'headless'
          if (headlessResult.mediaBuffer) {
            mediaBuffer = headlessResult.mediaBuffer
            mediaContentType = headlessResult.contentType
          }
        }
      } catch (err) {
        console.warn('Headless fetch error:', err.message, err.stack)
      }
    }

    // 1b. Apify fallback for Instagram (when headless fails or returns thumbnail instead of video for Reels)
    const isInstagram = /instagram\.com/.test(trimmed)
    const isReel = trimmed.includes('/reel/')
    const gotThumbnailForReel = isReel && mediaType === 'image'
    if (APIFY_TOKEN && isInstagram && (!mediaUrl || gotThumbnailForReel)) {
      try {
        const apifyResult = await apifyFetchInstagram(trimmed)
        if (apifyResult?.mediaUrl) {
          mediaUrl = apifyResult.mediaUrl
          mediaType = apifyResult.mediaType
          source = 'apify'
        }
      } catch (err) {
        console.warn('Apify fetch error:', err.message)
      }
    }

    // 2. Simple HTTP scrape (og:video, og:image) - works for TikTok, some others
    if (!mediaUrl) {
      const pageResult = await fetchPageMeta(trimmed)
      if (pageResult.mediaUrl) {
        mediaUrl = pageResult.mediaUrl
        mediaType = pageResult.mediaType
        source = 'scrape'
      }
    }

    // 3. oEmbed fallback (thumbnails only)
    if (!mediaUrl) {
      const oembedResult = await tryOEmbed(trimmed)
      if (oembedResult?.url) {
        mediaUrl = oembedResult.url
        mediaType = oembedResult.type || 'image'
        source = 'oembed'
      }
    }

    let cachedId = null
    if (mediaBuffer) {
      cachedId = cacheBuffer(mediaBuffer, mediaContentType)
      if (cachedId) {
        console.log(`Cached ${(mediaBuffer.length / 1024).toFixed(0)} KB media ${cachedId} (${mediaType}) from ${source} — downloaded through browser session`)
      }
    }
    if (!cachedId && mediaUrl) {
      cachedId = await cacheMediaByUrl(mediaUrl, mediaType)
      if (cachedId) {
        console.log(`Cached media ${cachedId} (${mediaType}) from ${source} via direct download`)
      } else {
        console.warn(`Could not cache media from ${source}: ${mediaUrl.slice(0, 120)}`)
      }
    }

    res.json({
      ok: true,
      mediaUrl: cachedId ? `/api/social/media/${cachedId}` : (mediaUrl || null),
      mediaType: mediaType || 'image',
      source,
      cached: !!cachedId,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

socialRouter.get('/config', (req, res) => {
  res.json({
    headlessEnabled: USE_HEADLESS,
    apifyEnabled: !!APIFY_TOKEN,
  })
})
