import { Router } from 'express'
import axios from 'axios'
import * as cheerio from 'cheerio'

export const socialRouter = Router()

function extractMediaFromHtml(html, pageUrl) {
  const $ = cheerio.load(html)
  let mediaUrl = null
  let mediaType = 'image'

  // Prefer VIDEO first (og:video) so we get actual video for Reels/TikTok etc.
  const ogVideo = $('meta[property="og:video"]').attr('content')
  const ogVideoUrl = $('meta[property="og:video:url"]').attr('content')
  const ogVideoSecure = $('meta[property="og:video:secure_url"]').attr('content')
  const videoUrl = ogVideoSecure || ogVideoUrl || ogVideo
  if (videoUrl) {
    mediaUrl = videoUrl
    mediaType = 'video'
    return { mediaUrl, mediaType }
  }

  // Fall back to image
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
  // oEmbed typically returns thumbnails only. For video posts, scraping the page
  // (og:video) gives the actual video. We try oEmbed first for speed, but prefer
  // page scrape when it yields video. Caller will use fetchPageMeta as fallback.
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

socialRouter.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL required')
    }
    const { data, headers } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Creator-Banner-Editor/1.0' },
      maxRedirects: 5,
    })
    const contentType =
      headers['content-type'] ||
      (req.query.type === 'video' ? 'video/mp4' : 'image/jpeg')
    res.set('Content-Type', contentType.split(';')[0])
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(Buffer.from(data))
  } catch (err) {
    res.status(500).send(err.message)
  }
})

socialRouter.post('/fetch', async (req, res) => {
  try {
    const { url } = req.body
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' })
    }
    const trimmed = url.trim()
    if (!trimmed.startsWith('http')) {
      return res.status(400).json({ error: 'URL must start with http' })
    }

    // Always scrape page first for video posts - og:video gives actual video URL.
    // oEmbed only returns thumbnails. Scraping yields video when available.
    const pageResult = await fetchPageMeta(trimmed)
    let mediaUrl = pageResult.mediaUrl
    let mediaType = pageResult.mediaType

    // Fallback to oEmbed only if page scrape failed (e.g. JS-heavy page)
    if (!mediaUrl) {
      const oembedResult = await tryOEmbed(trimmed)
      if (oembedResult?.url) {
        mediaUrl = oembedResult.url
        mediaType = oembedResult.type || 'image'
      }
    }

    res.json({
      ok: true,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || 'image',
      source: mediaUrl ? 'fetched' : 'none',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
