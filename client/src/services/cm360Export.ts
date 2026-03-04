import JSZip from 'jszip'

export interface CM360ExportConfig {
  width: number
  height: number
  clickUrl?: string
  html: string
  assets?: { name: string; data: Blob | string }[]
}

const CM360_MAX_FILES = 100
const CM360_MAX_SIZE_MB = 10

function sanitizeFilename(name: string): string {
  return name.replace(/%/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function exportToCM360(config: CM360ExportConfig): Promise<void> {
  const zip = new JSZip()

  zip.file('index.html', config.html, { binary: false })

  if (config.assets) {
    for (const asset of config.assets) {
      const safeName = sanitizeFilename(asset.name)
      zip.file(safeName, asset.data)
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const sizeMB = blob.size / (1024 * 1024)
  const fileCount = Object.keys((zip as any).files).length

  if (fileCount > CM360_MAX_FILES) {
    throw new Error(`Export exceeds ${CM360_MAX_FILES} files (has ${fileCount})`)
  }
  if (sizeMB > CM360_MAX_SIZE_MB) {
    throw new Error(
      `Export exceeds ${CM360_MAX_SIZE_MB} MB (has ${sizeMB.toFixed(2)} MB)`,
    )
  }

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `banner-${config.width}x${config.height}.zip`
  link.click()
  URL.revokeObjectURL(link.href)
}

export function buildCM360Html(config: {
  width: number
  height: number
  clickUrl?: string
  bodyContent: string
  extraStyles?: string
}): string {
  const clickUrl = config.clickUrl || 'https://www.example.com'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="ad.size" content="width=${config.width},height=${config.height}">
  <title>Banner Ad</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    ${config.extraStyles || ''}
  </style>
</head>
<body>
  ${config.bodyContent}
  <script>
    var clickTag = "${clickUrl.replace(/"/g, '\\"')}";
    document.addEventListener('click', function() {
      window.open(clickTag, '_blank');
    });
  </script>
</body>
</html>`
}
