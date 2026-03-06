import { Link } from 'react-router-dom'

const sections = [
  {
    path: '/dco',
    title: 'Dynamic Creative Optimisation',
    description:
      'Learn about DCO, the 2026 market landscape, and use our production tools to scale display creatives across CM360, TTD, and more.',
  },
  {
    path: '/adobe-import',
    title: 'Adobe / ICC Import',
    description:
      'Build display banners from Adobe Example assets (ICC templates). Pre-loaded logos, lens backgrounds, and product images. Export to CM360.',
  },
  {
    path: '/manual',
    title: 'Manual Editor',
    description:
      'Upload images and videos, set dimensions, and design banners with drag-and-drop. Add text, arrange layers, and export to CM360.',
  },
  {
    path: '/social',
    title: 'Social Generator',
    description:
      'Paste a URL from Instagram, Facebook, or TikTok. Auto-generate 300×600 and 300×250 banners from the post content.',
  },
  {
    path: '/website-assets',
    title: 'Website Assets',
    description:
      'Paste a URL to extract all images, videos, stylesheets, and fonts from a site and its subdomains.',
  },
  {
    path: '/mp4-converter',
    title: 'MP4 Converter',
    description: 'Upload an MP4 video and export it as an HTML5 video banner ready for CM360.',
  },
]

export default function HomePage() {
  return (
    <div>
      <section className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold text-white md:text-4xl">
          Display Banner Editor
        </h1>
        <p className="mx-auto max-w-2xl text-slate-400">
          Create, convert, and export HTML5 display banners for Campaign Manager 360.
        </p>
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        {sections.map(({ path, title, description }) => (
          <Link
            key={path}
            to={path}
            className="group rounded-xl border border-slate-700 bg-slate-900/50 p-6 transition-all hover:border-slate-600 hover:bg-slate-800/50"
          >
            <h2 className="mb-2 text-lg font-semibold text-white group-hover:text-sky-400">
              {title}
            </h2>
            <p className="text-sm text-slate-400">{description}</p>
            <span className="mt-4 inline-block text-sm font-medium text-sky-500 group-hover:text-sky-400">
              Open →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
