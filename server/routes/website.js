import { Router } from 'express'
import axios from 'axios'
import * as cheerio from 'cheerio'

export const websiteRouter = Router()

function resolveUrl(baseUrl, href) {
  if (!href || href.startsWith('data:')) return null
  try {
    return new URL(href, baseUrl).href
  } catch {
    return null
  }
}

function getOrigin(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function isSameOriginOrSubdomain(baseOrigin, targetUrl) {
  try {
    const target = new URL(targetUrl)
    const targetOrigin = target.origin
    if (targetOrigin === baseOrigin) return true
    const baseHost = new URL(baseOrigin).hostname
    const targetHost = target.hostname
    return targetHost.endsWith('.' + baseHost) || targetHost === baseHost
  } catch {
    return false
  }
}

async function scrapePage(url, baseOrigin, assets, visited) {
  if (visited.has(url)) return
  visited.add(url)
  try {
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Creator-Banner-Editor/1.0' },
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 400,
    })
    const $ = cheerio.load(html)
    const pageOrigin = getOrigin(url)

    $('img[src]').each((_, el) => {
      const src = $(el).attr('src')
      const resolved = resolveUrl(url, src)
      if (resolved && isSameOriginOrSubdomain(baseOrigin, resolved)) {
        assets.push({ type: 'image', url: resolved })
      }
    })

    $('video source[src]').each((_, el) => {
      const src = $(el).attr('src')
      const resolved = resolveUrl(url, src)
      if (resolved) assets.push({ type: 'video', url: resolved })
    })

    $('video[src]').each((_, el) => {
      const src = $(el).attr('src')
      const resolved = resolveUrl(url, src)
      if (resolved) assets.push({ type: 'video', url: resolved })
    })

    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href')
      const resolved = resolveUrl(url, href)
      if (resolved) assets.push({ type: 'stylesheet', url: resolved })
    })

    $('link[rel="preload"][as="font"]').each((_, el) => {
      const href = $(el).attr('href')
      const resolved = resolveUrl(url, href)
      if (resolved) assets.push({ type: 'font', url: resolved })
    })
  } catch (err) {
    console.warn('Scrape error for', url, err.message)
  }
}

websiteRouter.post('/scrape', async (req, res) => {
  try {
    const { url, includeSubdomains = false } = req.body
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' })
    }
    let targetUrl = url
    if (!url.startsWith('http')) targetUrl = 'https://' + url
    const baseOrigin = getOrigin(targetUrl)
    const assets = []
    const visited = new Set()

    await scrapePage(targetUrl, baseOrigin, assets, visited)

    const seen = new Set()
    const uniqueAssets = assets.filter((a) => {
      const key = a.url
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    res.json({ ok: true, assets: uniqueAssets })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
