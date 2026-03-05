import JSZip from 'jszip'

export type Platform = 'cm360' | 'ttd' | 'amazon-dsp' | 'stackadapt'

export const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'cm360', label: 'Campaign Manager 360' },
  { value: 'ttd', label: 'The Trade Desk' },
  { value: 'amazon-dsp', label: 'Amazon DSP' },
  { value: 'stackadapt', label: 'StackAdapt' },
]

export interface CM360ExportConfig {
  width: number
  height: number
  clickUrl?: string
  html: string
  assets?: { name: string; data: Blob | string }[]
  /** Override download filename (without .zip). Default: banner-{width}x{height} */
  downloadName?: string
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
  const filename = config.downloadName
    ? `${config.downloadName}.zip`
    : `banner-${config.width}x${config.height}.zip`
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

interface HtmlBuildConfig {
  width: number
  height: number
  clickUrl?: string
  bodyContent: string
  extraStyles?: string
  videoAssetName?: string
}

/** TTD/Amazon/StackAdapt: clickTAG from URL param, direct video src */
function buildStandardHtml(config: HtmlBuildConfig): string {
  const defaultClick = config.clickUrl || 'https://www.example.com'
  const escapedClick = defaultClick.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
  const hasVideo = !!config.videoAssetName
  const assetName = config.videoAssetName || 'video.mp4'
  const mediaContent = hasVideo
    ? `<video autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;"><source src="${assetName}" type="video/mp4"></video>`
    : config.bodyContent

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
  <div style="position:relative;width:100%;height:100%;cursor:pointer;" id="ad-container">
    <div style="position:relative;width:100%;height:100%;">
      ${mediaContent}
    </div>
  </div>
  <script type="text/javascript">
    (function(){
      function getParam(n){var r=new RegExp("[\\?&]"+n+"=([^&#]*)"),t=r.exec(location.search);return t?decodeURIComponent(t[1].replace(/\\+/g," ")):"";}
      window.clickTAG=getParam("clickTAG")||getParam("clickTag")||"${escapedClick}";
      document.getElementById("ad-container").onclick=function(){if(window.clickTAG)window.open(window.clickTAG,"_blank");};
    })();
  </script>
</body>
</html>`
}

export function buildPlatformHtml(platform: Platform, config: HtmlBuildConfig): string {
  if (platform === 'cm360') return buildCM360Html(config)
  if (platform === 'ttd' || platform === 'amazon-dsp' || platform === 'stackadapt') {
    return buildStandardHtml(config)
  }
  return buildCM360Html(config)
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
