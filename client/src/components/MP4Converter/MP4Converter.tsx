import { useState, useCallback, useMemo } from 'react'
import JSZip from 'jszip'
import {
  exportToCM360,
  createCM360ZipBlob,
  buildPlatformHtml,
  PLATFORM_OPTIONS,
  type Platform,
} from '../../services/cm360Export'

const CM360_MAX_SIZE_MB = 10
const FALLBACK_WIDTH = 300
const FALLBACK_HEIGHT = 250
const PREVIEW_MAX_SIZE = 200

type NamePartType = 'filename' | 'folder' | 'size'
const NAME_PART_OPTIONS: { value: NamePartType; label: string }[] = [
  { value: 'filename', label: 'Filename' },
  { value: 'folder', label: 'Folder name' },
  { value: 'size', label: 'Size' },
]

const SEPARATOR_OPTIONS = [
  { value: '_', label: 'Underscore' },
  { value: '-', label: 'Hyphen' },
  { value: ' ', label: 'Space' },
  { value: '', label: 'None' },
]

const DEFAULT_NAME_PARTS: NamePartType[] = ['filename', 'size']

const IAB_STANDARD_SIZES = [
  { w: 300, h: 250 },
  { w: 300, h: 600 },
  { w: 728, h: 90 },
  { w: 320, h: 50 },
  { w: 160, h: 600 },
  { w: 970, h: 250 },
  { w: 970, h: 90 },
  { w: 336, h: 280 },
  { w: 300, h: 50 },
  { w: 320, h: 480 },
  { w: 970, h: 418 },
  { w: 250, h: 250 },
] as const

const EXPORT_PRESETS = [
  { w: 300, h: 250, label: '300×250' },
  { w: 300, h: 600, label: '300×600' },
  { w: 728, h: 90, label: '728×90' },
  { w: 320, h: 50, label: '320×50' },
  { w: 160, h: 600, label: '160×600' },
  { w: 970, h: 250, label: '970×250' },
  { w: 970, h: 90, label: '970×90' },
  { w: 336, h: 280, label: '336×280' },
] as const

const IAB_CLOSE_THRESHOLD = 10

function findClosestIabSize(
  w: number,
  h: number,
  threshold = IAB_CLOSE_THRESHOLD,
): { w: number; h: number } | null {
  let best: { w: number; h: number; diff: number } | null = null
  for (const std of IAB_STANDARD_SIZES) {
    const dw = Math.abs(w - std.w)
    const dh = Math.abs(h - std.h)
    if (dw <= threshold && dh <= threshold) {
      const diff = dw + dh
      if (!best || diff < best.diff) best = { ...std, diff }
    }
  }
  return best ? { w: best.w, h: best.h } : null
}

function isIabSize(w: number, h: number): boolean {
  return IAB_STANDARD_SIZES.some((std) => std.w === w && std.h === h)
}

type VideoWithDims = {
  file: File
  width: number
  height: number
  detecting?: boolean
  url: string
  /** Override export size; null = use detected dimensions */
  exportSize: { w: number; h: number } | null
}

function sanitizeZipName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'banner'
}

function buildNameFromParts(
  parts: NamePartType[],
  separator: string,
  ctx: { filename: string; width: number; height: number; folder: string },
): string {
  const values = parts.map((p) => {
    if (p === 'filename') return ctx.filename
    if (p === 'folder') return ctx.folder ? sanitizeZipName(ctx.folder.replace(/\//g, '_')) : ''
    if (p === 'size') return `${ctx.width}x${ctx.height}`
    return ''
  })
  const joined = values.filter(Boolean).join(separator)
  return joined.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_') || 'banner'
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

function scaledPreviewSize(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { w, h }
  const scale = w > h ? max / w : max / h
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

function nextId() {
  return `part-${Math.random().toString(36).slice(2, 9)}`
}

export default function MP4Converter() {
  const [platform, setPlatform] = useState<Platform>('cm360')
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [nameParts, setNameParts] = useState<{ id: string; type: NamePartType }[]>(() =>
    DEFAULT_NAME_PARTS.map((type) => ({ id: nextId(), type })),
  )
  const [nameSeparator, setNameSeparator] = useState('_')
  const [draggedPartId, setDraggedPartId] = useState<string | null>(null)
  const [showIssuesOnly, setShowIssuesOnly] = useState(false)
  const [videoFiles, setVideoFiles] = useState<VideoWithDims[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<string | null>(null)

  const isBulk = videoFiles.length > 1
  const anyDetecting = videoFiles.some((v) => v.detecting)

  const processAndAddFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    const valid = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name))
    if (valid.length !== files.length) {
      setError(`Added ${valid.length} videos (${files.length - valid.length} non-video files skipped)`)
    } else {
      setError(null)
    }
    if (!valid.length) return
    const newItems: VideoWithDims[] = valid.map((f) => ({
      file: f,
      width: 0,
      height: 0,
      detecting: true,
      url: URL.createObjectURL(f),
      exportSize: null,
    }))
    setVideoFiles((prev) => (prev.length ? [...prev, ...newItems] : newItems))
    const dimsList = await Promise.all(valid.map((f) => getVideoDimensions(f)))
    setVideoFiles((p) => {
      const next = [...p]
      let dimIdx = 0
      for (let i = 0; i < next.length && dimIdx < dimsList.length; i++) {
        if (next[i].detecting) {
          const dims = dimsList[dimIdx]
          const closestIab = findClosestIabSize(dims.width, dims.height)
          next[i] = {
            ...next[i],
            ...dims,
            detecting: false,
            exportSize: closestIab,
          }
          dimIdx++
        }
      }
      return next
    })
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      await processAndAddFiles(files)
      e.target.value = ''
    },
    [processAndAddFiles],
  )

  const handleFolderChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      await processAndAddFiles(files)
      e.target.value = ''
    },
    [processAndAddFiles],
  )

  const clearVideos = useCallback(() => {
    setVideoFiles((prev) => {
      prev.forEach((v) => URL.revokeObjectURL(v.url))
      return []
    })
    setError(null)
  }, [])

  const removeFile = useCallback((index: number) => {
    setVideoFiles((prev) => {
      URL.revokeObjectURL(prev[index].url)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const setExportSize = useCallback((index: number, size: { w: number; h: number } | null) => {
    setVideoFiles((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], exportSize: size }
      return next
    })
  }, [])

  const getExportDims = (v: VideoWithDims) =>
    v.exportSize ?? (v.detecting ? { w: FALLBACK_WIDTH, h: FALLBACK_HEIGHT } : { w: v.width, h: v.height })

  const addNamePart = useCallback(() => {
    setNameParts((p) => [...p, { id: nextId(), type: 'filename' }])
  }, [])

  const removeNamePart = useCallback((id: string) => {
    setNameParts((p) => (p.length > 1 ? p.filter((x) => x.id !== id) : p))
  }, [])

  const updateNamePartType = useCallback((id: string, type: NamePartType) => {
    setNameParts((p) => p.map((x) => (x.id === id ? { ...x, type } : x)))
  }, [])

  const moveNamePart = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    setNameParts((p) => {
      const next = [...p]
      const [removed] = next.splice(fromIndex, 1)
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
      next.splice(insertAt, 0, removed)
      return next
    })
  }, [])

  const handlePartDragStart = useCallback((id: string) => {
    setDraggedPartId(id)
  }, [])

  const handlePartDragEnd = useCallback(() => {
    setDraggedPartId(null)
  }, [])

  const handlePartDrop = useCallback(
    (targetId: string) => {
      if (!draggedPartId || draggedPartId === targetId) return
      const fromIdx = nameParts.findIndex((p) => p.id === draggedPartId)
      const toIdx = nameParts.findIndex((p) => p.id === targetId)
      if (fromIdx >= 0 && toIdx >= 0) moveNamePart(fromIdx, toIdx)
      setDraggedPartId(null)
    },
    [draggedPartId, nameParts, moveNamePart],
  )

  const folderGroups = useMemo(() => {
    const groups = new Map<string, { index: number; video: VideoWithDims }[]>()
    videoFiles.forEach((v, i) => {
      const path = (v.file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
      const folder = path ? path.split('/').slice(0, -1).join('/') || 'Root' : 'Selected files'
      if (!groups.has(folder)) groups.set(folder, [])
      groups.get(folder)!.push({ index: i, video: v })
    })
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [videoFiles])

  const { iabMatchCount, iabTotalCount } = useMemo(() => {
    let match = 0
    videoFiles.forEach((v) => {
      if (v.detecting) return
      const { w, h } = getExportDims(v)
      if (isIabSize(w, h)) match++
    })
    const total = videoFiles.filter((v) => !v.detecting).length
    return { iabMatchCount: match, iabTotalCount: total }
  }, [videoFiles])

  const filteredFolderGroups = useMemo(() => {
    if (!showIssuesOnly || iabTotalCount === 0) return folderGroups
    return folderGroups
      .map(([folder, items]) => [
        folder,
        items.filter(({ video: v }) => !isIabSize(getExportDims(v).w, getExportDims(v).h)),
      ])
      .filter(([, items]) => items.length > 0) as [string, { index: number; video: VideoWithDims }[]][]
  }, [folderGroups, showIssuesOnly, iabTotalCount])

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
          const v = videoFiles[i]
          const { w, h } = getExportDims(v)
          setExportProgress(`${i + 1} / ${videoFiles.length}: ${v.file.name} (${w}×${h})`)
          const arrayBuffer = await v.file.arrayBuffer()
          const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
          const ext = v.file.name.endsWith('.mp4') ? 'mp4' : 'mp4'
          const assetName = `video.${ext}`
          const bodyContent = `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    <video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>
  </div>`
          const html = buildPlatformHtml(platform, {
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
          const path = (v.file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
          const folder = path ? path.split('/').slice(0, -1).join('/') : ''
          const base = buildNameFromParts(
            nameParts.map((p) => p.type),
            nameSeparator,
            {
              filename: sanitizeZipName(v.file.name),
              width: w,
              height: h,
              folder,
            },
          )
          let zipName = `${base}.zip`
          if (usedNames.has(zipName)) {
            let n = 1
            while (usedNames.has(`${base}-${n}.zip`)) n++
            zipName = `${base}-${n}.zip`
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
        const v = videoFiles[0]
        const { w, h } = getExportDims(v)
        const arrayBuffer = await v.file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
        const ext = v.file.name.endsWith('.mp4') ? 'mp4' : 'mp4'
        const assetName = `video.${ext}`
        const bodyContent = `
  <div style="position:relative;width:100%;height:100%;cursor:pointer;">
    <video id="video1" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"></video>
  </div>`
        const html = buildPlatformHtml(platform, {
          width: w,
          height: h,
          clickUrl,
          bodyContent,
          extraStyles: 'cursor:pointer;',
          videoAssetName: assetName,
        })
        const path = (v.file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
        const folder = path ? path.split('/').slice(0, -1).join('/') : ''
        const downloadName = buildNameFromParts(
          nameParts.map((p) => p.type),
          nameSeparator,
          {
            filename: sanitizeZipName(v.file.name),
            width: w,
            height: h,
            folder,
          },
        )
        await exportToCM360({
          width: w,
          height: h,
          clickUrl,
          html,
          assets: [{ name: assetName, data: blob }],
          downloadName,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }, [videoFiles, isBulk, clickUrl, nameParts, nameSeparator, platform])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">MP4 Converter</h1>
      <p className="text-slate-400">
        Bulk upload MP4s or select a folder to find all videos in subfolders. Choose your platform for
        platform-specific output (CM360 uses Enabler; TTD/Amazon/StackAdapt use clickTAG). Dimensions
        auto-detect; override per video if needed.
      </p>

      <div className="flex flex-wrap gap-6">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-400">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-400">Click URL</span>
          <input
            type="url"
            value={clickUrl}
            onChange={(e) => setClickUrl(e.target.value)}
            className="w-56 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-400">Export name</span>
          <div className="flex flex-wrap items-center gap-2">
            {nameParts.map((part) => (
              <div
                key={part.id}
                draggable
                onDragStart={(e) => {
                  handlePartDragStart(part.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', part.id)
                }}
                onDragEnd={handlePartDragEnd}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handlePartDrop(part.id)
                }}
                className={`flex cursor-grab items-center gap-1 rounded border bg-slate-800 active:cursor-grabbing ${
                  draggedPartId === part.id
                    ? 'border-sky-500 opacity-50'
                    : 'border-slate-600'
                }`}
              >
                <span
                  className="select-none px-1.5 py-1 text-slate-500 hover:text-slate-400"
                  title="Drag to reorder"
                  aria-hidden
                >
                  ⋮⋮
                </span>
                <select
                  value={part.type}
                  onChange={(e) => updateNamePartType(part.id, e.target.value as NamePartType)}
                  className="border-0 bg-slate-800 py-1.5 pr-6 pl-1 text-sm text-white focus:ring-0 [&>option]:bg-slate-800 [&>option]:text-white"
                >
                  {NAME_PART_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeNamePart(part.id)}
                  disabled={nameParts.length <= 1}
                  className="px-1.5 py-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:hover:text-slate-500"
                  aria-label="Remove part"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addNamePart}
              className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-500 hover:border-slate-500 hover:text-slate-400"
            >
              + Add
            </button>
            <span className="text-slate-600">sep</span>
            <select
              value={nameSeparator}
              onChange={(e) => setNameSeparator(e.target.value)}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            >
              {SEPARATOR_OPTIONS.map((opt) => (
                <option key={opt.value || 'none'} value={opt.value} className="bg-slate-800 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-slate-500">
            Drag to reorder · Example: {buildNameFromParts(nameParts.map((p) => p.type), nameSeparator, { filename: 'video', width: 300, height: 250, folder: 'campaign_a' })}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer flex-col items-start gap-1">
            <span className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
              {videoFiles.length ? 'Add more MP4s' : 'Select MP4 files'}
            </span>
            <span className="text-xs text-slate-500">
              {videoFiles.length ? 'Select additional videos' : 'You can select multiple files at once'}
            </span>
            <input
              type="file"
              accept="video/mp4,video/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          <label className="flex cursor-pointer flex-col items-start gap-1">
            <span className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
              Select folder
            </span>
            <span className="text-xs text-slate-500">
              Recursively finds all MP4s in folder and subfolders
            </span>
            <input
              type="file"
              {...{ webkitdirectory: '' }}
              multiple
              onChange={handleFolderChange}
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

        {videoFiles.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-400">
                  Preview{videoFiles.length > 1 ? 's' : ''} (sized to match CM360 creatives)
                </p>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    iabMatchCount === iabTotalCount
                      ? 'bg-emerald-900/50 text-emerald-400'
                      : 'bg-amber-900/50 text-amber-400'
                  }`}
                >
                  IAB standard: {iabMatchCount}/{iabTotalCount}
                </span>
                {iabTotalCount > 0 && iabMatchCount < iabTotalCount && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={showIssuesOnly}
                      onChange={(e) => setShowIssuesOnly(e.target.checked)}
                      className="rounded border-slate-600"
                    />
                    Show issues only
                  </label>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-4">
              {(showIssuesOnly ? filteredFolderGroups : folderGroups).map(([folder, items]) => (
                <div key={folder} className="rounded border border-slate-600 bg-slate-800/30 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-400">{folder}</p>
                  <div className="flex flex-wrap gap-3">
                    {items.map(({ index, video: v }) => {
                      const exportDims = getExportDims(v)
                      const matchesIab = isIabSize(exportDims.w, exportDims.h)
                      const { w, h } = scaledPreviewSize(exportDims.w, exportDims.h, PREVIEW_MAX_SIZE)
                      return (
                        <div key={index} className="relative flex flex-col gap-1">
                          <div
                            className={`absolute left-1 top-1 z-10 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              matchesIab
                                ? 'bg-emerald-600/90 text-white'
                                : 'bg-amber-600/90 text-white'
                            }`}
                            title={matchesIab ? 'IAB standard size' : 'Non-IAB size'}
                          >
                            {matchesIab ? 'IAB' : 'Custom'}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="absolute -right-1 -top-1 z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-600 bg-slate-800 text-slate-500 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-500"
                            aria-label={`Remove ${v.file.name}`}
                            title="Remove"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                          <div
                            className="overflow-hidden rounded border border-slate-600 bg-black"
                            style={{ width: w, height: h }}
                          >
                            <video
                              src={v.url}
                              muted
                              loop
                              playsInline
                              autoPlay
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <span className="truncate text-xs text-slate-500" title={v.file.name}>
                            {v.file.name}
                          </span>
                          <select
                            value={v.exportSize ? `${v.exportSize.w}x${v.exportSize.h}` : 'detected'}
                            onChange={(e) => {
                              const val = e.target.value
                              if (val === 'detected') {
                                setExportSize(index, null)
                              } else {
                                const [ww, hh] = val.split('x').map(Number)
                                setExportSize(index, { w: ww, h: hh })
                              }
                            }}
                            disabled={v.detecting}
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white [&>option]:bg-slate-800 [&>option]:text-white"
                          >
                            <option value="detected" className="bg-slate-800 text-white">
                              {v.detecting ? 'Detecting…' : `Use detected (${v.width}×${v.height})`}
                            </option>
                            {EXPORT_PRESETS.map((p) => (
                              <option key={p.label} value={`${p.w}x${p.h}`} className="bg-slate-800 text-white">
                                {p.label}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const path = (v.file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
                            const folder = path ? path.split('/').slice(0, -1).join('/') : ''
                            const exportName =
                              buildNameFromParts(nameParts.map((p) => p.type), nameSeparator, {
                                filename: sanitizeZipName(v.file.name),
                                width: exportDims.w,
                                height: exportDims.h,
                                folder,
                              }) + '.zip'
                            return (
                              <span
                                className="min-w-0 truncate rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                                title={exportName}
                              >
                                {exportName}
                              </span>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
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
