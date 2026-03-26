import { useState, useCallback, useEffect, useMemo } from 'react'
import axios from 'axios'
import JSZip from 'jszip'
import {
  extractInstagramUrlFromPaste,
  ensureHttpUrl,
  stripInstagramPostQuery,
  mediaApiBase,
  axiosErrorMessage,
} from '../../lib/socialPostUrl'
import { buildCM360Html } from '../../services/cm360Export'

const BANNER_SIZES = [
  { w: 300, h: 600 },
  { w: 300, h: 250 },
]

export default function SocialGenerator() {
  const [postUrl, setPostUrl] = useState('')
  const [manualMediaUrl, setManualMediaUrl] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [loading, setLoading] = useState(false)
  const [headlessEnabled, setHeadlessEnabled] = useState<boolean | null>(null)
  const [apifyEnabled, setApifyEnabled] = useState(false)
  const [ytdlpAvailable, setYtdlpAvailable] = useState<boolean | null>(null)
  const [ytdlpHint, setYtdlpHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [exporting, setExporting] = useState(false)
  const [previewMediaError, setPreviewMediaError] = useState<string | null>(null)

  const effectiveMediaUrl =
    mediaUrl ??
    (manualMediaUrl.trim() ? ensureHttpUrl(manualMediaUrl) : null)

  /** For manual external URLs, build a proxy query string with referer. */
  const postUrlForReferer = useMemo(() => {
    const extracted = extractInstagramUrlFromPaste(postUrl)
    const u = ensureHttpUrl(extracted)
    return u ? stripInstagramPostQuery(u) : ''
  }, [postUrl])

  const proxyRefererQs = postUrlForReferer.startsWith('http')
    ? `&referer=${encodeURIComponent(postUrlForReferer)}`
    : ''

  useEffect(() => {
    axios.get('/api/social/config').then(({ data }) => {
      setHeadlessEnabled(data.headlessEnabled)
      setApifyEnabled(data.apifyEnabled ?? false)
      setYtdlpAvailable(data.ytdlpAvailable ?? null)
      const hint = data.ytdlpHint
      setYtdlpHint(typeof hint === 'string' && hint.trim() ? hint.trim() : null)
    }).catch(() => {
      setHeadlessEnabled(false)
      setYtdlpAvailable(false)
      setYtdlpHint(
        'Could not reach /api/social/config. Start the API on port 3001 (server npm run dev).',
      )
    })
  }, [])

  useEffect(() => {
    setPreviewMediaError(null)
  }, [effectiveMediaUrl])

  /**
   * Cached media comes back as /api/social/media/:id — already local.
   * Manual external URLs still need the proxy.
   */
  function mediaSrc(_asVideo: boolean): string {
    if (!effectiveMediaUrl) return ''
    if (effectiveMediaUrl.startsWith('/api/')) {
      const base = mediaApiBase()
      return base ? `${base}${effectiveMediaUrl}` : effectiveMediaUrl
    }
    if (!effectiveMediaUrl.startsWith('http')) return effectiveMediaUrl
    const typeQs = _asVideo ? '&type=video' : ''
    return `/api/social/proxy?url=${encodeURIComponent(effectiveMediaUrl)}${typeQs}${proxyRefererQs}`
  }

  const handleFetch = useCallback(async () => {
    const extracted = extractInstagramUrlFromPaste(postUrl)
    const normalized = ensureHttpUrl(extracted)
    if (!normalized) {
      setError('Please enter a post URL or Instagram embed snippet')
      return
    }
    const forApi = stripInstagramPostQuery(normalized)
    setLoading(true)
    setError(null)
    setMediaUrl(null)
    setMediaType('image')
    try {
      const { data } = await axios.post(
        '/api/social/fetch',
        { url: forApi },
        {
          timeout: 90000,
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (data.ok && data.mediaUrl) {
        setMediaUrl(data.mediaUrl)
        setMediaType(data.mediaType === 'video' ? 'video' : 'image')
      } else {
        setError(
          'Could not extract media. Try pasting the image/video URL manually below.',
        )
      }
    } catch (err: unknown) {
      setError(axiosErrorMessage(err, 'Failed to fetch post'))
    } finally {
      setLoading(false)
    }
  }, [postUrl])

  const handleExport = useCallback(async () => {
    const url = effectiveMediaUrl
    if (!url) {
      setError('No media to export. Fetch from URL or paste image/video URL.')
      return
    }
    setExporting(true)
    setError(null)
    try {
      const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('video')
      const base = mediaApiBase()
      const path = url.startsWith('/api/')
        ? url
        : `/api/social/proxy?url=${encodeURIComponent(url)}${isVideo ? '&type=video' : ''}${proxyRefererQs}`
      const fetchUrl = path.startsWith('http') ? path : (base ? `${base}${path}` : path)

      const response = await fetch(fetchUrl)
      if (!response.ok) {
        const raw = await response.text()
        let detail = `HTTP ${response.status}`
        try {
          const j = JSON.parse(raw) as { error?: string }
          if (j.error) detail = j.error
        } catch {
          if (raw.trim()) detail = raw.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)
        }
        throw new Error(detail || 'Failed to fetch media')
      }
      const blob = await response.blob()
      const blobIsVideo = blob.type?.startsWith('video/')
      const treatAsVideo = isVideo || blobIsVideo
      let ext = 'jpg'
      if (treatAsVideo) ext = 'mp4'
      else if (blob.type?.includes('png')) ext = 'png'
      else if (blob.type?.includes('gif')) ext = 'gif'
      const assetName = `media.${ext}`

      const totalSize = blob.size
      const maxSize = 10 * 1024 * 1024
      if (totalSize > maxSize) {
        throw new Error(
          `Media too large (${(totalSize / 1024 / 1024).toFixed(1)} MB). CM360 max is 10 MB.`,
        )
      }

      const zip = new JSZip()
      zip.file(assetName, blob)

      for (const size of BANNER_SIZES) {
        const bodyContent = treatAsVideo
          ? `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video></div>`
          : `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><img src="${assetName}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
        const html = buildCM360Html({
          width: size.w,
          height: size.h,
          clickUrl,
          bodyContent,
          extraStyles: 'cursor:pointer;',
          ...(treatAsVideo && { videoAssetName: assetName }),
        })
        zip.file(`banner-${size.w}x${size.h}.html`, html)
      }

      const indexHtml = buildCM360Html({
        width: 300,
        height: 600,
        clickUrl,
        bodyContent: treatAsVideo
          ? `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video></div>`
          : `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><img src="${assetName}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`,
        extraStyles: 'cursor:pointer;',
        ...(treatAsVideo && { videoAssetName: assetName }),
      })
      zip.file('index.html', indexHtml)

      const blobOut = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blobOut)
      link.download = 'social-banners.zip'
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [effectiveMediaUrl, clickUrl, postUrl, proxyRefererQs])

  const handleManualApply = useCallback(() => {
    const url = ensureHttpUrl(manualMediaUrl)
    if (url) {
      setMediaUrl(url)
      const looksLikeVideo =
        /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('/video/')
      setMediaType(looksLikeVideo ? 'video' : 'image')
      setError(null)
    }
  }, [manualMediaUrl])

  const isVideo =
    effectiveMediaUrl &&
    (mediaType === 'video' ||
      /\.(mp4|webm|mov)(\?|$)/i.test(effectiveMediaUrl) ||
      effectiveMediaUrl.includes('/video/') ||
      /cdninstagram\.com.*mp4|tiktokcdn.*video|fbcdn\.net.*mp4/i.test(effectiveMediaUrl))

  const reelPosterOnly = useMemo(
    () =>
      postUrlForReferer.includes('/reel/') &&
      Boolean(mediaUrl) &&
      mediaType === 'image',
    [postUrlForReferer, mediaUrl, mediaType],
  )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Social Generator</h1>
      <p className="text-slate-400">
        Paste your Instagram reel or post link (Share → Copy link). Tracking
        tails such as{' '}
        <code className="rounded bg-slate-800 px-1 text-slate-300">
          ?utm_source=ig_web_copy_link
        </code>{' '}
        are stripped automatically. Use Fetch Media, then Export to download a
        ZIP of HTML5 banner pages (300×600 and 300×250 with HTML5{' '}
        <code className="rounded bg-slate-800 px-1 text-slate-300">video</code>{' '}
        or <code className="rounded bg-slate-800 px-1 text-slate-300">img</code>
        ). TikTok and Facebook links work too. If extraction fails, paste a
        direct file URL below, or paste Instagram embed HTML instead of the link.
      </p>
      {(headlessEnabled || apifyEnabled || ytdlpAvailable) && (
        <p className="rounded bg-emerald-900/30 px-3 py-1.5 text-sm text-emerald-300">
          {headlessEnabled && 'Headless browser enabled. '}
          {apifyEnabled && 'Apify fallback for Instagram. '}
          {ytdlpAvailable && 'yt-dlp available (TikTok/Facebook/Instagram fallback). '}
        </p>
      )}
      {ytdlpAvailable === false && (
        <div className="space-y-2 rounded bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200">
          {ytdlpHint && <p className="font-medium text-amber-100">{ytdlpHint}</p>}
          <p>
            yt-dlp not detected — on Windows try{' '}
            <code className="text-amber-100">winget install yt-dlp.yt-dlp</code>, restart the API, or
            set <code className="text-amber-100">YT_DLP_PATH</code> in <code className="text-amber-100">server/.env</code>.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-sm text-slate-400">
            Post URL
          </label>
          <input
            type="text"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.instagram.com/reel/… (share link is OK)"
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={loading}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Fetching…' : 'Fetch Media'}
        </button>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <label className="mb-1 block text-sm text-slate-400">
          Or paste image/video URL (fallback)
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={manualMediaUrl}
            onChange={(e) => setManualMediaUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="flex-1 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
          />
          <button
            onClick={handleManualApply}
            className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
          >
            Use
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {effectiveMediaUrl && (
        <>
          {reelPosterOnly && (
            <p className="rounded bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
              This reel resolved to the poster image only (no MP4 in the browser
              session). For motion video: keep trying Fetch, configure{' '}
              <code className="text-amber-100">APIFY_TOKEN</code> on the server,
              or paste a direct .mp4 link in the fallback field.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-slate-400">Click URL:</label>
            <input
              type="url"
              value={clickUrl}
              onChange={(e) => setClickUrl(e.target.value)}
              className="w-56 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
            />
            <button
              onClick={handleExport}
              disabled={exporting}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export 300×600 & 300×250'}
            </button>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <p className="mb-1 text-sm text-slate-400">Banner preview</p>
            <p className="mb-3 text-xs text-slate-500">
              Same crop as export: HTML5 video or image scaled with
              object-fit:cover in 300×600 and 300×250.
            </p>
            {previewMediaError && (
              <p className="mb-3 rounded bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
                {previewMediaError}
              </p>
            )}
            <div className="flex flex-wrap gap-4">
                {BANNER_SIZES.map(({ w, h }) => (
                  <div
                    key={`${w}x${h}`}
                    className="overflow-hidden rounded border border-slate-600"
                    style={{ width: w, height: h }}
                  >
                    {isVideo ? (
                      <video
                        key={effectiveMediaUrl}
                        src={mediaSrc(true)}
                        muted
                        loop
                        playsInline
                        autoPlay
                        controls
                        preload="auto"
                        className="h-full w-full object-cover"
                        onError={() =>
                          setPreviewMediaError(
                            'Could not load video preview. Try fetching again or paste a direct .mp4 URL.',
                          )
                        }
                      />
                    ) : (
                      <img
                        key={effectiveMediaUrl}
                        src={mediaSrc(false)}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() =>
                          setPreviewMediaError(
                            'Could not load image preview. Try fetching again or paste a direct image URL.',
                          )
                        }
                      />
                    )}
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
