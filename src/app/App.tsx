import { lazy, Suspense, useEffect, useState } from 'react'
import { BattlePage } from './battle/BattlePage'
import { HomePage } from './home/HomePage'
import { AppShell } from './shell/AppShell'

const GalleryPage = lazy(() => import('./gallery/GalleryPage'))

function battleId(path: string): string | null {
  const segment = /^\/b\/([^/]+)$/.exec(path)?.[1]
  if (!segment) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const navigate = () => setPath(window.location.pathname)
    window.addEventListener('popstate', navigate)
    return () => window.removeEventListener('popstate', navigate)
  }, [])

  if (path === '/_gallery') {
    return <Suspense fallback={<AppShell><p role="status">正在加载画廊…</p></AppShell>}><GalleryPage /></Suspense>
  }
  const brId = battleId(path)
  if (brId) return <BattlePage key={brId} brId={brId} />
  return <AppShell>{path === '/' ? <HomePage /> : <div className="app-home"><h1>页面未找到</h1></div>}</AppShell>
}
