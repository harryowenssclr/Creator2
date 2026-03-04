import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text as KonvaText,
  Rect,
} from 'react-konva'
import { exportToCM360, buildCM360Html } from '../../services/cm360Export'

const DIMENSION_PRESETS = [
  { w: 300, h: 250, label: '300×250' },
  { w: 300, h: 600, label: '300×600' },
  { w: 728, h: 90, label: '728×90' },
  { w: 160, h: 600, label: '160×600' },
  { w: 970, h: 250, label: '970×250' },
  { w: 320, h: 50, label: '320×50' },
]

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

export default function ManualEditor() {
  const [width, setWidth] = useState(300)
  const [height, setHeight] = useState(250)
  const [elements, setElements] = useState<CanvasElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
        const maxDim = 150
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w > maxDim || h > maxDim) {
          const r = Math.min(maxDim / w, maxDim / h)
          w *= r
          h *= r
        }
        setElements((prev) => [
          ...prev,
          {
            id: `img-${Date.now()}-${i}`,
            type: 'image',
            x: 20,
            y: 20 + prev.length * 30,
            width: w,
            height: h,
            src: url,
            draggable: true,
          } as CanvasElement,
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
              const newEl: CanvasElement = {
                id: `img-${Date.now()}-${i}`,
                type: 'image',
                x: 20,
                y: 20,
                width: w,
                height: h,
                src: thumbUrl,
                draggable: true,
              }
              setElements((prev) => [...prev, newEl])
            }
          }
        }
        video.src = url
      }
    }
    e.target.value = ''
  }, [])

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Manual Editor</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Click URL:</label>
            <input
              type="url"
              value={clickUrl}
              onChange={(e) => setClickUrl(e.target.value)}
              className="w-48 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white"
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

      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-400">Dimensions</span>
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
        <div className="flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">
            Upload Images/Video
            <input
              type="file"
              accept="image/*,video/mp4"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setShowTextForm(!showTextForm)}
            className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
          >
            Add Text
          </button>
        </div>
      </div>

      {showTextForm && (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
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

      <div className="flex gap-6">
        <div className=" rounded-lg border border-slate-700 bg-slate-900 p-4">
          <Stage
            ref={stageRef}
            width={width + 40}
            height={height + 40}
            onClick={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null)
            }}
            onTap={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null)
            }}
          >
            <Layer>
              <Rect
                x={0}
                y={0}
                width={width + 40}
                height={height + 40}
                fill="#1e293b"
              />
              <Rect
                x={20}
                y={20}
                width={width}
                height={height}
                fill="#0f172a"
                stroke="#334155"
                strokeWidth={1}
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

        <div className="w-56 shrink-0">
          <h3 className="mb-2 text-sm font-medium text-slate-300">Layers</h3>
          <div className="flex flex-col gap-1">
            {[...elements].reverse().map((el) => (
              <div
                key={el.id}
                className={`flex items-center justify-between rounded border px-2 py-1.5 ${
                  selectedId === el.id
                    ? 'border-sky-500 bg-slate-700'
                    : 'border-slate-700 bg-slate-800'
                }`}
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
                    onClick={() => moveLayer(el.id, 'up')}
                    className="rounded p-0.5 text-xs text-slate-400 hover:bg-slate-600 hover:text-white"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveLayer(el.id, 'down')}
                    className="rounded p-0.5 text-xs text-slate-400 hover:bg-slate-600 hover:text-white"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => deleteElement(el.id)}
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
      x={20 + element.x}
      y={20 + element.y}
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
      x={20 + element.x}
      y={20 + element.y}
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
