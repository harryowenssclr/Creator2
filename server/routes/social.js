import { Router } from 'express'
import { randomUUID } from 'crypto'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { spawn } from 'child_process'
import { headlessFetch } from '../lib/headlessFetch.js'
import { apifyFetchInstagram } from '../lib/apifyFetch.js'
import { ytDlpFetch, isYtdlpSupportedUrl } from '../lib/ytDlpFetch.js'

export const socialRouter = Router()

// ── In-memory media cache ──
const mediaCache = new Map()
const MAX_CACHE = 50
const MAX_BYTES = 50 * 1024 * 1024

const USE_HEADLESS = process.env.USE_HEADLESS !== 'false'
const APIFY_TOKEN = process.env.APIFY_TOKEN?.trim() || ''
/** If not 'false', include structured debug in POST /fetch responses (avoid in public prod). */
const SOCIAL_FETCH_DEBUG =
  process.env.SOCIAL_FETCH_DEBUG === '1' || process.env.SOCIAL_FETCH_DEBUG === 'true'

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
  mediaCache.set(id, {
    buf,
    contentType: (contentType || 'application/octet-stream').split(';')[0],
    createdAt: Date.now(),
  })
  return id
}

function bytesMagicHint(buf) {
  if (!buf || buf.length < 4) return 'empty'
  return buf.subarray(0, Math.min(8, buf.length)).toString('hex')
}

/**
 * Download and cache (fallback when we only have a URL, not bytes).
 * @returns {Promise<{ id: string|null, detail: object }>}
 */
async function cacheMediaByUrl(url, mediaType) {
  const detail = {
    op: 'cacheMediaByUrl',
    urlHost: (() => {
      try {
        return new URL(url).hostname
      } catch {
        return 'invalid'
      }
    })(),
  }
  const igCdn = typeof url === 'string' && (url.includes('cdninstagram') || url.includes('fbcdn.net'))
  try {
    const { data, headers, status } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        ...(igCdn && {
          Referer: 'https://www.instagram.com/',
          Origin: 'https://www.instagram.com',
        }),
      },
    })
    detail.httpStatus = status
    const buf = Buffer.from(data)
    detail.bodyLength = buf.length
    detail.magicHex = bytesMagicHint(buf)
    if (status < 200 || status >= 400) {
      detail.error = `HTTP ${status}`
      console.warn(
        `[social] cacheMediaByUrl ${detail.urlHost} HTTP ${status} len=${buf.length} magic=${detail.magicHex}`,
      )
      return { id: null, detail }
    }
    if (buf.length < 1000) {
      detail.error = `body too small (${buf.length})`
      console.warn(`[social] cacheMediaByUrl blocked/small body:`, detail)
      return { id: null, detail }
    }
    const ct = headers['content-type'] || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg')
    const id = cacheBuffer(buf, ct)
    detail.cached = !!id
    if (id) {
      console.log(
        `[social] cacheMediaByUrl OK ${detail.urlHost} ${(buf.length / 1024).toFixed(0)} KB magic=${detail.magicHex}`,
      )
    }
    return { id, detail }
  } catch (err) {
    detail.error = err.message
    if (axios.isAxiosError(err)) {
      detail.httpStatus = err.response?.status
      const d = err.response?.data
      if (d && typeof d.length === 'number') detail.bodyLength = d.length
    }
    console.warn(`[social] cacheMediaByUrl failed:`, detail)
    return { id: null, detail }
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

function normalizePostUrl(raw) {
  if (raw == null) return null
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  return `https://${s.replace(/^\/+/, '')}`
}

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

/** Best-effort: is yt-dlp executable working? (cached promise) */
let ytdlpCheckPromise = null
function getYtdlpBinaryAvailable() {
  if (!ytdlpCheckPromise) {
    const bin = (process.env.YT_DLP_PATH || 'yt-dlp').trim()
    ytdlpCheckPromise = new Promise((resolve) => {
      const r = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      r.on('error', () => resolve(false))
      r.on('close', (code) => resolve(code === 0))
    })
  }
  return ytdlpCheckPromise
}

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

function logFetchEvent(obj) {
  console.log(`[social/fetch] ${JSON.stringify({ ...obj, t: new Date().toISOString() })}`)
}

socialRouter.post('/fetch', async (req, res) => {
  const debugSteps = SOCIAL_FETCH_DEBUG ? [] : null
  const pushDebug = (step) => {
    logFetchEvent(step)
    if (debugSteps) debugSteps.push(step)
  }

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
    let mediaBuffer = null
    let mediaContentType = null
    let hadHeadlessSessionBuffer = false

    if (USE_HEADLESS && /instagram\.com|tiktok\.com|facebook\.com|fb\.com|fb\.watch/.test(trimmed)) {
      try {
        const headlessResult = await headlessFetch(trimmed)
        pushDebug({
          phase: 'headless',
          hasMediaUrl: !!headlessResult?.mediaUrl,
          hasBuffer: !!headlessResult?.mediaBuffer,
          bufferLength: headlessResult?.mediaBuffer?.length ?? 0,
          mediaType: headlessResult?.mediaType,
        })
        if (headlessResult?.mediaUrl) {
          mediaUrl = headlessResult.mediaUrl
          mediaType = headlessResult.mediaType
          source = 'headless'
          if (headlessResult.mediaBuffer) {
            mediaBuffer = headlessResult.mediaBuffer
            mediaContentType = headlessResult.contentType
            hadHeadlessSessionBuffer = true
          }
        }
      } catch (err) {
        console.warn('Headless fetch error:', err.message, err.stack)
        pushDebug({ phase: 'headless', error: err.message })
      }
    }

    const isInstagram = /instagram\.com/.test(trimmed)
    const isReel = trimmed.includes('/reel/')
    const gotThumbnailForReel = isReel && mediaType === 'image'
    if (APIFY_TOKEN && isInstagram && (!mediaUrl || gotThumbnailForReel)) {
      try {
        const apifyResult = await apifyFetchInstagram(trimmed)
        pushDebug({
          phase: 'apify',
          hasMediaUrl: !!apifyResult?.mediaUrl,
          mediaType: apifyResult?.mediaType,
        })
        if (apifyResult?.mediaUrl) {
          mediaUrl = apifyResult.mediaUrl
          mediaType = apifyResult.mediaType
          source = 'apify'
          mediaBuffer = null
          mediaContentType = null
        }
      } catch (err) {
        console.warn('Apify fetch error:', err.message)
        pushDebug({ phase: 'apify', error: err.message })
      }
    }

    let cachedId = null
    if (mediaBuffer) {
      cachedId = cacheBuffer(mediaBuffer, mediaContentType)
      if (cachedId) {
        console.log(
          `[social] Cached ${(mediaBuffer.length / 1024).toFixed(0)} KB media ${cachedId} (${mediaType}) from ${source} — session download`,
        )
        pushDebug({
          phase: 'cacheBuffer',
          source,
          cachedId,
          bytes: mediaBuffer.length,
        })
      } else {
        pushDebug({
          phase: 'cacheBuffer',
          skipped: true,
          reason: 'buffer too small or over limit',
          bytes: mediaBuffer?.length,
        })
      }
    }

    async function tryCacheDiscoveredUrl(label) {
      if (cachedId || !mediaUrl) return
      const { id, detail } = await cacheMediaByUrl(mediaUrl, mediaType)
      pushDebug({ phase: 'cacheMediaByUrl', after: label, ...detail })
      if (id) {
        cachedId = id
        console.log(`Cached media ${cachedId} (${mediaType}) from ${source} via direct download`)
      } else {
        console.warn(`Could not cache media from ${source}: ${mediaUrl.slice(0, 120)}`)
      }
    }

    await tryCacheDiscoveredUrl('after-headless-apify')

    const isTikTok = /tiktok\.com/i.test(trimmed)

    if (!mediaUrl && !cachedId) {
      const pageResult = await fetchPageMeta(trimmed)
      pushDebug({
        phase: 'scrape',
        hasMediaUrl: !!pageResult?.mediaUrl,
        mediaType: pageResult?.mediaType,
      })
      if (pageResult.mediaUrl) {
        mediaUrl = pageResult.mediaUrl
        mediaType = pageResult.mediaType
        source = 'scrape'
      }
    }

    if (!mediaUrl && !cachedId) {
      const oembedResult = await tryOEmbed(trimmed)
      pushDebug({
        phase: 'oembed',
        hasUrl: !!oembedResult?.url,
        type: oembedResult?.type,
      })
      if (oembedResult?.url) {
        mediaUrl = oembedResult.url
        mediaType = oembedResult.type || 'image'
        source = 'oembed'
      }
    }

    await tryCacheDiscoveredUrl('after-scrape-oembed')

    async function runYtDlp(reason) {
      if (cachedId || !isYtdlpSupportedUrl(trimmed)) return
      pushDebug({ phase: 'yt-dlp', reason, start: true })
      const r = await ytDlpFetch(trimmed)
      pushDebug({
        phase: 'yt-dlp',
        reason,
        ok: r.ok,
        bytes: r.buffer?.length,
        error: r.error,
        stderrTail: r.stderrTail,
      })
      if (r.ok && r.buffer) {
        const id = cacheBuffer(r.buffer, r.contentType)
        if (id) {
          cachedId = id
          source = 'ytdlp'
          mediaType = r.mediaType || 'video'
          mediaUrl = null
          console.log(
            `[social] yt-dlp cached ${(r.buffer.length / 1024).toFixed(0)} KB (${mediaType}) ${id}`,
          )
        }
      }
    }

    await runYtDlp('after-direct-cache-failed-or-no-url')

    if (cachedId && isTikTok && mediaType === 'image' && isYtdlpSupportedUrl(trimmed)) {
      const prevId = cachedId
      pushDebug({ phase: 'yt-dlp-tiktok-upgrade', prevCachedId: prevId, note: 'thumb to video attempt' })
      cachedId = null
      const r = await ytDlpFetch(trimmed)
      pushDebug({
        phase: 'yt-dlp-tiktok-upgrade',
        ok: r.ok,
        bytes: r.buffer?.length,
        mediaType: r.mediaType,
        error: r.error,
      })
      if (r.ok && r.buffer && r.mediaType === 'video') {
        const id = cacheBuffer(r.buffer, r.contentType)
        if (id) {
          cachedId = id
          source = 'ytdlp'
          mediaType = 'video'
          mediaUrl = null
        } else {
          cachedId = prevId
        }
      } else {
        cachedId = prevId
      }
    }

    const payload = {
      ok: true,
      mediaUrl: cachedId ? `/api/social/media/${cachedId}` : mediaUrl || null,
      mediaType: mediaType || 'image',
      source,
      cached: !!cachedId,
    }
    if (SOCIAL_FETCH_DEBUG) {
      payload.debug = {
        steps: debugSteps,
        trimmedHost: (() => {
          try {
            return new URL(trimmed).hostname
          } catch {
            return null
          }
        })(),
        hadHeadlessSessionBuffer,
      }
    }
    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

socialRouter.get('/config', async (req, res) => {
  const ytdlpPathCustom = !!((process.env.YT_DLP_PATH || '').trim())
  const ytdlpAvailable = await getYtdlpBinaryAvailable()
  res.json({
    headlessEnabled: USE_HEADLESS,
    apifyEnabled: !!APIFY_TOKEN,
    ytdlpPathCustom,
    ytdlpCookiesConfigured: !!((process.env.YT_DLP_COOKIES || '').trim()),
    ytdlpAvailable,
    fetchDebugEnabled: SOCIAL_FETCH_DEBUG,
  })
})

