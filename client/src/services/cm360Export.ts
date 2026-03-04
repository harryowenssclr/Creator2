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

/** Creates a CM360 creative zip blob (for single download or bulk bundling). */
export async function createCM360ZipBlob(config: CM360ExportConfig): Promise<Blob> {
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

  return blob
}

export async function exportToCM360(config: CM360ExportConfig): Promise<void> {
  const blob = await createCM360ZipBlob(config)
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
  /** When set, video src is loaded via Enabler.getUrl (required for CM360 video creatives) */
  videoAssetName?: string
}): string {
  const clickUrl = config.clickUrl || 'https://www.example.com'
  const exitName = 'Background Exit'
  const hasVideo = !!config.videoAssetName

  // CM360 requires: Enabler script, exit events (no click tags), Enabler.getUrl for video
  const initScript = hasVideo
    ? `
  (function() {
    function getVideoUrl(filename) {
      if (Enabler.isServingInLiveEnvironment()) {
        return Enabler.getUrl(filename);
      }
      return filename;
    }
    function initAd() {
      var video = document.getElementById('video1');
      if (video) {
        var source = document.createElement('source');
        source.setAttribute('src', getVideoUrl("${config.videoAssetName!.replace(/"/g, '\\"')}"));
        source.setAttribute('type', 'video/mp4');
        video.appendChild(source);
        video.play();
      }
      document.addEventListener('click', function() {
        Enabler.exitOverride("${exitName.replace(/"/g, '\\"')}", "${clickUrl.replace(/"/g, '\\"')}");
      });
    }
    if (Enabler.isInitialized()) {
      initAd();
    } else {
      Enabler.addEventListener(studio.events.StudioEvent.INIT, initAd);
    }
  })();
`
    : `
  (function() {
    function initAd() {
      document.addEventListener('click', function() {
        Enabler.exitOverride("${exitName.replace(/"/g, '\\"')}", "${clickUrl.replace(/"/g, '\\"')}");
      });
    }
    if (Enabler.isInitialized()) {
      initAd();
    } else {
      Enabler.addEventListener(studio.events.StudioEvent.INIT, initAd);
    }
  })();
`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="ad.size" content="width=${config.width},height=${config.height}">
  <title>Banner Ad</title>
  <script src="https://s0.2mdn.net/ads/studio/Enabler.js" type="text/javascript"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    ${config.extraStyles || ''}
  </style>
</head>
<body>
  ${config.bodyContent}
  <script type="text/javascript">
    window.onload = function() {${initScript}
    };
  </script>
</body>
</html>`
}
