import { useState, useCallback, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  extractInstagramUrlFromPaste,
  ensureHttpUrl,
  stripInstagramPostQuery,
  socialApiOrigin,
  socialApiUrl,
  socialMediaSrc,
  axiosErrorMessage,
} from '../../lib/socialPostUrl'

export default function SocialPostExtractor() {
  const [postUrl, setPostUrl] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [fetchSource, setFetchSource] = useState<string | null>(null)
  const [fetchCached, setFetchCached] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [headlessEnabled, setHeadlessEnabled] = useState<boolean | null>(null)
  const [apifyEnabled, setApifyEnabled] = useState(false)
  const [ytdlpAvailable, setYtdlpAvailable] = useState<boolean | null>(null)
  const [ytdlpHint, setYtdlpHint] = useState<string | null>(null)
  const [ffmpegHint, setFfmpegHint] = useState<string | null>(null)
  /** Set when /api/social/config cannot be reached (do not confuse with yt-dlp missing). */
  const [apiConnectionError, setApiConnectionError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewMediaError, setPreviewMediaError] = useState<string | null>(null)

  const postUrlForReferer = useMemo(() => {
    const extracted = extractInstagramUrlFromPaste(postUrl)
    const u = ensureHttpUrl(extracted)
    return u ? stripInstagramPostQuery(u) : ''
  }, [postUrl])

  const proxyRefererQs = postUrlForReferer.startsWith('http')
    ? `&referer=${encodeURIComponent(postUrlForReferer)}`
    : ''

  useEffect(() => {
    axios
      .get(socialApiUrl('/api/social/config'))
      .then(({ data }) => {
        setApiConnectionError(null)
        setHeadlessEnabled(data.headlessEnabled)
        setApifyEnabled(data.apifyEnabled ?? false)
        setYtdlpAvailable(data.ytdlpAvailable ?? null)
        const hint = data.ytdlpHint
        setYtdlpHint(typeof hint === 'string' && hint.trim() ? hint.trim() : null)
        const fh = data.ffmpegHint
        setFfmpegHint(typeof fh === 'string' && fh.trim() ? fh.trim() : null)
      })
      .catch(() => {
        setHeadlessEnabled(null)
        setApifyEnabled(false)
        setYtdlpAvailable(null)
        setYtdlpHint(null)
        setFfmpegHint(null)
        setApiConnectionError(
          import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL
            ? 'Could not reach the API. Rebuild with VITE_API_BASE_URL pointing at your deployed backend. See client/.env.example.'
            : 'Could not reach the API. From the Creator2 repo root run npm run dev (starts client + server). If you only run the client, start the API in another terminal: cd server then npm run dev (port 3001).',
        )
      })
  }, [])

  useEffect(() => {
    setPreviewMediaError(null)
  }, [mediaUrl])

  function mediaSrc(asVideo: boolean): string {
    return socialMediaSrc({ mediaUrl, asVideo, proxyRefererQs })
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
    setFetchSource(null)
    setFetchCached(null)
    try {
      const { data } = await axios.post(
        socialApiUrl('/api/social/fetch'),
        { url: forApi },
        {
          timeout: 90000,
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (data.ok && data.mediaUrl) {
        setMediaUrl(data.mediaUrl)
        setMediaType(data.mediaType === 'video' ? 'video' : 'image')
        setFetchSource(typeof data.source === 'string' ? data.source : null)
        setFetchCached(Boolean(data.cached))
      } else {
        const hint =
          typeof data.fetchHint === 'string' && data.fetchHint.trim()
            ? data.fetchHint.trim()
            : null
        setError(
          hint ||
            'Could not extract media from that link. Check the URL and try again.',
        )
      }
    } catch (err: unknown) {
      setError(axiosErrorMessage(err, 'Failed to fetch post'))
    } finally {
      setLoading(false)
    }
  }, [postUrl])

  const handleDownload = useCallback(async () => {
    const url = mediaUrl
    if (!url) {
      setError('Extract a post first, then download.')
      return
    }
    setDownloading(true)
    setError(null)
    try {
      const isVideoHint =
        mediaType === 'video' ||
        /\.(mp4|webm|mov)(\?|$)/i.test(url) ||
        url.includes('/video/') ||
        /cdninstagram\.com.*mp4|tiktokcdn.*video|fbcdn\.net.*mp4/i.test(url)

      const base = socialApiOrigin()
      const path = url.startsWith('/api/')
        ? url
        : `/api/social/proxy?url=${encodeURIComponent(url)}${isVideoHint ? '&type=video' : ''}${proxyRefererQs}`
      const fetchUrl =
        path.startsWith('http') ? path : base ? `${base}${path}` : path

      const response = await fetch(fetchUrl)
      if (!response.ok) {
        const raw = await response.text()
        let detail = `HTTP ${response.status}`
        try {
          const j = JSON.parse(raw) as { error?: string }
          if (j.error) detail = j.error
        } catch {
          if (raw.trim())
            detail = raw.replace(/<[^>]+>/g, ' ').trim().slice(0, 300)
        }
        throw new Error(detail || 'Download failed')
      }

      const blob = await response.blob()
      const blobIsVideo = blob.type.startsWith('video/')
      const treatAsVideo = isVideoHint || blobIsVideo
      let ext = 'bin'
      if (treatAsVideo) ext = 'mp4'
      else if (blob.type.includes('jpeg') || blob.type.includes('jpg'))
        ext = 'jpg'
      else if (blob.type.includes('png')) ext = 'png'
      else if (blob.type.includes('gif')) ext = 'gif'
      else if (blob.type.includes('webp')) ext = 'webp'

      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `social-post.${ext}`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }, [mediaUrl, mediaType, proxyRefererQs])

  const isVideo =
    Boolean(mediaUrl) &&
    (mediaType === 'video' ||
      /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl!) ||
      mediaUrl!.includes('/video/') ||
      /cdninstagram\.com.*mp4|tiktokcdn.*video|fbcdn\.net.*mp4/i.test(
        mediaUrl!,
      ))

  const reelPosterOnly = useMemo(
    () =>
      postUrlForReferer.includes('/reel/') &&
      Boolean(mediaUrl) &&
      mediaType === 'image',
    [postUrlForReferer, mediaUrl, mediaType],
  )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Social Post Extractor</h1>
      <p className="text-slate-400">
        Paste a share link (Instagram, TikTok, Facebook, etc.) and extract the
        main image or video. Preview it here and download the raw file when you
        need an <code className="rounded bg-slate-800 px-1 text-slate-300">.mp4</code> or image outside this app. For CM360
        banner ZIPs, use Social Generator. Requires the API on port 3001 (use{' '}
        <code className="rounded bg-slate-800 px-1 text-slate-300">npm run dev</code> from the repo root).
      </p>
      {apiConnectionError && (
        <div className="rounded bg-red-900/35 px-3 py-2 text-sm text-red-200">
          <p className="font-medium text-red-100">API offline</p>
          <p className="mt-1">{apiConnectionError}</p>
        </div>
      )}
      {!apiConnectionError &&
        (headlessEnabled || apifyEnabled || ytdlpAvailable) && (
        <p className="rounded bg-emerald-900/30 px-3 py-1.5 text-sm text-emerald-300">
          {headlessEnabled && 'Headless browser enabled. '}
          {apifyEnabled &&
            'Apify fallback for Instagram. '}
          {ytdlpAvailable && 'yt-dlp available (TikTok/Facebook/Instagram fallback). '}
        </p>
      )}
      {!apiConnectionError && ffmpegHint && (
        <p className="rounded bg-amber-900/20 px-3 py-1.5 text-sm text-amber-200/95">{ffmpegHint}</p>
      )}

      {!apiConnectionError && ytdlpAvailable === false && (
        <div className="space-y-2 rounded bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200">
          {ytdlpHint && <p className="font-medium text-amber-100">{ytdlpHint}</p>}
          <p>
            yt-dlp was not detected on the server. On Windows try{' '}
            <code className="text-amber-100">winget install yt-dlp.yt-dlp</code>, verify{' '}
            <code className="text-amber-100">yt-dlp --version</code>, restart the API, or set{' '}
            <code className="text-amber-100">YT_DLP_PATH</code> in <code className="text-amber-100">server/.env</code>{' '}
            (see <code className="text-amber-100">server/.env.example</code>). Use forward slashes in
            the path if backslashes act oddly.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-sm text-slate-400">Post URL</label>
          <input
            type="text"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="Paste the post or reel share link"
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <button
          type="button"
          onClick={handleFetch}
          disabled={loading}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Extracting…' : 'Extract media'}
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {mediaUrl && (
        <>
          {(fetchSource != null || fetchCached != null) && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Type: </span>
                {isVideo ? 'video' : 'image'}
              </p>
              {fetchSource != null && (
                <p>
                  <span className="text-slate-500">Source: </span>
                  {fetchSource}
                </p>
              )}
              {fetchCached != null && (
                <p>
                  <span className="text-slate-500">Cached on server: </span>
                  {fetchCached ? 'yes' : 'no'}
                </p>
              )}
            </div>
          )}

          {reelPosterOnly && (
            <p className="rounded bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
              This reel resolved to the poster image only, not the full video.
              Try <strong>Extract media</strong> again, or set{' '}
              <code className="text-amber-100">APIFY_TOKEN</code> on the server
              for more reliable Instagram reel video.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : 'Download raw file'}
            </button>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <p className="mb-3 text-sm text-slate-400">Preview</p>
            {previewMediaError && (
              <p className="mb-3 rounded bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
                {previewMediaError}
              </p>
            )}
            <div className="mx-auto max-w-md overflow-hidden rounded border border-slate-600">
              {isVideo ? (
                <video
                  key={mediaUrl}
                  src={mediaSrc(true)}
                  muted
                  loop
                  playsInline
                  autoPlay
                  controls
                  preload="auto"
                  className="h-auto w-full"
                  onError={() =>
                    setPreviewMediaError(
                      'Could not load video. Try extracting again.',
                    )
                  }
                />
              ) : (
                <img
                  key={mediaUrl}
                  src={mediaSrc(false)}
                  alt=""
                  className="h-auto w-full"
                  onError={() =>
                    setPreviewMediaError(
                      'Could not load image. Try extracting again.',
                    )
                  }
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
