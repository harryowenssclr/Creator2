import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/dco', label: 'DCO' },
  { path: '/manual', label: 'Manual Editor' },
  { path: '/social', label: 'Social Generator' },
  { path: '/website-assets', label: 'Website Assets' },
  { path: '/mp4-converter', label: 'MP4 Converter' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-xl font-bold tracking-tight text-white">
            Creator
          </Link>
          <nav className="flex gap-1">
            {navItems.map(({ path, label }) => (
              <Link
                key={path}
                to={path}
                className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                  location.pathname === path
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
