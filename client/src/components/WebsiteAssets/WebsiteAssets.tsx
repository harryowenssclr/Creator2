import { useState, useCallback } from 'react'
import axios from 'axios'

type Asset = {
  type: string
  url: string
}

export default function WebsiteAssets() {
  const [url, setUrl] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')

  const handleScrape = useCallback(async () => {
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }
    setLoading(true)
    setError(null)
    setAssets([])
    setSelected(new Set())
    try {
      const { data } = await axios.post('/api/website/scrape', {
        url: url.trim(),
        includeSubdomains: false,
      })
      if (data.ok && Array.isArray(data.assets)) {
        setAssets(data.assets)
      } else {
        setError('No assets found')
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to fetch assets'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [url])

  const toggleSelect = useCallback((assetUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(assetUrl)) next.delete(assetUrl)
      else next.add(assetUrl)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const filtered = getFilteredAssets()
    setSelected(new Set(filtered.map((a) => a.url)))
  }, [assets, filterType])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const downloadSelected = useCallback(() => {
    const urls = Array.from(selected)
    if (urls.length === 0) return
    const a = document.createElement('a')
    a.href = 'data:text/plain,' + encodeURIComponent(urls.join('\n'))
    a.download = 'assets.txt'
    a.click()
  }, [selected])

  const getFilteredAssets = () => {
    if (filterType === 'all') return assets
    return assets.filter((a) => a.type === filterType)
  }

  const filtered = getFilteredAssets()
  const imageTypes = ['image', 'video']
  const canPreview = (a: Asset) => imageTypes.includes(a.type)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Website Assets</h1>
      <p className="text-slate-400">
        Paste a URL to extract images, videos, stylesheets, and fonts from the
        page.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-sm text-slate-400">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <button
          onClick={handleScrape}
          disabled={loading}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Extracting…' : 'Extract Assets'}
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {assets.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Filter:</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
              >
                <option value="all">All ({assets.length})</option>
                <option value="image">
                  Images ({assets.filter((a) => a.type === 'image').length})
                </option>
                <option value="video">
                  Videos ({assets.filter((a) => a.type === 'video').length})
                </option>
                <option value="stylesheet">
                  Stylesheets (
                  {assets.filter((a) => a.type === 'stylesheet').length})
                </option>
                <option value="font">
                  Fonts ({assets.filter((a) => a.type === 'font').length})
                </option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                Select all
              </button>
              <button
                onClick={clearSelection}
                className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                Clear
              </button>
              <button
                onClick={downloadSelected}
                disabled={selected.size === 0}
                className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
              >
                Download URLs ({selected.size})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((asset) => (
              <div
                key={asset.url}
                onClick={() => canPreview(asset) && toggleSelect(asset.url)}
                className={`overflow-hidden rounded-lg border ${
                  selected.has(asset.url)
                    ? 'border-sky-500 ring-2 ring-sky-500/50'
                    : 'border-slate-700 hover:border-slate-600'
                } bg-slate-800/50 transition-colors ${canPreview(asset) ? 'cursor-pointer' : ''}`}
              >
                <div className="aspect-square flex items-center justify-center bg-slate-900 p-2">
                  {asset.type === 'image' ? (
                    <img
                      src={asset.url}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : asset.type === 'video' ? (
                    <video
                      src={asset.url}
                      className="max-h-full max-w-full object-contain"
                      muted
                      preload="metadata"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span className="text-3xl text-slate-500">
                      {asset.type === 'stylesheet' ? '{}' : 'Aa'}
                    </span>
                  )}
                </div>
                <div className="border-t border-slate-700 p-2">
                  <span className="block truncate text-xs text-slate-400">
                    {asset.type}
                  </span>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-xs text-sky-400 hover:text-sky-300"
                  >
                    {(() => {
                      try {
                        const p = new URL(asset.url).pathname
                        return p.length > 30 ? '…' + p.slice(-28) : p
                      } catch {
                        return asset.url.slice(-30)
                      }
                    })()}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
