import { useState } from 'react'
import type { BattleSummary } from '@/core/contract'
import { Icon } from '../battle/upload/icons'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { Button } from '../ui/Button'
import type { Appearance } from './AppShell'

export interface TopBarProps {
  appearance: Appearance
  onToggleAppearance(): void
  summary?: BattleSummary | null
  oursSide?: number
  onOursSideChange?(side: number): void
  onUpload?(): void
  onOpenSides?(): void
  shareUrl?(): string
}

export function TopBar({
  appearance, onToggleAppearance, summary, oursSide, onOursSideChange, onUpload, onOpenSides, shareUrl,
}: TopBarProps) {
  const [share, setShare] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const system = summary?.meta.windows[0]
  const date = system ? fmtDate(system.start) : ''
  const title = system ? `${system.systemName} · ${date}` : 'EVE Combat Analytics'
  const sides = summary && [...new Set([
    ...summary.meta.teams.map((_, index) => index),
    ...summary.sideOverrides.map(({ side }) => side).filter((side) => side >= 0),
  ])].sort((a, b) => a - b)
  const totalIsk = summary?.meta.killmails.reduce((sum, { value }) => sum + value, 0)
  const stats = summary && <>
    <span className="app-number">{fmtNum(summary.meta.killmails.length)}</span> 次击毁 ·{' '}
    <span className="app-number">{fmtIsk(totalIsk, 0)}</span> ISK · 日志{' '}
    <span className="app-number">{fmtNum(summary.logs.length)}</span> 份
  </>

  async function copyShare() {
    if (!shareUrl) return
    const url = shareUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setShare('')
    } catch {
      setCopied(false)
      setShare(url)
    }
  }

  return (
    <header className="app-topbar" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false)
    }} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !menuOpen) return
      event.preventDefault()
      setMenuOpen(false)
      event.currentTarget.querySelector<HTMLButtonElement>('.app-topbar-menu-toggle')?.focus()
    }}>
      <a className="app-topbar-title" href="/">{system && <span className="app-topbar-short-title">{system.systemName} · {date.slice(5)}</span>}
        <span className="app-topbar-full-title">{title}</span>
      </a>
      {stats && <span className="app-topbar-meta">{stats}</span>}
      {onUpload && <Button className="app-topbar-upload-mobile" onClick={onUpload} aria-label="上传日志"><Icon name="upload" size={18} /></Button>}
      {summary && <Button className="app-topbar-menu-toggle" variant="ghost" aria-label="更多战斗操作"
        aria-expanded={menuOpen} aria-controls="battle-topbar-actions" onClick={() => setMenuOpen(!menuOpen)}>⋯</Button>}
      <div className="app-topbar-actions" id={summary ? 'battle-topbar-actions' : undefined} data-menu-open={menuOpen}>
        {stats && <span className="app-topbar-menu-meta">{stats}</span>}
        {sides && onOursSideChange && sides.length > 1 && (
          <label className="app-topbar-side">
            <span className="app-topbar-label">我方</span>
            <select aria-label="我方" className="app-select" value={oursSide} onChange={(event) => onOursSideChange(Number(event.target.value))}>
              {sides.map((side) => <option key={side} value={side}>第 {side + 1} 方</option>)}
            </select>
          </label>
        )}
        {onOpenSides && <Button variant="ghost" onClick={() => { setMenuOpen(false); onOpenSides() }}>排边</Button>}
        {onUpload && <Button className="app-topbar-upload-desktop" onClick={onUpload}>上传日志</Button>}
        {shareUrl && (
          <div className="app-topbar-share">
            {share && <input aria-label="分享链接" readOnly value={share} ref={(node) => node?.select()} />}
            <Button onClick={() => void copyShare()}>{copied ? '已复制' : '分享'}</Button>
          </div>
        )}
        <Button variant="ghost" onClick={onToggleAppearance} aria-label={appearance === 'dark' ? '切换到浅色' : '切换到深色'}>
          {appearance === 'dark' ? '浅色' : '深色'}
        </Button>
      </div>
    </header>
  )
}
