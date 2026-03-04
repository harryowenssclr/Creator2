/**
 * Self-hosted headless browser fetch for social media video extraction.
 * Uses Puppeteer with stealth to render JS-heavy pages and extract og:video
 * or video element src. No Apify or third-party APIs required.
 */

let browserInstance = null

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance
  const puppeteer = await import('puppeteer-extra')
  const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
  puppeteer.default.use(StealthPlugin())
  browserInstance = await puppeteer.default.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
    ],
  })
  return browserInstance
}

/** Extract video URLs from Instagram CDN patterns in text (HTML/JSON) */
function extractVideoUrlsFromText(text) {
  if (!text || typeof text !== 'string') return []
  const urls = []
  // cdninstagram.com, fbcdn.net, scontent.*.cdninstagram.com - direct MP4
  const patterns = [
    /https:\/\/[^"'\s]+cdninstagram\.com[^"'\s]*\.mp4[^"'\s]*/gi,
    /https:\/\/[^"'\s]+fbcdn\.net[^"'\s]*\.mp4[^"'\s]*/gi,
    /https:\/\/scontent[^"'\s]+\.mp4[^"'\s]*/gi,
    /"video_url"\s*:\s*"([^"]+\.mp4[^"]*)"/gi,
    /"video_url"\s*:\s*"([^"]+)"/gi,
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

async function runExtraction(page, url, capturedVideoUrls, capturedResponseUrls) {
  const result = await page.evaluate(() => {
    const ogVideo = document.querySelector('meta[property="og:video"]')?.getAttribute('content')
      || document.querySelector('meta[property="og:video:url"]')?.getAttribute('content')
      || document.querySelector('meta[property="og:video:secure_url"]')?.getAttribute('content')
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

  if (result?.mediaUrl) {
    if (result.mediaType === 'video') return result
    // If we got image, still check captured URLs for video
  }

  const allVideoUrls = [
    ...capturedResponseUrls,
    ...capturedVideoUrls,
  ].filter((u) => /\.mp4(\?|$)/i.test(u) || (u.includes('video') && (u.includes('cdninstagram') || u.includes('fbcdn'))))

  if (allVideoUrls.length > 0) {
    const best = allVideoUrls.find((u) => u.includes('cdninstagram') && u.includes('.mp4')) || allVideoUrls[0]
    return { mediaUrl: best, mediaType: 'video' }
  }

  if (result?.mediaUrl) return result

  return null
}

async function tryUrl(browser, url, capturedVideoUrls, capturedResponseUrls) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 })

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      try {
        const u = req.url()
        if (req.resourceType() === 'media' || /\.mp4(\?|$)/i.test(u) || (u.includes('video') && (u.includes('cdn') || u.includes('instagram') || u.includes('tiktok') || u.includes('fbcdn')))) {
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
        if (ct.includes('video/mp4') && u.startsWith('http')) {
          capturedResponseUrls.push(u)
        }
        // Parse GraphQL responses for video_url (Instagram embeds video URLs in JSON)
        if (ct.includes('json') && (u.includes('graphql') || u.includes('api/v1/media'))) {
          try {
            const text = await res.text()
            const found = extractVideoUrlsFromText(text)
            found.forEach((f) => capturedResponseUrls.push(f))
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

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
        const playBtn = document.querySelector('[aria-label="Play"]') || document.querySelector('[aria-label="Pause"]')?.closest('div')?.parentElement
        if (playBtn) playBtn.click()
      })
      await new Promise((r) => setTimeout(r, 5000))
    }

    let out = await runExtraction(page, url, capturedVideoUrls, capturedResponseUrls)
    if (out) return out

    // Fallback: scrape raw page source for video URLs (Instagram embeds in scripts)
    const html = await page.content()
    const fromHtml = extractVideoUrlsFromText(html)
    if (fromHtml.length > 0) {
      const best = fromHtml.find((u) => u.includes('.mp4')) || fromHtml[0]
      return { mediaUrl: best, mediaType: 'video' }
    }

    return null
  } finally {
    await page.close()
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

async function headlessFetch(url) {
  const trimmed = url.trim()

  try {
    const browser = await getBrowser()
    const capturedVideoUrls = []
    const capturedResponseUrls = []

    // Try main URL first (60s timeout for headless - avoid hanging)
    let result = await withTimeout(
      tryUrl(browser, trimmed, capturedVideoUrls, capturedResponseUrls),
      60000,
      'Headless fetch'
    )
    if (result) return result

    // For Instagram Reels: try embed URL (sometimes returns different/video-enabled content)
    if (trimmed.includes('instagram.com/reel/') || trimmed.includes('instagram.com/p/')) {
      const embedUrl = trimmed.replace(/\?.*$/, '').replace(/\/$/, '') + '/embed/'
      result = await withTimeout(
        tryUrl(browser, embedUrl, capturedVideoUrls, capturedResponseUrls),
        45000,
        'Headless embed fetch'
      )
    }

    return result
  } catch (err) {
    console.warn('headlessFetch error:', err.message)
    return null
  }
}

export { headlessFetch }
