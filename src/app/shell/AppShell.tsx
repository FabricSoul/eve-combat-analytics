import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react'
import './workspace.css'
import { TopBar, type TopBarProps } from './TopBar'

export type Appearance = 'light' | 'dark'
const storageKey = 'eve-combat-analytics:appearance'
const preference = '(prefers-color-scheme: dark)'

function storedAppearance(): Appearance | null {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

export interface AppShellProps {
  children: ReactNode
  battle?: boolean
  home?: boolean
  topBar?: Omit<TopBarProps, 'appearance' | 'onToggleAppearance' | 'home'>
}

function resetShellScroll({ currentTarget }: UIEvent<HTMLDivElement>) {
  if (currentTarget.scrollTop !== 0) currentTarget.scrollTop = 0
  if (currentTarget.scrollLeft !== 0) currentTarget.scrollLeft = 0
}

export function AppShell({ children, battle = false, home = false, topBar }: AppShellProps) {
  const shell = useRef<HTMLDivElement>(null)
  const [override, setOverride] = useState(storedAppearance)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(preference).matches ?? false)
  const appearance = override ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    const media = window.matchMedia?.(preference)
    const update = () => setSystemDark(media?.matches ?? false)
    media?.addEventListener('change', update)
    return () => media?.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance
  }, [appearance])

  useLayoutEffect(() => {
    if (!battle) return
    const root = shell.current
    const header = root?.querySelector(':scope > .app-topbar')
    if (!root || !header) return

    const measure = () => root.style.setProperty('--battle-header-bottom', `${header.getBoundingClientRect().bottom}px`)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [battle])

  function toggleAppearance() {
    const next = appearance === 'dark' ? 'light' : 'dark'
    setOverride(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // The current tab can still change its appearance with storage disabled.
    }
  }

  return (
    <div ref={shell} className={battle ? 'app-shell app-shell--battle' : 'app-shell'} onScroll={battle ? resetShellScroll : undefined}>
      <TopBar {...topBar} home={home} appearance={appearance} onToggleAppearance={toggleAppearance} />
      <main className="app-shell-body">{children}</main>
    </div>
  )
}
