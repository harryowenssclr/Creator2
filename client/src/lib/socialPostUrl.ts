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

/** Dev: binary media from API — Vite proxy can break Range/streaming for video. */
export function mediaApiBase(): string {
  if (typeof window === 'undefined') return ''
  if (!import.meta.env.DEV) return ''
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:3001`
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
