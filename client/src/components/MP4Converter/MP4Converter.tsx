import { useState, useCallback } from 'react'
import { exportToCM360, buildCM360Html } from '../../services/cm360Export'

const DIMENSION_PRESETS = [
  { w: 300, h: 250, label: '300×250' },
  { w: 300, h: 600, label: '300×600' },
  { w: 728, h: 90, label: '728×90' },
  { w: 320, h: 50, label: '320×50' },
]

const CM360_MAX_SIZE_MB = 10

export default function MP4Converter() {
  const [width, setWidth] = useState(300)
  const [height, setHeight] = useState(250)
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('Please select an MP4 video file')
      return
    }
    setError(null)
    setVideoFile(file)
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    e.target.value = ''
  }, [])

  const handleExport = useCallback(async () => {
    if (!videoFile || !videoUrl) {
      setError('Please upload an MP4 file first')
      return
    }
    if (videoFile.size > CM360_MAX_SIZE_MB * 1024 * 1024) {
      setError(`File must be under ${CM360_MAX_SIZE_MB} MB for CM360`)
      return
    }
    setExporting(true)
    setError(null)
    try {
      const arrayBuffer = await videoFile.arrayBuffer()
      const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
      const ext = videoFile.name.endsWith('.mp4') ? 'mp4' : 'mp4'
      const assetName = `video.${ext}`

      const bodyContent = `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    <video
      src="${assetName}"
      autoplay
      muted
      loop
      playsinline
      style="width:100%;height:100%;object-fit:cover;"
    ></video>
  </div>`

      const html = buildCM360Html({
        width,
        height,
        clickUrl,
        bodyContent,
        extraStyles: 'cursor:pointer;',
      })

      await exportToCM360({
        width,
        height,
        clickUrl,
        html,
        assets: [{ name: assetName, data: blob }],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [videoFile, videoUrl, width, height, clickUrl])

  const clearVideo = useCallback(() => {
    setVideoFile(null)
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setError(null)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">MP4 Converter</h1>
      <p className="text-slate-400">
        Upload an MP4 video and export it as an HTML5 video banner for CM360.
        Video will autoplay muted (CM360 requirement).
      </p>

      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-400">Banner dimensions</span>
          <div className="flex flex-wrap gap-2">
            {DIMENSION_PRESETS.map(({ w, h, label }) => (
              <button
                key={label}
                onClick={() => {
                  setWidth(w)
                  setHeight(h)
                }}
                className={`rounded px-3 py-1.5 text-sm ${
                  width === w && height === h
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Click URL:</label>
          <input
            type="url"
            value={clickUrl}
            onChange={(e) => setClickUrl(e.target.value)}
            className="w-56 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
            {videoFile ? 'Replace video' : 'Upload MP4'}
            <input
              type="file"
              accept="video/mp4,video/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          {videoFile && (
            <>
              <span className="text-sm text-slate-400">
                {videoFile.name} ({(videoFile.size / 1024).toFixed(1)} KB)
              </span>
              <button
                onClick={clearVideo}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Clear
              </button>
            </>
          )}
        </div>

        {videoUrl && (
          <div className="mb-4">
            <p className="mb-2 text-sm text-slate-400">Preview</p>
            <div
              className="overflow-hidden rounded border border-slate-600"
              style={{ width: Math.min(width, 400), height: Math.min(height, 300) }}
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

        <button
          onClick={handleExport}
          disabled={!videoFile || exporting}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export CM360 ZIP'}
        </button>
      </div>
    </div>
  )
}
