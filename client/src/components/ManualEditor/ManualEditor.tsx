import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text as KonvaText,
  Rect,
} from 'react-konva'
import { exportToCM360, buildCM360Html } from '../../services/cm360Export'

const DEFAULT_DIMENSION_PRESETS = [
  { w: 300, h: 250, label: '300×250' },
  { w: 300, h: 600, label: '300×600' },
  { w: 728, h: 90, label: '728×90' },
  { w: 160, h: 600, label: '160×600' },
  { w: 970, h: 250, label: '970×250' },
  { w: 320, h: 50, label: '320×50' },
]

export type Asset = {
  id: string
  src: string
  name: string
  width: number
  height: number
}

export type CanvasElement =
  | {
      id: string
      type: 'image'
      x: number
      y: number
      width: number
      height: number
      src: string
      draggable: boolean
    }
  | {
      id: string
      type: 'text'
      x: number
      y: number
      width: number
      height: number
      text: string
      fontSize: number
      fontFamily: string
      fill: string
      draggable: boolean
    }

const ASSET_PREVIEW_SIZE = 64
const ASSET_CANVAS_MAX = 150

export type ManualEditorProps = {
  initialAssets?: Array<{ src: string; name: string; width: number; height: number }>
  initialDimensions?: { width: number; height: number }
  dimensionPresets?: Array<{ w: number; h: number; label: string }>
  title?: string
}

export default function ManualEditor(props: ManualEditorProps = {}) {
  const {
    initialAssets = [],
    initialDimensions,
    dimensionPresets = DEFAULT_DIMENSION_PRESETS,
    title = 'Manual Editor',
  } = props

  const [width, setWidth] = useState(initialDimensions?.width ?? 300)
  const [height, setHeight] = useState(initialDimensions?.height ?? 250)
  const [assets, setAssets] = useState<Asset[]>([])
  const [elements, setElements] = useState<CanvasElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (initialAssets.length === 0) return
    const loaded: Asset[] = []
    let pending = initialAssets.length
    initialAssets.forEach((a, i) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        loaded.push({
          id: `asset-init-${i}-${Date.now()}`,
          src: a.src,
          name: a.name,
          width: a.width || img.naturalWidth,
          height: a.height || img.naturalHeight,
        })
        pending--
        if (pending === 0) setAssets((prev) => [...loaded, ...prev])
      }
      img.onerror = () => {
        pending--
        if (pending === 0 && loaded.length > 0) setAssets((prev) => [...loaded, ...prev])
      }
      img.src = a.src
    })
  }, [initialAssets])
  const [clickUrl, setClickUrl] = useState('https://www.example.com')
  const [showTextForm, setShowTextForm] = useState(false)
  const [newText, setNewText] = useState('')
  const [newFontSize, setNewFontSize] = useState(24)
  const [newColor, setNewColor] = useState('#ffffff')
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const stageRef = useRef(null)

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const type = file.type
      if (!type.startsWith('image/') && !type.startsWith('video/')) continue
      const url = URL.createObjectURL(file)
      const img = new window.Image()
      img.onload = () => {
        let w = img.naturalWidth
        let h = img.naturalHeight
        setAssets((prev) => [
          ...prev,
          {
            id: `asset-${Date.now()}-${i}`,
            src: url,
            name: file.name,
            width: w,
            height: h,
          },
        ])
      }
      if (type.startsWith('image/')) {
        img.src = url
      } else if (type.startsWith('video/')) {
        const video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.onloadeddata = () => {
          const w = Math.min(video.videoWidth || 200, 200)
          const h = Math.min(video.videoHeight || 200, 200)
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) {
            video.currentTime = 0.1
            video.onseeked = () => {
              ctx.drawImage(video, 0, 0, w, h)
              const thumbUrl = canvas.toDataURL('image/png')
              setAssets((prev) => [
                ...prev,
                {
                  id: `asset-${Date.now()}-${i}`,
                  src: thumbUrl,
                  name: file.name,
                  width: w,
                  height: h,
                },
              ])
            }
          }
        }
        video.src = url
      }
    }
    e.target.value = ''
  }, [])

  const addAssetToCanvas = useCallback((asset: Asset, canvasX: number, canvasY: number) => {
    const maxDim = ASSET_CANVAS_MAX
    let w = asset.width
    let h = asset.height
    if (w > maxDim || h > maxDim) {
      const r = Math.min(maxDim / w, maxDim / h)
      w *= r
      h *= r
    }
    setElements((prev) => [
      ...prev,
      {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: 'image',
        x: Math.max(0, Math.min(canvasX - w / 2, width - w)),
        y: Math.max(0, Math.min(canvasY - h / 2, height - h)),
        width: w,
        height: h,
        src: asset.src,
        draggable: true,
      } as CanvasElement,
    ])
  }, [width, height])

  const stageContainerRef = useRef<HTMLDivElement>(null)

  const handleStageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const STAGE_PADDING = 24
  const STAGE_INNER_OFFSET = 24

  const handleStageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const assetId = e.dataTransfer.getData('application/x-asset-id')
      if (!assetId || !stageContainerRef.current) return
      const asset = assets.find((a) => a.id === assetId)
      if (!asset) return
      const rect = stageContainerRef.current.getBoundingClientRect()
      const canvasX = e.clientX - rect.left - STAGE_PADDING - STAGE_INNER_OFFSET
      const canvasY = e.clientY - rect.top - STAGE_PADDING - STAGE_INNER_OFFSET
      addAssetToCanvas(asset, canvasX, canvasY)
    },
    [assets, addAssetToCanvas],
  )

  const addText = useCallback(() => {
    if (!newText.trim()) return
    setElements((prev) => [
      ...prev,
      {
        id: `text-${Date.now()}`,
        type: 'text',
        x: 20,
        y: 20 + prev.length * 30,
        width: 200,
        height: 30,
        text: newText,
        fontSize: newFontSize,
        fontFamily: 'Arial',
        fill: newColor,
        draggable: true,
      } as CanvasElement,
    ])
    setNewText('')
    setShowTextForm(false)
  }, [newText, newFontSize, newColor])

  const updateElement = useCallback((id: string, attrs: Partial<CanvasElement>) => {
    setElements((prev) =>
      prev.map((el) =>
        el.id === id ? ({ ...el, ...attrs } as CanvasElement) : el,
      ),
    )
  }, [])

  const deleteElement = useCallback((id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id))
    if (selectedId === id) setSelectedId(null)
  }, [selectedId])

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id)
      if (idx < 0) return prev
      const arr = [...prev]
      const swap = direction === 'up' ? idx + 1 : idx - 1
      if (swap < 0 || swap >= arr.length) return prev
      ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
      return arr
    })
  }, [])

  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)

  const reorderLayer = useCallback((draggedId: string, targetId: string) => {
    setElements((prev) => {
      const fromIdx = prev.findIndex((el) => el.id === draggedId)
      const toIdx = prev.findIndex((el) => el.id === targetId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const arr = [...prev]
      const [item] = arr.splice(fromIdx, 1)
      const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
      arr.splice(insertIdx, 0, item)
      return arr
    })
    setDraggedLayerId(null)
  }, [])

  const handleExport = useCallback(async () => {
    setExportError(null)
    if (elements.length === 0) {
      setExportError('Add at least one image or text to export')
      return
    }
    setExporting(true)
    try {
      const imageElements = elements.filter((e): e is Extract<CanvasElement, { type: 'image' }> => e.type === 'image')
      const textElements = elements.filter((e): e is Extract<CanvasElement, { type: 'text' }> => e.type === 'text')

      const assets: { name: string; data: Blob | string }[] = []
      const imageRefs: Record<string, string> = {}

      for (let i = 0; i < imageElements.length; i++) {
        const el = imageElements[i]
        let blob: Blob
        let ext = 'jpg'
        if (el.src.startsWith('data:')) {
          const m = el.src.match(/data:([^;]+);base64,(.+)/)
          const mime = m?.[1] || 'image/png'
          ext = mime.includes('png') ? 'png' : 'jpg'
          const b64 = m?.[2] || ''
          const binary = atob(b64)
          const bytes = new Uint8Array(binary.length)
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
          blob = new Blob([bytes], { type: mime })
        } else {
          const response = await fetch(el.src)
          blob = await response.blob()
          ext = blob.type.includes('png') ? 'png' : 'jpg'
        }
        const name = `asset_${i}.${ext}`
        imageRefs[el.id] = name
        assets.push({ name, data: blob })
      }

      const bodyParts: string[] = []
      bodyParts.push('<div style="position:relative;width:100%;height:100%;cursor:pointer;">')

      for (const el of imageElements) {
        const ref = imageRefs[el.id]
        bodyParts.push(
          `<img src="${ref}" style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;" alt="">`,
        )
      }
      for (const el of textElements) {
        bodyParts.push(
          `<div style="position:absolute;left:${el.x}px;top:${el.y}px;font-size:${el.fontSize}px;font-family:${el.fontFamily},sans-serif;color:${el.fill};white-space:nowrap;">${el.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
        )
      }
      bodyParts.push('</div>')

      const html = buildCM360Html({
        width,
        height,
        clickUrl,
        bodyContent: bodyParts.join(''),
        extraStyles: 'cursor:pointer;',
      })

      await exportToCM360({
        width,
        height,
        clickUrl,
        html,
        assets,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [elements, width, height, clickUrl])

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Click URL:</label>
            <input
              type="url"
              value={clickUrl}
              onChange={(e) => setClickUrl(e.target.value)}
              className="w-64 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              placeholder="https://..."
            />
          </div>
          {exportError && (
            <span className="text-sm text-red-400">{exportError}</span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CM360 ZIP'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-8">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-400">Dimensions</span>
          <div className="flex flex-wrap gap-3">
            {dimensionPresets.map(({ w, h, label }) => (
              <button
                key={label}
                onClick={() => {
                  setWidth(w)
                  setHeight(h)
                }}
                className={`rounded px-4 py-2 text-sm ${
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
        <div className="flex gap-4">
          <label className="flex cursor-pointer flex-col items-start gap-1">
            <span className="rounded bg-slate-700 px-5 py-2.5 text-sm text-white hover:bg-slate-600">
              Upload Images/Video
            </span>
            <span className="text-xs text-slate-500">Select files</span>
            <input
              type="file"
              accept="image/*,video/mp4"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <label className="flex cursor-pointer flex-col items-start gap-1">
            <span className="rounded bg-slate-700 px-5 py-2.5 text-sm text-white hover:bg-slate-600">
              Select folder
            </span>
            <span className="text-xs text-slate-500">Recursively finds images and videos</span>
            <input
              type="file"
              {...{ webkitdirectory: '' }}
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setShowTextForm(!showTextForm)}
            className="self-end rounded bg-slate-700 px-5 py-2.5 text-sm text-white hover:bg-slate-600"
          >
            Add Text
          </button>
        </div>
      </div>

      {showTextForm && (
        <div className="flex flex-wrap items-end gap-6 rounded-xl border border-slate-700 bg-slate-800/50 p-6">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Text</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Enter text..."
              className="w-48 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Size</label>
            <input
              type="number"
              value={newFontSize}
              onChange={(e) => setNewFontSize(Number(e.target.value) || 12)}
              min={8}
              max={72}
              className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Color</label>
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-slate-600"
            />
          </div>
          <button
            onClick={addText}
            className="rounded bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500"
          >
            Add
          </button>
        </div>
      )}

      <div className="flex min-h-[420px] max-h-[calc(100vh-14rem)] flex-1 gap-8 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col gap-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="shrink-0 text-sm font-medium text-slate-300">Assets</h3>
          <div className="flex min-h-0 flex-1 flex-wrap content-start gap-3 overflow-y-auto overflow-x-hidden overscroll-contain">
            {assets.length === 0 ? (
              <p className="text-xs leading-relaxed text-slate-500">
                Upload images or a folder to add assets. Drag onto canvas to place.
              </p>
            ) : (
              assets.map((asset) => (
                <AssetThumb
                  key={asset.id}
                  asset={asset}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-asset-id', asset.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                />
              ))
            )}
          </div>
        </div>
        <div
          ref={stageContainerRef}
          onDragOver={handleStageDragOver}
          onDrop={handleStageDrop}
          className="flex flex-1 items-start justify-start rounded-xl border border-slate-700 bg-slate-900 p-6"
        >
          <Stage
            ref={stageRef}
            width={width + 48}
            height={height + 48}
            onClick={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null)
            }}
            onTap={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null)
            }}
          >
            <Layer>
              {/* Outside area — pasteboard, not exported; dark muted fill */}
              <Rect
                x={0}
                y={0}
                width={width + 48}
                height={height + 48}
                fill="#1e293b"
                stroke="#334155"
                strokeWidth={1}
                dash={[6, 4]}
                listening={false}
              />
              {/* Banner — clear export area: fill, bright border, dimension label */}
              <Rect
                x={24}
                y={24}
                width={width}
                height={height}
                fill="#0f172a"
                stroke="#38bdf8"
                strokeWidth={2}
                listening={false}
              />
              <KonvaText
                x={28}
                y={28}
                text={`${width}×${height}`}
                fontSize={11}
                fontFamily="sans-serif"
                fill="#e2e8f0"
                listening={false}
              />
              {elements.map((el) => {
                if (el.type === 'image') {
                  return (
                    <ImageElement
                      key={el.id}
                      element={el}
                      isSelected={selectedId === el.id}
                      onSelect={() => setSelectedId(el.id)}
                      onDragEnd={(e) =>
                        updateElement(el.id, {
                          x: e.target.x(),
                          y: e.target.y(),
                        })
                      }
                    />
                  )
                }
                return (
                  <TextElement
                    key={el.id}
                    element={el}
                    isSelected={selectedId === el.id}
                    onSelect={() => setSelectedId(el.id)}
                    onDragEnd={(e) =>
                      updateElement(el.id, {
                        x: e.target.x(),
                        y: e.target.y(),
                      })
                    }
                  />
                )
              })}
            </Layer>
          </Stage>
        </div>

        <div className="flex w-64 shrink-0 flex-col overflow-hidden">
          <h3 className="mb-3 shrink-0 text-sm font-medium text-slate-300">Layers</h3>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
            {[...elements].reverse().map((el) => (
              <div
                key={el.id}
                draggable
                onDragStart={(e) => {
                  setDraggedLayerId(el.id)
                  e.dataTransfer.setData('application/x-layer-id', el.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const draggedId = e.dataTransfer.getData('application/x-layer-id')
                  if (draggedId && draggedId !== el.id) reorderLayer(draggedId, el.id)
                }}
                onDragEnd={() => setDraggedLayerId(null)}
                className={`flex cursor-grab items-center justify-between rounded-lg border px-3 py-2 transition-opacity active:cursor-grabbing ${
                  selectedId === el.id
                    ? 'border-sky-500 bg-slate-700'
                    : 'border-slate-700 bg-slate-800'
                } ${draggedLayerId === el.id ? 'opacity-50' : ''}`}
              >
                <span
                  className="cursor-pointer truncate text-sm text-white"
                  onClick={() => setSelectedId(el.id)}
                >
                  {el.type === 'text'
                    ? el.text.slice(0, 12) + (el.text.length > 12 ? '…' : '')
                    : 'Image'}
                </span>
                <div className="flex gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayer(el.id, 'up')
                    }}
                    className="rounded p-0.5 text-xs text-slate-400 hover:bg-slate-600 hover:text-white"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayer(el.id, 'down')
                    }}
                    className="rounded p-0.5 text-xs text-slate-400 hover:bg-slate-600 hover:text-white"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteElement(el.id)
                    }}
                    className="rounded p-0.5 text-xs text-red-400 hover:bg-slate-600"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AssetThumb({
  asset,
  onDragStart,
}: {
  asset: Asset
  onDragStart: (e: React.DragEvent) => void
}) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const i = new window.Image()
    i.onload = () => setLoaded(true)
    i.src = asset.src
  }, [asset.src])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex cursor-grab flex-col items-center gap-1 rounded p-2 transition-colors hover:bg-slate-700/40 active:cursor-grabbing"
      title={`${asset.name} — drag to canvas`}
    >
      <div
        className="flex items-center justify-center overflow-hidden rounded-sm bg-slate-800/40"
        style={{ width: ASSET_PREVIEW_SIZE, height: ASSET_PREVIEW_SIZE }}
      >
        {loaded ? (
          <img
            src={asset.src}
            alt={asset.name}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-xs text-slate-500">…</span>
        )}
      </div>
      <span className="max-w-full truncate text-xs text-slate-400" title={asset.name}>
        {asset.name}
      </span>
    </div>
  )
}

function ImageElement({
  element,
  isSelected,
  onSelect,
  onDragEnd,
}: {
  element: Extract<CanvasElement, { type: 'image' }>
  isSelected: boolean
  onSelect: () => void
  onDragEnd: (e: { target: { x: () => number; y: () => number } }) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const i = new window.Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.src = element.src
  }, [element.src])

  if (!img) return null

  return (
    <KonvaImage
      id={element.id}
      image={img}
      x={24 + element.x}
      y={24 + element.y}
      width={element.width}
      height={element.height}
      draggable={element.draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      stroke={isSelected ? '#38bdf8' : undefined}
      strokeWidth={isSelected ? 2 : 0}
    />
  )
}

function TextElement({
  element,
  isSelected,
  onSelect,
  onDragEnd,
}: {
  element: Extract<CanvasElement, { type: 'text' }>
  isSelected: boolean
  onSelect: () => void
  onDragEnd: (e: { target: { x: () => number; y: () => number } }) => void
}) {
  return (
    <KonvaText
      id={element.id}
      x={24 + element.x}
      y={24 + element.y}
      text={element.text}
      fontSize={element.fontSize}
      fontFamily={element.fontFamily}
      fill={element.fill}
      draggable={element.draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      stroke={isSelected ? '#38bdf8' : undefined}
      strokeWidth={isSelected ? 1 : 0}
    />
  )
}
