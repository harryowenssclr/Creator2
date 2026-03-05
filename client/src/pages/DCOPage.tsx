import { Link } from 'react-router-dom'

export default function DCOPage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center">
        <h1 className="mb-3 text-3xl font-bold text-white md:text-4xl">
          Dynamic Creative Optimisation
        </h1>
        <p className="mx-auto max-w-2xl text-slate-400">
          Scale creative production, personalise ad experiences, and automate distribution across
          display, video, and social—without enterprise complexity.
        </p>
      </section>

      {/* What is DCO? */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">What is DCO?</h2>
        <p className="mb-4 text-slate-400 leading-relaxed">
          Dynamic Creative Optimisation (DCO) assembles, renders, and optimises ad creatives in
          real time using data feeds—product catalogs, CRM signals, contextual triggers—instead of
          manually designing each variant. The 2026 market (~$1.16B, growing ~10–13% CAGR) is driven
          by AI/ML, cookie deprecation, and demand for omnichannel personalisation across CTV,
          DOOH, and social.
        </p>
        <p className="text-slate-400 leading-relaxed">
          Platforms are categorised by architecture: media-linked performance (Smartly, Celtra),
          production-first scaling (Abyssale, Bannerflow), and AI-native intelligence (Segwise,
          Marpipe). Creator aligns with the production-first segment—predictable costs, logic-based
          scaling, and headless-friendly export.
        </p>
      </section>

      {/* Market Segments */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">2026 Market Segments</h2>
        <div className="space-y-3">
          {[
            {
              title: 'Enterprise Giants',
              vendors: 'Celtra, Innovid, Adobe, Google DV360',
              focus: 'Global governance, omnichannel, DSP integrations',
            },
            {
              title: 'Performance/Social Leads',
              vendors: 'Smartly.io, Hunch, Madgicx',
              focus: 'DPAs, algorithmic feeds, social commerce',
            },
            {
              title: 'Infrastructure & Automation (Creator fits here)',
              vendors: 'Cape.io, Bannerflow, Abyssale, Storyteq',
              focus: 'Production-first, usage-based, headless API, Ad Ops automation',
            },
            {
              title: 'AI Challengers',
              vendors: 'Segwise, Marpipe, AdCreative.ai, Pencil',
              focus: 'Multimodal tagging, fatigue detection, predictive scoring',
            },
          ].map((seg) => (
            <div
              key={seg.title}
              className="rounded-lg border border-slate-700 bg-slate-900/50 p-4"
            >
              <h3 className="font-medium text-white">{seg.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{seg.vendors}</p>
              <p className="mt-1 text-sm text-slate-400">{seg.focus}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities Gap */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">The Capabilities Gap</h2>
        <p className="mb-4 text-slate-400 leading-relaxed">
          The &quot;missing middle&quot;—friction between AI promise and daily workflows—drives
          demand across three areas:
        </p>
        <ul className="list-inside list-disc space-y-2 text-slate-400">
          <li>
            <strong className="text-slate-300">3D/AR DCO</strong> — Dynamic 3D assets, AR
            experiences; latency remains a challenge.
          </li>
          <li>
            <strong className="text-slate-300">Cross-platform attribution</strong> — Deterministic
            view-through from CTV to mobile; dark traffic and walled gardens persist.
          </li>
          <li>
            <strong className="text-slate-300">Headless creative orchestration</strong> — Unified
            data layer feeding websites, signage, apps, and ad servers; human-in-the-loop approval,
            RBAC.
          </li>
        </ul>
      </section>

      {/* Tools */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">DCO Production Tools</h2>
        <p className="mb-6 text-slate-400">
          Use these Creator tools to produce and export display creatives for CM360, TTD, Amazon DSP,
          and StackAdapt.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/manual"
            className="group flex items-start gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-800/50"
          >
            <div className="rounded bg-slate-700 p-2 text-sky-400">✏️</div>
            <div>
              <h3 className="font-medium text-white group-hover:text-sky-400">Manual Editor</h3>
              <p className="text-sm text-slate-400">Design banners with drag-drop, layers, text. Export to CM360.</p>
            </div>
          </Link>
          <Link
            to="/social"
            className="group flex items-start gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-800/50"
          >
            <div className="rounded bg-slate-700 p-2 text-sky-400">📱</div>
            <div>
              <h3 className="font-medium text-white group-hover:text-sky-400">Social Generator</h3>
              <p className="text-sm text-slate-400">Paste IG/FB/TikTok URL → 300×600 and 300×250 banners.</p>
            </div>
          </Link>
          <Link
            to="/mp4-converter"
            className="group flex items-start gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-800/50"
          >
            <div className="rounded bg-slate-700 p-2 text-sky-400">🎬</div>
            <div>
              <h3 className="font-medium text-white group-hover:text-sky-400">MP4 Converter</h3>
              <p className="text-sm text-slate-400">Bulk MP4 → HTML5 video banners for CM360, TTD, Amazon, StackAdapt.</p>
            </div>
          </Link>
          <Link
            to="/website-assets"
            className="group flex items-start gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-800/50"
          >
            <div className="rounded bg-slate-700 p-2 text-sky-400">🌐</div>
            <div>
              <h3 className="font-medium text-white group-hover:text-sky-400">Website Assets</h3>
              <p className="text-sm text-slate-400">Extract images, videos, styles, fonts from any URL.</p>
            </div>
          </Link>
        </div>
      </section>

      {/* Roadmap CTA */}
      <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-6">
        <h2 className="mb-2 text-xl font-semibold text-white">Variant Generator — Coming Soon</h2>
        <p className="mb-4 text-slate-400">
          Template + feed (CSV/JSON) → generate hundreds of banner variants in one go. No login
          required for the first release.
        </p>
        <p className="text-sm text-slate-500">
          See <code className="rounded bg-slate-800 px-1.5 py-0.5">DCO_PLAN.md</code> for the full
          phased roadmap.
        </p>
      </section>
    </div>
  )
}
