import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
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
import { buildPlatformHtml, exportToCM360 } from '../../services/cm360Export'
import {
  IAB_DEFAULT_SIZES,
  IAB_OPTIONAL_EXTRA_SIZES,
  iabSizeKey,
  type IabBannerSize,
} from '../../lib/iabBannerSizes'
import {
  buildBannerOverlayHtml,
  buildCm360CreativeBody,
  cropToMediaCssOptional,
  defaultBannerCrop,
  type BannerCrop,
} from '../../lib/socialBannerCreative'

type BannerExportFormat = 'html5' | 'cm360'

/** CM360 still image / GIF source limit before ZIP (unchanged). */
const MAX_CM360_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024
/**
 * Standard HTML5 ZIP (clickTAG): single media + HTML — allow larger sources when not
 * uploading to CM360. Also used as max **source** size for social reels before server-side
 * CM360 video compression.
 */
const MAX_MEDIA_BYTES_HTML5 = 80 * 1024 * 1024
/** Target max size for the MP4 inside a CM360 zip (~9.5 MB leaves room for index.html under 10 MB). */
const CM360_VIDEO_ASSET_BUDGET_BYTES = Math.floor(9.5 * 1024 * 1024)

/** Space out multiple programmatic downloads so the browser is less likely to block after the first. */
function downloadStaggerMs(i: number) {
  return new Promise<void>((r) => setTimeout(r, i > 0 ? 350 : 0))
}

/** Scale down large units so the preview grid stays usable (export uses full pixels). */
function previewBoxCssPixels(w: number, h: number, maxEdge = 260) {
  const m = Math.max(w, h)
  if (m <= maxEdge) return { width: w, height: h }
  const s = maxEdge / m
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

const SOCIAL_HOST_RE = /instagram\.com|tiktok\.com|facebook\.com|fb\.com|fb\.watch/i

function looksLikeSocialPostUrl(url: string): boolean {
  if (!url.trim()) return false
  try {
    const h = new URL(url).hostname.toLowerCase()
    return SOCIAL_HOST_RE.test(h)
  } catch {
    return SOCIAL_HOST_RE.test(url)
  }
}

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
  const [ffmpegHint, setFfmpegHint] = useState<string | null>(null)
  /** ffmpeg + ffprobe — server can shrink reel video to the CM360 MP4 budget. */
  const [ffmpegCompressForCm360, setFfmpegCompressForCm360] = useState<boolean | null>(null)
  const [apiConnectionError, setApiConnectionError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  /** Standard HTML5 = clickTAG + fixed size (local preview). CM360 = Studio Enabler.js upload. */
  const [bannerExportFormat, setBannerExportFormat] =
    useState<BannerExportFormat>('html5')
  const [optionalSizeKeys, setOptionalSizeKeys] = useState<Record<string, boolean>>({})
  const [cropByKey, setCropByKey] = useState<Record<string, BannerCrop>>({})
  const [ctaEnabled, setCtaEnabled] = useState(true)
  const [ctaText, setCtaText] = useState('Learn more')
  const [showLike, setShowLike] = useState(true)
  const [showComment, setShowComment] = useState(true)
  const [showShare, setShowShare] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [previewMediaError, setPreviewMediaError] = useState<string | null>(null)
  /** Last post URL we successfully resolved with /fetch (query-stripped). */
  const lastFetchedPostKey = useRef<string | null>(null)

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

  const activeSizes = useMemo(() => {
    const extras = IAB_OPTIONAL_EXTRA_SIZES.filter((s) => optionalSizeKeys[iabSizeKey(s)])
    return [...IAB_DEFAULT_SIZES, ...extras]
  }, [optionalSizeKeys])

  const getCrop = useCallback(
    (s: IabBannerSize) => cropByKey[iabSizeKey(s)] ?? defaultBannerCrop(),
    [cropByKey],
  )

  const patchCrop = useCallback((key: string, patch: Partial<BannerCrop>) => {
    setCropByKey((prev) => {
      const base = prev[key] ?? defaultBannerCrop()
      return { ...prev, [key]: { ...base, ...patch } }
    })
  }, [])

  useEffect(() => {
    axios.get(socialApiUrl('/api/social/config')).then(({ data }) => {
      setApiConnectionError(null)
      setHeadlessEnabled(data.headlessEnabled)
      setApifyEnabled(data.apifyEnabled ?? false)
      setYtdlpAvailable(data.ytdlpAvailable ?? null)
      const hint = data.ytdlpHint
      setYtdlpHint(typeof hint === 'string' && hint.trim() ? hint.trim() : null)
      const fh = data.ffmpegHint
      setFfmpegHint(typeof fh === 'string' && fh.trim() ? fh.trim() : null)
      setFfmpegCompressForCm360(
        typeof data.ffmpegCompressForCm360 === 'boolean' ? data.ffmpegCompressForCm360 : null,
      )
    }).catch(() => {
      setHeadlessEnabled(null)
      setApifyEnabled(false)
      setYtdlpAvailable(null)
      setYtdlpHint(null)
      setFfmpegHint(null)
      setFfmpegCompressForCm360(null)
      setApiConnectionError(
        import.meta.env.PROD && !import.meta.env.VITE_API_BASE_URL
          ? 'Could not reach the API. Rebuild the client with VITE_API_BASE_URL set to your deployed backend URL (Express server from /server), e.g. in client/.env.production.'
          : 'Could not reach the API. From the repo root run npm run dev, or in another terminal: cd server && npm run dev (port 3001).',
      )
    })
  }, [])

  useEffect(() => {
    setPreviewMediaError(null)
  }, [effectiveMediaUrl])

  const fetchPostMedia = useCallback(async (forApi: string, signal?: AbortSignal) => {
    const { data } = await axios.post(
      socialApiUrl('/api/social/fetch'),
      { url: forApi },
      {
        timeout: 90000,
        headers: { 'Content-Type': 'application/json' },
        signal,
      },
    )
    if (data.ok && data.mediaUrl) {
      return {
        ok: true as const,
        mediaUrl: data.mediaUrl as string,
        mediaType: (data.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video',
      }
    }
    const hint =
      typeof data.fetchHint === 'string' && data.fetchHint.trim()
        ? data.fetchHint.trim()
        : null
    return {
      ok: false as const,
      error: hint || 'Could not extract media. Try pasting the image/video URL manually below.',
    }
  }, [])

  /** After a short pause, fetch when the field looks like a full social URL (paste or typing). */
  useEffect(() => {
    const extracted = extractInstagramUrlFromPaste(postUrl)
    const normalized = ensureHttpUrl(extracted)
    if (!normalized || !looksLikeSocialPostUrl(normalized)) {
      return
    }
    const key = stripInstagramPostQuery(normalized)

    const ac = new AbortController()
    const t = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        setError(null)
        setMediaUrl(null)
        setMediaType('image')
        try {
          const r = await fetchPostMedia(key, ac.signal)
          if (r.ok) {
            lastFetchedPostKey.current = key
            setMediaUrl(r.mediaUrl)
            setMediaType(r.mediaType)
          } else {
            setError(r.error)
          }
        } catch (err: unknown) {
          if (axios.isCancel(err)) return
          setError(axiosErrorMessage(err, 'Failed to fetch post'))
        } finally {
          setLoading(false)
        }
      })()
    }, 500)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [postUrl, fetchPostMedia])

  /** Cached media `/api/social/media/:id` or proxy for external URLs; production uses VITE_API_BASE_URL. */
  function mediaSrc(_asVideo: boolean): string {
    return socialMediaSrc({
      mediaUrl: effectiveMediaUrl,
      asVideo: _asVideo,
      proxyRefererQs,
    })
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
      const r = await fetchPostMedia(forApi)
      if (r.ok) {
        lastFetchedPostKey.current = forApi
        setMediaUrl(r.mediaUrl)
        setMediaType(r.mediaType)
      } else {
        setError(r.error)
      }
    } catch (err: unknown) {
      setError(axiosErrorMessage(err, 'Failed to fetch post'))
    } finally {
      setLoading(false)
    }
  }, [postUrl, fetchPostMedia])

  const runExportZip = useCallback(
    async (override?: { mediaUrl: string; mediaType: 'image' | 'video' }) => {
      const url = override?.mediaUrl ?? effectiveMediaUrl
      if (!url) {
        setError('No media to export. Fetch from URL or paste image/video URL.')
        return
      }
      const resolvedType = override?.mediaType ?? mediaType
      setExporting(true)
      setError(null)
      try {
        const isVideo =
          resolvedType === 'video' ||
          /\.(mp4|webm|mov)(\?|$)/i.test(url) ||
          url.includes('video')
        const base = socialApiOrigin()
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
        let sniffMp4 = false
        if (!blobIsVideo && blob.size >= 12) {
          const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
          sniffMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
        }
        const treatAsVideo = isVideo || blobIsVideo || sniffMp4
        let ext = 'jpg'
        if (treatAsVideo) ext = 'mp4'
        else if (blob.type?.includes('png')) ext = 'png'
        else if (blob.type?.includes('gif')) ext = 'gif'

        const maxSourceBytes =
          bannerExportFormat === 'cm360' && !treatAsVideo
            ? MAX_CM360_IMAGE_SOURCE_BYTES
            : MAX_MEDIA_BYTES_HTML5

        const totalSize = blob.size
        if (totalSize > maxSourceBytes) {
          const mb = (totalSize / 1024 / 1024).toFixed(1)
          const capMb = (maxSourceBytes / 1024 / 1024).toFixed(0)
          if (bannerExportFormat === 'cm360' && treatAsVideo) {
            throw new Error(
              `This file is ${mb} MB. CM360 reel export accepts up to ${capMb} MB source video (it is compressed server-side to ~${(CM360_VIDEO_ASSET_BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB for the zip). ` +
                `Shorten the clip or reduce quality, or switch to Standard HTML5 if you need a larger source.`,
            )
          }
          if (bannerExportFormat === 'cm360') {
            throw new Error(
              `This file is ${mb} MB. CM360 still assets are limited to ${capMb} MB. ` +
                `Use a smaller image or switch to Standard HTML5 (allows up to ${MAX_MEDIA_BYTES_HTML5 / 1024 / 1024} MB).`,
            )
          }
          throw new Error(
            `This file is ${mb} MB. Standard HTML5 export allows up to ${capMb} MB. ` +
              `Use the MP4 Converter page, shorten the clip, or lower bitrate/resolution.`,
          )
        }

        let mediaBlob = blob
        const videoNeedsCm360Budget =
          treatAsVideo && blob.size > CM360_VIDEO_ASSET_BUDGET_BYTES
        if (videoNeedsCm360Budget) {
          const mustHaveEncoder = bannerExportFormat === 'cm360'
          if (mustHaveEncoder && ffmpegCompressForCm360 === false) {
            throw new Error(
              `Video is ${(blob.size / 1024 / 1024).toFixed(1)} MB; CM360 needs the MP4 in the zip at about ${(CM360_VIDEO_ASSET_BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB or less. ` +
                `Run the server with ffmpeg + ffprobe (set FFMPEG_PATH in server/.env), or switch to Standard HTML5 for a larger file.`,
            )
          }
          /** Standard HTML5 defaults here — compress when the API can, same as CM360 reel path. */
          if (ffmpegCompressForCm360 !== false) {
            const compressPath = '/api/social/compress-cm360-video'
            const compressUrl = compressPath.startsWith('http')
              ? compressPath
              : base
                ? `${base}${compressPath}`
                : compressPath
            const ab = await blob.arrayBuffer()
            const cRes = await fetch(compressUrl, {
              method: 'POST',
              body: ab,
              headers: { 'Content-Type': 'application/octet-stream' },
            })
            if (!cRes.ok) {
              let detail = `HTTP ${cRes.status}`
              try {
                const raw = await cRes.text()
                const j = JSON.parse(raw) as { error?: string }
                if (j.error) detail = j.error
              } catch {
                /* keep detail */
              }
              if (mustHaveEncoder) {
                throw new Error(detail || 'Server could not compress video for CM360')
              }
              console.warn('[SocialGenerator] Video compress skipped:', detail)
            } else {
              mediaBlob = await cRes.blob()
              if (mediaBlob.size > CM360_VIDEO_ASSET_BUDGET_BYTES) {
                throw new Error(
                  `Compressed video is still ${(mediaBlob.size / 1024 / 1024).toFixed(2)} MB. Try a shorter reel or lower resolution source.`,
                )
              }
            }
          }
        }

        if (bannerExportFormat === 'cm360') {
          const overlayCm360 = buildBannerOverlayHtml(
            { ctaEnabled, ctaText, showLike, showComment, showShare },
            { forCm360: true },
          )
          const cm360AssetName = treatAsVideo
            ? 'video.mp4'
            : ext === 'png'
              ? 'image.png'
              : ext === 'gif'
                ? 'image.gif'
                : 'image.jpg'

          const buildCm360HtmlForSize = (size: (typeof activeSizes)[0]) => {
            const mediaCss = cropToMediaCssOptional(getCrop(size))
            const bodyContentCm360 = buildCm360CreativeBody({
              treatAsVideo,
              assetName: cm360AssetName,
              mediaCss,
              overlayHtml: overlayCm360,
            })
            return buildPlatformHtml('cm360', {
              width: size.w,
              height: size.h,
              clickUrl,
              bodyContent: bodyContentCm360,
              extraStyles: 'cursor:pointer;',
              ...(treatAsVideo && { videoAssetName: cm360AssetName }),
            })
          }

          for (let i = 0; i < activeSizes.length; i++) {
            const size = activeSizes[i]
            await downloadStaggerMs(i)
            await exportToCM360({
              width: size.w,
              height: size.h,
              clickUrl,
              html: buildCm360HtmlForSize(size),
              assets: [{ name: cm360AssetName, data: mediaBlob }],
              downloadName: `social-banner-${size.w}x${size.h}`,
            })
          }
        } else {
          /** Same as MP4 Converter when platform is TTD / Amazon / StackAdapt: clickTAG HTML + one zip per size = index.html + video.mp4 only. */
          const HTML5_PLATFORM = 'ttd' as const
          const overlayHtml5 = buildBannerOverlayHtml({
            ctaEnabled,
            ctaText,
            showLike,
            showComment,
            showShare,
          })
          const bodyContentVideoMp4 =
            '\n  <div style="position:relative;width:100%;height:100%;cursor:pointer;">\n    <video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>\n  </div>'
          const html5VideoName = 'video.mp4'
          const html5ImageName =
            ext === 'png' ? 'image.png' : ext === 'gif' ? 'image.gif' : 'image.jpg'

          const html5ZipOpts = { maxOutputMb: MAX_MEDIA_BYTES_HTML5 / 1024 / 1024 } as const

          const buildHtml5ForSize = (size: (typeof activeSizes)[0]) => {
            const mediaCss = cropToMediaCssOptional(getCrop(size))
            const html5ImageBody = `<img src="${html5ImageName}" alt="" style="width:100%;height:100%;object-fit:cover;${mediaCss}">`
            return buildPlatformHtml(HTML5_PLATFORM, {
              width: size.w,
              height: size.h,
              clickUrl,
              bodyContent: treatAsVideo ? bodyContentVideoMp4 : html5ImageBody,
              extraStyles: 'cursor:pointer;',
              overlayHtml: overlayHtml5 || undefined,
              mediaInlineStyle: treatAsVideo ? mediaCss : undefined,
              ...(treatAsVideo && { videoAssetName: html5VideoName }),
            })
          }

          for (let i = 0; i < activeSizes.length; i++) {
            const size = activeSizes[i]
            await downloadStaggerMs(i)
            await exportToCM360(
              {
                width: size.w,
                height: size.h,
                clickUrl,
                html: buildHtml5ForSize(size),
                assets: [
                  {
                    name: treatAsVideo ? html5VideoName : html5ImageName,
                    data: mediaBlob,
                  },
                ],
                downloadName: `social-banner-${size.w}x${size.h}`,
              },
              html5ZipOpts,
            )
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed')
      } finally {
        setExporting(false)
      }
    },
    [
      effectiveMediaUrl,
      mediaType,
      clickUrl,
      postUrl,
      proxyRefererQs,
      bannerExportFormat,
      ffmpegCompressForCm360,
      activeSizes,
      getCrop,
      ctaEnabled,
      ctaText,
      showLike,
      showComment,
      showShare,
    ],
  )

  const handleExport = useCallback(() => void runExportZip(), [runExportZip])

  const handleGenerateAndDownload = useCallback(async () => {
    const extracted = extractInstagramUrlFromPaste(postUrl)
    const normalized = ensureHttpUrl(extracted)
    if (!normalized) {
      setError('Please enter a post URL or Instagram embed snippet')
      return
    }
    const forApi = stripInstagramPostQuery(normalized)
    if (
      mediaUrl &&
      lastFetchedPostKey.current === forApi &&
      !manualMediaUrl.trim()
    ) {
      await runExportZip({ mediaUrl, mediaType })
      return
    }
    setLoading(true)
    setError(null)
    setMediaUrl(null)
    setMediaType('image')
    try {
      const r = await fetchPostMedia(forApi)
      if (!r.ok) {
        setError(r.error)
        return
      }
      lastFetchedPostKey.current = forApi
      setMediaUrl(r.mediaUrl)
      setMediaType(r.mediaType)
      await runExportZip({ mediaUrl: r.mediaUrl, mediaType: r.mediaType })
    } catch (err: unknown) {
      setError(axiosErrorMessage(err, 'Failed to generate banners'))
    } finally {
      setLoading(false)
    }
  }, [postUrl, mediaUrl, mediaType, manualMediaUrl, fetchPostMedia, runExportZip])

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
        Paste an Instagram reel or post link (Share → Copy link) — we fetch the asset,
        preview <strong className="font-medium text-slate-300">300×600</strong> and{' '}
        <strong className="font-medium text-slate-300">300×250</strong> by default (add
        more IAB sizes below), <strong className="font-medium text-slate-300">crop</strong>{' '}
        and <strong className="font-medium text-slate-300">zoom</strong> per placement, and
        layer a <strong className="font-medium text-slate-300">CTA</strong> plus optional
        social-style buttons. Click <strong className="font-medium text-slate-300">Generate &amp; download ZIP</strong> to
        export. Choose{' '}
        <strong className="font-medium text-slate-300">Standard HTML5</strong>{' '}
        (clickTAG, opens locally) or{' '}
        <strong className="font-medium text-slate-300">CM360</strong> (Google Enabler). Tracking tails such as{' '}
        <code className="rounded bg-slate-800 px-1 text-slate-300">
          ?utm_source=ig_web_copy_link
        </code>{' '}
        are stripped automatically. TikTok and Facebook links work too. If
        extraction fails, paste a direct file URL below or Instagram embed HTML.
        Run <code className="rounded bg-slate-800 px-1 text-slate-300">npm run dev</code> from
        the repo root so the API on port 3001 is running.
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
          {apifyEnabled && 'Apify fallback for Instagram. '}
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
            yt-dlp not detected — on Windows try{' '}
            <code className="text-amber-100">winget install yt-dlp.yt-dlp</code>, restart the API, or
            set <code className="text-amber-100">YT_DLP_PATH</code> in <code className="text-amber-100">server/.env</code>.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-sm text-slate-400">
            Post URL
          </label>
          <input
            type="text"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.instagram.com/reel/… (paste share link)"
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleGenerateAndDownload()}
            disabled={loading || exporting}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading || exporting ? 'Working…' : 'Generate & download ZIP'}
          </button>
          <button
            type="button"
            onClick={() => void handleFetch()}
            disabled={loading || exporting}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {loading ? 'Fetching…' : 'Refresh media'}
          </button>
        </div>
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

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <label className="mb-2 block text-sm font-medium text-slate-300">
          Banner sizes
        </label>
        <p className="mb-3 text-xs text-slate-500">
          <strong className="text-slate-400">Always included:</strong>{' '}
          {IAB_DEFAULT_SIZES.map((s) => `${s.w}×${s.h}`).join(', ')}. Add more sizes — each selected size
          gets its own ZIP:
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {IAB_OPTIONAL_EXTRA_SIZES.map((s) => {
            const k = iabSizeKey(s)
            return (
              <label
                key={k}
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={!!optionalSizeKeys[k]}
                  onChange={(e) =>
                    setOptionalSizeKeys((prev) => ({ ...prev, [k]: e.target.checked }))
                  }
                  className="accent-sky-500"
                />
                {s.w}×{s.h} <span className="text-slate-500">({s.label})</span>
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Exporting {activeSizes.length} size{activeSizes.length === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <label className="mb-2 block text-sm font-medium text-slate-300">
          CTA &amp; social-style bar
        </label>
        <p className="mb-3 text-xs text-slate-500">
          Renders as a bottom gradient bar over the creative (decorative engagement row +
          pill CTA). Uses your main click URL for the whole ad; the row is non-interactive so
          the click layer still works.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={ctaEnabled}
              onChange={(e) => setCtaEnabled(e.target.checked)}
              className="accent-sky-500"
            />
            Show CTA pill
          </label>
          <input
            type="text"
            value={ctaText}
            onChange={(e) => setCtaText(e.target.value)}
            disabled={!ctaEnabled}
            placeholder="Learn more"
            className="min-w-[10rem] rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white disabled:opacity-40"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={showLike}
              onChange={(e) => setShowLike(e.target.checked)}
              className="accent-sky-500"
            />
            Like
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={showComment}
              onChange={(e) => setShowComment(e.target.checked)}
              className="accent-sky-500"
            />
            Comment
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={showShare}
              onChange={(e) => setShowShare(e.target.checked)}
              className="accent-sky-500"
            />
            Share
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <label className="mb-2 block text-sm font-medium text-slate-300">
          Banner HTML format
        </label>
        <p className="mb-3 text-xs text-slate-500">
          <strong className="text-slate-400">Standard HTML5</strong> is built with the same code path as the MP4
          Converter when platform is <strong className="text-slate-400">The Trade Desk</strong>{' '}
          (<code className="text-slate-400">buildPlatformHtml(&apos;ttd&apos;, …)</code>): each creative is{' '}
          <strong>only</strong> <code className="text-slate-400">index.html</code> +{' '}
          <code className="text-slate-400">video.mp4</code> (or <code className="text-slate-400">image.*</code>) at
          the zip root — no multi-page bundles. <strong className="text-slate-400">CM360 / Studio</strong> uses the MP4
          CM360 path (Enabler + <code className="text-slate-400">video#video1</code>). CM360 overlays use plain text
          labels. Reel video over ~{(CM360_VIDEO_ASSET_BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB is compressed on the
          server (ffmpeg + ffprobe) for <strong className="text-slate-400">both</strong> CM360 and Standard HTML5 so zips
          stay small. Caps — CM360 still image:{' '}
          <strong className="text-slate-400">{MAX_CM360_IMAGE_SOURCE_BYTES / 1024 / 1024} MB</strong> source; video /
          HTML5 source: <strong className="text-slate-400">{MAX_MEDIA_BYTES_HTML5 / 1024 / 1024} MB</strong> max before
          export.
        </p>
        <div className="mb-3 rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/95">
          <p className="font-medium text-amber-50">One ZIP per banner size (same as MP4 Converter single export)</p>
          <p className="mt-1 text-amber-100/90">
            Each selected size downloads as{' '}
            <code className="text-amber-200">social-banner-WxH.zip</code> — flat root with{' '}
            <code className="text-amber-200">index.html</code> + media file, identical structure to the MP4 to HTML5
            tool. If several sizes are selected, your browser may ask to allow multiple downloads.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="radio"
              name="bannerFormat"
              checked={bannerExportFormat === 'html5'}
              onChange={() => setBannerExportFormat('html5')}
              className="accent-sky-500"
            />
            Standard HTML5 (clickTAG)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
            <input
              type="radio"
              name="bannerFormat"
              checked={bannerExportFormat === 'cm360'}
              onChange={() => setBannerExportFormat('cm360')}
              className="accent-sky-500"
            />
            CM360 / Studio (Enabler)
          </label>
        </div>
      </div>

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
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || loading}
              className="rounded bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-500 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Download ZIP again'}
            </button>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <p className="mb-1 text-sm text-slate-400">Banner preview</p>
            <p className="mb-3 text-xs text-slate-500">
              Scaled to fit this screen; export uses full pixel sizes. Crop/zoom and overlays are written into each
              size&apos;s <code className="text-slate-400">index.html</code> inside{' '}
              <code className="text-slate-400">social-banner-WxH.zip</code> (same structure as MP4 Converter output).
            </p>
            {previewMediaError && (
              <p className="mb-3 rounded bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
                {previewMediaError}
              </p>
            )}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {activeSizes.map(({ w, h, label }) => {
                const key = iabSizeKey({ w, h, label })
                const box = previewBoxCssPixels(w, h)
                const c = getCrop({ w, h, label })
                const mediaStyle = {
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover' as const,
                  objectPosition: `${c.posX}% ${c.posY}%`,
                  transform: `scale(${c.zoom})`,
                  transformOrigin: `${c.posX}% ${c.posY}%`,
                }
                const showBar =
                  (ctaEnabled && ctaText.trim()) || showLike || showComment || showShare
                const cm360Engagement = bannerExportFormat === 'cm360'
                return (
                  <div key={key} className="flex min-w-0 flex-col gap-2 rounded border border-slate-700/80 bg-slate-800/30 p-3">
                    <p className="text-xs font-medium text-slate-400">
                      {w}×{h} <span className="font-normal text-slate-500">· {label}</span>
                    </p>
                    <div
                      className="relative overflow-hidden rounded border border-slate-600 bg-black"
                      style={{ width: box.width, height: box.height }}
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
                          style={mediaStyle}
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
                          style={mediaStyle}
                          onError={() =>
                            setPreviewMediaError(
                              'Could not load image preview. Try fetching again or paste a direct image URL.',
                            )
                          }
                        />
                      )}
                      {showBar && (
                        <div
                          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-3 pt-8"
                          style={{ zIndex: 2 }}
                        >
                          <div className="flex flex-row flex-wrap gap-2">
                            {showLike &&
                              (cm360Engagement ?
                                <span className="inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  Like
                                </span>
                              : <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs text-white">
                                  ♥
                                </span>)}
                            {showComment &&
                              (cm360Engagement ?
                                <span className="inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  Comment
                                </span>
                              : <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs text-white">
                                  💬
                                </span>)}
                            {showShare &&
                              (cm360Engagement ?
                                <span className="inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  Share
                                </span>
                              : <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs text-white">
                                  ↗
                                </span>)}
                          </div>
                          {ctaEnabled && ctaText.trim() && (
                            <span className="inline-block w-fit rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-900">
                              {ctaText.trim()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <details className="text-xs text-slate-400">
                      <summary className="cursor-pointer select-none text-slate-300 hover:text-white">
                        Crop &amp; zoom (this size only)
                      </summary>
                      <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
                        <label className="flex flex-col gap-1">
                          <span>Horizontal focus ({c.posX}%)</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={c.posX}
                            onChange={(e) =>
                              patchCrop(key, { posX: Number(e.target.value) })
                            }
                            className="accent-sky-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>Vertical focus ({c.posY}%)</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={c.posY}
                            onChange={(e) =>
                              patchCrop(key, { posY: Number(e.target.value) })
                            }
                            className="accent-sky-500"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span>Zoom ({c.zoom.toFixed(2)}×)</span>
                          <input
                            type="range"
                            min={100}
                            max={200}
                            value={Math.round(c.zoom * 100)}
                            onChange={(e) =>
                              patchCrop(key, { zoom: Number(e.target.value) / 100 })
                            }
                            className="accent-sky-500"
                          />
                        </label>
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
