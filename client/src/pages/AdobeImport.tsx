import ManualEditorComponent from '../components/ManualEditor/ManualEditor'

/** ICC template sizes from Adobe Example ICC-TemplatesReport.txt */
const ICC_DIMENSION_PRESETS = [
  { w: 970, h: 808, label: '970×808 (SELL/BUY)' },
  { w: 640, h: 2400, label: '640×2400 (SELL/BUY)' },
  { w: 300, h: 250, label: '300×250' },
  { w: 160, h: 600, label: '160×600' },
]

const BASE = '/adobe-example'

/** Pre-loaded assets from Adobe Example (Footage) - served from public */
const ICC_ASSETS = [
  { src: `${BASE}/Brand/MPB_Lens_Background_RGB.png`, name: 'MPB_Lens_Background_RGB.png', width: 0, height: 0 },
  { src: `${BASE}/Brand/MPB_Logo_Mono_RGB.png`, name: 'MPB_Logo_Mono_RGB.png', width: 0, height: 0 },
  { src: `${BASE}/Images/Product_Fujifilm_Suspended_Lenses_06_Q3 Small.png`, name: 'Product_Fujifilm_Lenses_06.png', width: 0, height: 0 },
  { src: `${BASE}/Images/Product_Fujifilm_Suspended_Lenses_09_Q3 Small.png`, name: 'Product_Fujifilm_Lenses_09.png', width: 0, height: 0 },
  { src: `${BASE}/Images/Product_SonyRX1RIII_21_Pink Small.png`, name: 'Product_SonyRX1RIII_Pink.png', width: 0, height: 0 },
]

export default function AdobeImport() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
        <h2 className="mb-2 text-sm font-semibold text-sky-400">ICC / Adobe Templates</h2>
        <p className="text-sm text-slate-400">
          Assets from the Adobe Example folder are pre-loaded below. These match the ICC-Templates.aep
          compositions (970×808, 640×2400, 300×250, 160×600). Drag assets onto the canvas, add text,
          and export to CM360. Note: The original .aep file cannot be rendered in-browser—only the
          collected PNG assets are used.
        </p>
      </div>
      <ManualEditorComponent
        title="ICC / Adobe Templates"
        initialAssets={ICC_ASSETS}
        initialDimensions={{ width: 970, height: 808 }}
        dimensionPresets={ICC_DIMENSION_PRESETS}
      />
    </div>
  )
}
