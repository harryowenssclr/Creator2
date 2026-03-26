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

export type CreateCM360ZipOptions = {
  /**
   * Max output zip size in MB. Omit = {@link CM360_MAX_SIZE_MB} (CM360 trafficing default).
   * Pass a higher number for clickTAG / social bundles. Pass `null` to skip the check.
   */
  maxOutputMb?: number | null
}

/** Creates a CM360 creative zip blob (for single download or bulk bundling). */
export async function createCM360ZipBlob(
  config: CM360ExportConfig,
  options?: CreateCM360ZipOptions,
): Promise<Blob> {
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

  const limitMb =
    options?.maxOutputMb === null ? null
    : options?.maxOutputMb !== undefined ? options.maxOutputMb
    : CM360_MAX_SIZE_MB

  if (limitMb !== null && sizeMB > limitMb) {
    throw new Error(`Export exceeds ${limitMb} MB (has ${sizeMB.toFixed(2)} MB)`)
  }

  return blob
}

/** Reliable browser download (append anchor; works when a bare `click()` is ignored). */
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(link.href), 2500)
}

export async function exportToCM360(
  config: CM360ExportConfig,
  zipOpts?: CreateCM360ZipOptions,
): Promise<void> {
  const blob = await createCM360ZipBlob(config, zipOpts)
  const filename = config.downloadName
    ? `${config.downloadName}.zip`
    : `banner-${config.width}x${config.height}.zip`
  downloadBlobAsFile(blob, filename)
}

export interface HtmlBuildConfig {
  width: number
  height: number
  clickUrl?: string
  bodyContent: string
  extraStyles?: string
  videoAssetName?: string
  /** Appended after `.media-fill` inside `#ad-container` (use position:absolute overlays; pointer-events:none). */
  overlayHtml?: string
  /** Extra CSS merged into the generated `<video>` when `videoAssetName` is set (crop / zoom). */
  mediaInlineStyle?: string
}

/**
 * Portable HTML5 display ad: DOCTYPE, ad.size, clickTAG (IAB-style), fixed creative dimensions.
 * No Studio Enabler — opens locally and works with DSPs that support clickTAG / static zip.
 */
function buildStandardHtml(config: HtmlBuildConfig): string {
  const defaultClick = config.clickUrl || 'https://www.example.com'
  const escapedClick = defaultClick.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
  const hasVideo = !!config.videoAssetName
  const assetName = config.videoAssetName || 'video.mp4'
  const vidStyle = config.mediaInlineStyle || ''
  const mediaContent = hasVideo
    ? `<video autoplay muted loop playsinline preload="metadata" id="banner-video" style="display:block;width:100%;height:100%;object-fit:cover;${vidStyle}"><source src="${assetName}" type="video/mp4"></video>`
    : config.bodyContent

  const w = config.width
  const h = config.height

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="ad.size" content="width=${w},height=${h}">
  <title>HTML5 Banner ${w}×${h}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${w}px;
      height: ${h}px;
      max-width: 100%;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    #ad-container {
      position: relative;
      width: ${w}px;
      height: ${h}px;
      overflow: hidden;
      cursor: pointer;
      background: #000;
    }
    #ad-container .media-fill {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    #ad-container img, #ad-container video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    ${config.extraStyles || ''}
  </style>
</head>
<body>
  <div id="ad-container" role="link" aria-label="Advertisement" tabindex="0">
    <div class="media-fill">
      ${mediaContent}
    </div>
    ${config.overlayHtml || ''}
  </div>
  <script type="text/javascript">
    (function(){
      function getParam(n){var r=new RegExp("[\\?&]"+n+"=([^&#]*)"),t=r.exec(location.search);return t?decodeURIComponent(t[1].replace(/\\+/g," ")):"";}
      var clickUrlResolved = getParam("clickTAG") || getParam("clickTag") || "${escapedClick}";
      window.clickTAG = clickUrlResolved;
      function go(){ if (clickUrlResolved) window.open(clickUrlResolved, "_blank"); }
      var el = document.getElementById("ad-container");
      el.addEventListener("click", go);
      el.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    })();
  </script>
</body>
</html>`
}

/** Alias: standard HTML5 banner document (same as TTD/Amazon/StackAdapt builder in buildPlatformHtml). */
export function buildHtml5StandardBanner(config: HtmlBuildConfig): string {
  return buildStandardHtml(config)
}

export function buildPlatformHtml(platform: Platform, config: HtmlBuildConfig): string {
  if (platform === 'cm360') return buildCM360Html(config)
  if (platform === 'ttd' || platform === 'amazon-dsp' || platform === 'stackadapt') {
    return buildStandardHtml(config)
  }
  return buildCM360Html(config)
}

export function buildCM360Html(config: HtmlBuildConfig): string {
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
