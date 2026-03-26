/**
 * Headless social fetch: extract media URL, then download bytes using the
 * same browser session (cookies + Referer). Re-fetching CDN URLs with plain
 * axios fails; Instagram returns ~hundred-byte error bodies.
 */

import axios from 'axios'

let browserInstance = null

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance
  const puppeteer = await import('puppeteer-extra')
  const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
  puppeteer.default.use(StealthPlugin())
  const executablePath =
    (process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '').trim() || undefined
  browserInstance = await puppeteer.default.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
    ],
  })
  return browserInstance
}

function extractVideoUrlsFromText(text) {
  if (!text || typeof text !== 'string') return []
  const urls = []
  const patterns = [
    /https:\/\/[^"'\s]+cdninstagram\.com[^"'\s]*\.mp4[^"'\s]*/gi,
    /https:\/\/[^"'\s]+fbcdn\.net[^"'\s]*\.mp4[^"'\s]*/gi,
    /https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/gi,
    /"video_url"\s*:\s*"([^"]+\.mp4[^"]*)"/gi,
    /"video_url"\s*:\s*"([^"]+)"/gi,
    /"playable_url"\s*:\s*"([^"]+)"/gi,
    /"url"\s*:\s*"(https:[^"]*\.mp4[^"]*)"/gi,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const url = (m[1] || m[0]).replace(/\\u0026/g, '&').trim()
      if (url.startsWith('https') && (url.includes('.mp4') || url.includes('video'))) {
        urls.push(url)
      }
    }
  }
  return [...new Set(urls)]
}

function looksLikeMp4(buf) {
  return (
    buf &&
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  )
}

function looksLikeJpeg(buf) {
  return buf && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

/**
 * Download CDN media using cookies + UA from the open Puppeteer page.
 * This matches what “reel downloader” tools do server-side.
 */
async function downloadWithBrowserCookies(page, mediaUrl) {
  let cookieStr
  let ua
  let referer
  try {
    const cookies = await page.cookies()
    cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    ua = await page.evaluate(() => navigator.userAgent)
    referer = page.url()
  } catch (err) {
    console.warn('downloadWithBrowserCookies: could not read page session:', err.message)
    return null
  }

  const max = 45 * 1024 * 1024
  try {
    const { data, headers } = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 180000,
      maxContentLength: max,
      maxBodyLength: max,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        'User-Agent': ua,
        Cookie: cookieStr,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer:
          referer && referer.startsWith('http') ? referer : 'https://www.instagram.com/',
        Origin: 'https://www.instagram.com',
      },
    })
    const buf = Buffer.from(data)
    const ct = (headers['content-type'] || '').split(';')[0] || 'application/octet-stream'

    if (buf.length < 8000) {
      console.warn(`downloadWithBrowserCookies: body too small (${buf.length} b) — likely not media`)
      return null
    }
    const isVideo =
      /\.mp4(\?|$)/i.test(mediaUrl) || ct.includes('video') || mediaUrl.includes('.mp4')
    const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(mediaUrl) || ct.startsWith('image/')

    if (isVideo && !looksLikeMp4(buf)) {
      if (buf.length < 50_000) {
        console.warn('downloadWithBrowserCookies: not MP4 magic and body small — rejecting')
        return null
      }
      console.warn('downloadWithBrowserCookies: no ftyp magic; accepting large response as video')
    }
    if (isImage && !looksLikeJpeg(buf) && !ct.includes('png') && !ct.includes('webp')) {
      /* instagram sometimes uses odd types; keep if size ok */
      if (!ct.includes('image')) {
        console.warn('downloadWithBrowserCookies: image magic/type unclear, keeping anyway')
      }
    }

    return { buffer: buf, contentType: isVideo ? ct || 'video/mp4' : ct || 'image/jpeg' }
  } catch (err) {
    console.warn('downloadWithBrowserCookies:', err.message)
    return null
  }
}

/** Last resort: fetch inside page (slow for large files; base64 over CDP). */
async function downloadThroughPageEvaluate(page, url) {
  try {
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' })
        if (!res.ok) return null
        const blob = await res.blob()
        if (blob.size < 8000) return null
        const reader = new FileReader()
        return new Promise((resolve) => {
          reader.onloadend = () =>
            resolve({
              base64: reader.result.split(',')[1],
              type: blob.type,
              size: blob.size,
            })
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    }, url)
    if (!result?.base64) return null
    return {
      buffer: Buffer.from(result.base64, 'base64'),
      contentType: result.type || 'video/mp4',
    }
  } catch (err) {
    console.warn('downloadThroughPageEvaluate:', err.message)
    return null
  }
}

async function attachMediaBytes(page, out) {
  if (!out?.mediaUrl || out.mediaBuffer) return out
  let dl = await downloadWithBrowserCookies(page, out.mediaUrl)
  if (!dl) dl = await downloadThroughPageEvaluate(page, out.mediaUrl)
  if (dl) return { ...out, mediaBuffer: dl.buffer, contentType: dl.contentType }
  return out
}

async function runExtraction(page, pageNavUrl, capturedVideoUrls, capturedResponseUrls, capturedBuffers) {
  const isIgReel = /instagram\.com\/reel\//i.test(pageNavUrl)

  const result = await page.evaluate(() => {
    const ogVideo =
      document.querySelector('meta[property="og:video"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:video:url"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:video:secure_url"]')?.getAttribute('content')
    if (ogVideo) return { mediaUrl: ogVideo, mediaType: 'video' }

    const video = document.querySelector('video')
    if (video) {
      const src = video.src || video.querySelector('source')?.src
      if (src && !src.startsWith('blob:')) return { mediaUrl: src, mediaType: 'video' }
    }

    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
    if (ogImage) return { mediaUrl: ogImage, mediaType: 'image' }

    const img = document.querySelector('img[src*="cdn"], img[src*="fbcdn"], img[src*="tiktokcdn"]')
    if (img?.src) return { mediaUrl: img.src, mediaType: 'image' }

    return null
  })

  if (result?.mediaUrl && result.mediaType === 'video') {
    const buf = capturedBuffers.get(result.mediaUrl)
    if (buf) return { ...result, mediaBuffer: buf.buffer, contentType: buf.contentType }
  }

  const allVideoUrls = [...new Set([...capturedResponseUrls, ...capturedVideoUrls])].filter(
    (u) =>
      /\.mp4(\?|$)/i.test(u) ||
      (
        (u.includes('cdninstagram') || u.includes('fbcdn')) &&
        (u.includes('video') || u.includes('.mp4') || /\/v\/t\d+\.\d+/.test(u))
      ),
  )

  if (allVideoUrls.length > 0) {
    const best =
      allVideoUrls.find((u) => u.includes('cdninstagram') && /\.mp4(\?|$)/i.test(u)) || allVideoUrls[0]
    const buf = capturedBuffers.get(best)
    if (buf) {
      return { mediaUrl: best, mediaType: 'video', mediaBuffer: buf.buffer, contentType: buf.contentType }
    }
    return { mediaUrl: best, mediaType: 'video' }
  }

  // Reels: never settle for og:image / poster only — wait for network video or return null
  if (isIgReel && result?.mediaType === 'image') return null

  if (result?.mediaUrl) return result

  return null
}

async function tryUrl(browser, url) {
  const capturedVideoUrls = []
  const capturedResponseUrls = []
  const capturedBuffers = new Map()
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 })

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      try {
        const u = req.url()
        if (
          req.resourceType() === 'media' ||
          /\.mp4(\?|$)/i.test(u) ||
          (u.includes('video') &&
            (u.includes('cdn') || u.includes('instagram') || u.includes('tiktok') || u.includes('fbcdn')))
        ) {
          capturedVideoUrls.push(u)
        }
        req.continue()
      } catch {
        req.continue()
      }
    })

    page.on('response', async (res) => {
      try {
        const u = res.url()
        const ct = (res.headers()['content-type'] || '').toLowerCase()
        const igCdn =
          u.includes('cdninstagram.com') || u.includes('fbcdn.net') || u.startsWith('https://scontent')
        if (
          u.startsWith('http') &&
          (ct.includes('video/') || (ct.includes('octet-stream') && igCdn && /\.mp4(\?|$)/i.test(u)))
        ) {
          capturedResponseUrls.push(u)
          try {
            const buf = await res.buffer()
            const minVid = 25_000
            if (buf.length >= minVid && (looksLikeMp4(buf) || ct.includes('video'))) {
              capturedBuffers.set(u, { buffer: buf, contentType: (ct || 'video/mp4').split(';')[0] })
            }
          } catch {
            /* streamed / no buffer */
          }
        }
        if (
          ct.includes('json') &&
          (u.includes('graphql') || u.includes('api/v1/media') || u.includes('/query'))
        ) {
          try {
            const text = await res.text()
            const found = extractVideoUrlsFromText(text)
            found.forEach((f) => capturedResponseUrls.push(f))
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 3000))

    if (url.includes('instagram.com')) {
      await page.evaluate(() => window.scrollTo(0, 400))
      await new Promise((r) => setTimeout(r, 2000))
      await page.evaluate(() => {
        const video = document.querySelector('video')
        if (video) {
          video.muted = true
          video.play().catch(() => {})
        }
        const playBtn =
          document.querySelector('[aria-label="Play"]') ||
          document.querySelector('[aria-label="Pause"]')?.closest('div')?.parentElement
        if (playBtn) playBtn.click()
      })
      await new Promise((r) => setTimeout(r, 5000))
    }

    const isIgReel = /instagram\.com\/reel\//i.test(url)

    let out = await runExtraction(page, url, capturedVideoUrls, capturedResponseUrls, capturedBuffers)
    out = await attachMediaBytes(page, out)
    if (out?.mediaBuffer) {
      if (!(isIgReel && out.mediaType === 'image')) return out
      console.warn('Instagram reel: got poster image only on this URL — skipping')
      out = null
    }

    const html = await page.content()
    const fromHtml = extractVideoUrlsFromText(html)
    if (fromHtml.length > 0) {
      const best = fromHtml.find((u) => u.includes('.mp4')) || fromHtml[0]
      let vidOut = { mediaUrl: best, mediaType: 'video' }
      vidOut = await attachMediaBytes(page, vidOut)
      if (vidOut.mediaBuffer) return vidOut
      if (!isIgReel) return { mediaUrl: best, mediaType: 'video' }
    }

    const imgResult = await page.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      return og || null
    })
    if (imgResult && !isIgReel) {
      let imgOut = { mediaUrl: imgResult, mediaType: 'image' }
      imgOut = await attachMediaBytes(page, imgOut)
      if (imgOut.mediaBuffer) return imgOut
    }

    if (out?.mediaType === 'image' && out.mediaUrl && !isIgReel) return out
    return null
  } finally {
    await page.close()
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

async function headlessFetch(url) {
  const trimmed = url.trim()
  const isIgReel = /instagram\.com\/reel\//i.test(trimmed)
  try {
    const browser = await getBrowser()

    // Embed page often exposes the real MP4 player before the main reel page does.
    if (isIgReel) {
      const embedUrl = trimmed.replace(/\?.*$/, '').replace(/\/$/, '') + '/embed/'
      let result = await withTimeout(tryUrl(browser, embedUrl), 90000, 'Headless embed (reel first)')
      if (result?.mediaBuffer && result.mediaType === 'video') return result
    }

    let result = await withTimeout(tryUrl(browser, trimmed), 90000, 'Headless fetch')
    if (result?.mediaBuffer && result.mediaType === 'video') return result
    if (result && !isIgReel) return result

    if (trimmed.includes('instagram.com/p/')) {
      const embedUrl = trimmed.replace(/\?.*$/, '').replace(/\/$/, '') + '/embed/'
      result = await withTimeout(tryUrl(browser, embedUrl), 60000, 'Headless embed (post)')
    }

    return result
  } catch (err) {
    console.warn('headlessFetch error:', err.message)
    return null
  }
}

export { headlessFetch }
