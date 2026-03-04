import { useState, useCallback } from 'react'
import axios from 'axios'
import JSZip from 'jszip'
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
  const [error, setError] = useState<string | null>(null)
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [exporting, setExporting] = useState(false)

  const effectiveMediaUrl = mediaUrl || (manualMediaUrl.trim() || null)

  const handleFetch = useCallback(async () => {
    if (!postUrl.trim()) {
      setError('Please enter a post URL')
      return
    }
    setLoading(true)
    setError(null)
    setMediaUrl(null)
    setMediaType('image')
    try {
      const { data } = await axios.post('/api/social/fetch', {
        url: postUrl.trim(),
      })
      if (data.ok && data.mediaUrl) {
        setMediaUrl(data.mediaUrl)
        setMediaType(data.mediaType === 'video' ? 'video' : 'image')
      } else {
        setError(
          'Could not extract media. Try pasting the image/video URL manually below.',
        )
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to fetch post'
      setError(msg)
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
      const proxyUrl = `/api/social/proxy?url=${encodeURIComponent(url)}${isVideo ? '&type=video' : ''}`

      const response = await fetch(proxyUrl)
      if (!response.ok) throw new Error('Failed to fetch media')
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
          ? `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><video src="${assetName}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video></div>`
          : `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><img src="${assetName}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
        const html = buildCM360Html({
          width: size.w,
          height: size.h,
          clickUrl,
          bodyContent,
          extraStyles: 'cursor:pointer;',
        })
        zip.file(`banner-${size.w}x${size.h}.html`, html)
      }

      const indexHtml = buildCM360Html({
        width: 300,
        height: 600,
        clickUrl,
        bodyContent: treatAsVideo
          ? `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><video src="${assetName}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video></div>`
          : `<div style="position:relative;width:100%;height:100%;cursor:pointer;"><img src="${assetName}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`,
        extraStyles: 'cursor:pointer;',
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
  }, [effectiveMediaUrl, clickUrl])

  const handleManualApply = useCallback(() => {
    if (manualMediaUrl.trim()) {
      const url = manualMediaUrl.trim()
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
      effectiveMediaUrl.includes('/video/'))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Social Generator</h1>
      <p className="text-slate-400">
        Paste a social post URL (Instagram, Facebook, TikTok, etc.) to
        auto-generate 300×600 and 300×250 banners. Video posts produce video
        banners (like Nova/Spaceback). If extraction fails, paste the image or
        video URL manually.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-sm text-slate-400">
            Post URL
          </label>
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.instagram.com/p/..."
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
            <p className="mb-3 text-sm text-slate-400">Preview</p>
            <div className="flex flex-wrap gap-4">
              {BANNER_SIZES.map(({ w, h }) => (
                <div
                  key={`${w}x${h}`}
                  className="overflow-hidden rounded border border-slate-600"
                  style={{ width: w, height: h }}
                >
                  {isVideo ? (
                    <video
                      src={
                        effectiveMediaUrl.startsWith('http')
                          ? `/api/social/proxy?url=${encodeURIComponent(effectiveMediaUrl)}&type=video`
                          : effectiveMediaUrl
                      }
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={
                        effectiveMediaUrl.startsWith('http')
                          ? `/api/social/proxy?url=${encodeURIComponent(effectiveMediaUrl)}`
                          : effectiveMediaUrl
                      }
                      alt=""
                      className="h-full w-full object-cover"
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
