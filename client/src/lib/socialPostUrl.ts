import axios from 'axios'

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** Normal reel/post URL or Instagram embed snippet (blockquote). */
export function extractInstagramUrlFromPaste(input: string): string {
  const t = input.trim()
  if (!t) return ''
  const permalinkAttr = t.match(/data-instgrm-permalink="([^"]+)"/i)
  if (permalinkAttr?.[1]) {
    return decodeBasicHtmlEntities(permalinkAttr[1].trim())
  }
  const anyIg = t.match(
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[A-Za-z0-9_-]+[^\s"'<>]*/i,
  )
  if (anyIg?.[0]) return decodeBasicHtmlEntities(anyIg[0].trim())
  return t
}

export function ensureHttpUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('//')) return `https:${s}`
  return `https://${s.replace(/^\/+/, '')}`
}

export function stripInstagramPostQuery(url: string): string {
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

/**
 * Origin of the Express API (Social routes, proxy, media cache).
 * - Local dev: same host as the page, port 3001 (avoids Vite proxy issues for video bytes).
 * - Production (Firebase, etc.): set `VITE_API_BASE_URL` when building (e.g. https://your-api.run.app).
 */
export function socialApiOrigin(): string {
  const fromEnv =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') ?? ''
  if (fromEnv) return fromEnv
  if (typeof window === 'undefined') return ''
  if (import.meta.env.DEV) {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001`
  }
  return ''
}

/** `/api/...` path → absolute URL when an API origin is configured. */
export function socialApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const origin = socialApiOrigin()
  return origin ? `${origin}${p}` : p
}

/**
 * Preview / download URL: cached `/api/social/media/...` or proxy URL for external CDN links.
 */
export function socialMediaSrc(opts: {
  mediaUrl: string | null
  asVideo: boolean
  proxyRefererQs: string
}): string {
  const { mediaUrl, asVideo, proxyRefererQs } = opts
  if (!mediaUrl) return ''
  const origin = socialApiOrigin()
  if (mediaUrl.startsWith('/api/')) {
    return origin ? `${origin}${mediaUrl}` : mediaUrl
  }
  if (!mediaUrl.startsWith('http')) return mediaUrl
  const typeQs = asVideo ? '&type=video' : ''
  const path = `/api/social/proxy?url=${encodeURIComponent(mediaUrl)}${typeQs}${proxyRefererQs}`
  return origin ? `${origin}${path}` : path
}

/** @deprecated Use {@link socialApiOrigin} */
export function mediaApiBase(): string {
  return socialApiOrigin()
}

export function axiosErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback
  const d = err.response?.data
  if (d && typeof d === 'object' && 'error' in d) {
    const e = (d as { error?: unknown }).error
    if (typeof e === 'string' && e.trim()) return e.trim()
  }
  if (typeof d === 'string' && d.trim()) {
    const text = d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 400)
  }
  return err.message || fallback
}
