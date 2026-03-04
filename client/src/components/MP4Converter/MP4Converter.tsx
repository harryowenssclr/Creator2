import { useState, useCallback } from 'react'
import JSZip from 'jszip'
import { exportToCM360, createCM360ZipBlob, buildCM360Html } from '../../services/cm360Export'

const CM360_MAX_SIZE_MB = 10
const FALLBACK_WIDTH = 300
const FALLBACK_HEIGHT = 250

type VideoWithDims = { file: File; width: number; height: number; detecting?: boolean }

function sanitizeZipName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'banner'
}

function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, _reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const w = video.videoWidth
      const h = video.videoHeight
      URL.revokeObjectURL(url)
      video.remove()
      resolve(w > 0 && h > 0 ? { width: w, height: h } : { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      video.remove()
      resolve({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT })
    }
    video.src = url
  })
}

export default function MP4Converter() {
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [videoFiles, setVideoFiles] = useState<VideoWithDims[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<string | null>(null)

  const firstVideo = videoFiles[0]
  const isBulk = videoFiles.length > 1
  const anyDetecting = videoFiles.some((v) => v.detecting)

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const valid = files.filter((f) => f.type.startsWith('video/'))
    if (valid.length !== files.length) {
      setError('Some files were not video files and were skipped')
    } else {
      setError(null)
    }
    if (!valid.length) return
    const newItems: VideoWithDims[] = valid.map((f) => ({ file: f, width: 0, height: 0, detecting: true }))
    setVideoFiles((prev) => (prev.length ? [...prev, ...newItems] : newItems))
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return valid[0] ? URL.createObjectURL(valid[0]) : null
    })
    e.target.value = ''
    const dimsList = await Promise.all(valid.map((f) => getVideoDimensions(f)))
    setVideoFiles((p) => {
      const next = [...p]
      let dimIdx = 0
      for (let i = 0; i < next.length && dimIdx < dimsList.length; i++) {
        if (next[i].detecting) {
          next[i] = { ...next[i], ...dimsList[dimIdx], detecting: false }
          dimIdx++
        }
      }
      return next
    })
  }, [])

  const clearVideos = useCallback(() => {
    setVideoFiles([])
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setError(null)
  }, [])

  const removeFile = useCallback((index: number) => {
    setVideoFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      setVideoUrl((v) => {
        if (v) URL.revokeObjectURL(v)
        return next[0] ? URL.createObjectURL(next[0].file) : null
      })
      return next
    })
  }, [])

  const handleExport = useCallback(async () => {
    if (!videoFiles.length) {
      setError('Please upload at least one MP4 file')
      return
    }
    const notReady = videoFiles.filter((v) => v.detecting)
    if (notReady.length) {
      setError('Waiting for dimension detection to complete…')
      return
    }
    const oversized = videoFiles.filter((v) => v.file.size > CM360_MAX_SIZE_MB * 1024 * 1024)
    if (oversized.length) {
      setError(`${oversized.length} file(s) exceed ${CM360_MAX_SIZE_MB} MB: ${oversized.map((v) => v.file.name).join(', ')}`)
      return
    }
    setExporting(true)
    setError(null)
    try {
      if (isBulk) {
        const bundle = new JSZip()
        const usedNames = new Set<string>()
        for (let i = 0; i < videoFiles.length; i++) {
          const { file, width: w, height: h } = videoFiles[i]
          setExportProgress(`${i + 1} / ${videoFiles.length}: ${file.name} (${w}×${h})`)
          const arrayBuffer = await file.arrayBuffer()
          const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
          const ext = file.name.endsWith('.mp4') ? 'mp4' : 'mp4'
          const assetName = `video.${ext}`
          const bodyContent = `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    <video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>
  </div>`
          const html = buildCM360Html({
            width: w,
            height: h,
            clickUrl,
            bodyContent,
            extraStyles: 'cursor:pointer;',
            videoAssetName: assetName,
          })
          const creativeBlob = await createCM360ZipBlob({
            width: w,
            height: h,
            clickUrl,
            html,
            assets: [{ name: assetName, data: blob }],
          })
          let zipName = `${sanitizeZipName(file.name)}-${w}x${h}.zip`
          if (usedNames.has(zipName)) {
            let n = 1
            while (usedNames.has(`${sanitizeZipName(file.name)}-${w}x${h}-${n}.zip`)) n++
            zipName = `${sanitizeZipName(file.name)}-${w}x${h}-${n}.zip`
          }
          usedNames.add(zipName)
          bundle.file(zipName, creativeBlob)
        }
        setExportProgress(null)
        const bundleBlob = await bundle.generateAsync({ type: 'blob' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(bundleBlob)
        link.download = 'cm360-bulk.zip'
        link.click()
        URL.revokeObjectURL(link.href)
      } else {
        const { file, width: w, height: h } = videoFiles[0]
        const arrayBuffer = await file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
        const ext = file.name.endsWith('.mp4') ? 'mp4' : 'mp4'
        const assetName = `video.${ext}`
        const bodyContent = `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    <video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>
  </div>`
        const html = buildCM360Html({
          width: w,
          height: h,
          clickUrl,
          bodyContent,
          extraStyles: 'cursor:pointer;',
          videoAssetName: assetName,
        })
        await exportToCM360({
          width: w,
          height: h,
          clickUrl,
          html,
          assets: [{ name: assetName, data: blob }],
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }, [videoFiles, isBulk, clickUrl])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">MP4 Converter</h1>
      <p className="text-slate-400">
        Bulk upload MP4s of any dimensions. Each video&apos;s size is detected automatically
        and creatives are generated to match. Single file: direct download. Multiple: one zip with all creatives.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Click URL:</span>
          <input
            type="url"
            value={clickUrl}
            onChange={(e) => setClickUrl(e.target.value)}
            className="w-56 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
          />
        </label>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
            {videoFiles.length ? 'Add more' : 'Upload MP4'}
            <input
              type="file"
              accept="video/mp4,video/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          {videoFiles.length > 0 && (
            <>
              <span className="text-sm text-slate-400">
                {videoFiles.length} file{videoFiles.length !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={clearVideos}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Clear all
              </button>
            </>
          )}
        </div>
        {(isBulk || videoFiles.length === 1) && (
          <div className="mb-4 max-h-48 overflow-y-auto rounded border border-slate-600 bg-slate-800/50 p-2">
            <p className="mb-2 text-xs text-slate-400">Videos (dimensions auto-detected)</p>
            <ul className="space-y-1 text-sm">
              {videoFiles.map((v, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300" title={v.file.name}>
                    {v.file.name}
                  </span>
                  <span className="shrink-0 text-slate-500">
                    {v.detecting ? (
                      <span className="text-amber-400">Detecting…</span>
                    ) : (
                      `${v.width}×${v.height} · ${(v.file.size / 1024).toFixed(0)} KB`
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-red-400 hover:text-red-300"
                    aria-label={`Remove ${v.file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {videoUrl && firstVideo && (
          <div className="mb-4">
            <p className="mb-2 text-sm text-slate-400">Preview</p>
            <div
              className="overflow-hidden rounded border border-slate-600"
              style={{
                width: Math.min(firstVideo.detecting ? 300 : firstVideo.width, 400),
                height: Math.min(firstVideo.detecting ? 250 : firstVideo.height, 300),
              }}
            >
              <video
                src={videoUrl}
                muted
                loop
                playsInline
                autoPlay
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded bg-red-900/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {exportProgress && (
          <p className="mb-2 text-sm text-slate-400">{exportProgress}</p>
        )}
        <button
          onClick={handleExport}
          disabled={!videoFiles.length || exporting || anyDetecting}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {exporting
            ? 'Exporting…'
            : isBulk
              ? `Export ${videoFiles.length} ZIPs`
              : 'Export CM360 ZIP'}
        </button>
      </div>
    </div>
  )
}
