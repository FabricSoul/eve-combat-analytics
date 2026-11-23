import { useMemo, useState, type Ref } from 'react'
import type { Analysis, BattleSummary } from '@/core/contract'
import { Icon } from '../battle/upload/icons'
import { fmtDate, fmtIsk, fmtNum } from '../lib/format'
import { sideColor, sideLetter, sideName, sideOrder } from '../lib/sides'
import { Button } from '../ui/Button'
import type { Appearance } from './AppShell'
import { battleTitle } from './battle-title'
import { SidePicker } from './SidePicker'

export interface TopBarProps {
  appearance: Appearance
  home?: boolean
  onToggleAppearance(): void
  summary?: BattleSummary | null
  analysis?: Analysis | null
  oursSide?: number
  onOursSideChange?(side: number): void
  onUpload?(): void
  onOpenSides?(trigger: HTMLButtonElement): void
  live?: boolean
  reconnecting?: boolean
  menuOpen?: boolean
  onMenuOpenChange?(open: boolean): void
  menuTrigger?: Ref<HTMLButtonElement>
  shareUrl?(): string
}

export function TopBar({
  appearance, onToggleAppearance, summary, analysis, oursSide, onOursSideChange, onUpload, onOpenSides, shareUrl,
  home = false, live, reconnecting, menuOpen = false, onMenuOpenChange, menuTrigger,
}: TopBarProps) {
  const [share, setShare] = useState('')
  const [copied, setCopied] = useState(false)
  const system = summary?.meta.windows[0]
  const date = system ? fmtDate(system.start) : ''
  const name = summary ? battleTitle(summary.meta) : 'EVE 舰队战复盘'
  const title = date ? `${name} · ${date}` : name
  const sides = useMemo(() => {
    if (!summary || !analysis) return []
    const indices = [...new Set([
      ...summary.meta.teams.map((_, index) => index),
      ...summary.sideOverrides.map(({ side }) => side).filter((side) => side >= 0),
    ])].sort((a, b) => a - b)
    const order = sideOrder(analysis, oursSide ?? 0)
    return indices.map((side) => ({
      side, label: sideName(side, summary, analysis), color: sideColor(side, order), letter: sideLetter(side, order),
    }))
  }, [summary, analysis, oursSide])
  const totalIsk = summary?.meta.killmails.reduce((sum, { value }) => sum + value, 0)
  const isk = fmtIsk(totalIsk, 0)
  const stats = summary && <>
    <span className="app-number">{fmtNum(summary.meta.killmails.length)}</span> 次击毁
    <span className="app-topbar-isk"> · <span className="app-number">{isk}</span>{isk.endsWith(' ISK') ? '' : ' ISK'}</span>
    {' · 日志 '}
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
      if (!event.currentTarget.contains(event.relatedTarget)) onMenuOpenChange?.(false)
    }}>
      <a className="app-topbar-title" href="/" title={title}>
        {date && <span className="app-topbar-short-title">{name} · {date.slice(5)}</span>}
        <span className="app-topbar-full-title">{title}</span>
      </a>
      {summary && live !== undefined && <span className="app-topbar-connection" role="status">
        {live ? '' : reconnecting ? '重连中…' : '离线'}
      </span>}
      {stats && <span className="app-topbar-meta">{stats}</span>}
      {onUpload && <Button className="app-topbar-upload-mobile" onClick={onUpload} aria-label="上传日志"><Icon name="upload" size={18} /></Button>}
      {summary && <Button ref={menuTrigger} className="app-topbar-menu-toggle" variant="ghost" aria-label="更多战斗操作"
        aria-expanded={menuOpen} aria-controls="battle-topbar-actions" onClick={() => onMenuOpenChange?.(!menuOpen)}>⋯</Button>}
      <div className="app-topbar-actions" id={summary ? 'battle-topbar-actions' : undefined} data-menu-open={menuOpen}>
        {stats && <span className="app-topbar-menu-meta">{stats}</span>}
        {onOursSideChange && sides.length > 1 && <SidePicker choices={sides} value={oursSide} onChange={onOursSideChange} />}
        {onOpenSides && <Button variant="ghost" onClick={(event) => onOpenSides(event.currentTarget)}>排边</Button>}
        {onUpload && <Button className="app-topbar-upload-desktop" onClick={onUpload}>上传日志</Button>}
        {shareUrl && (
          <div className="app-topbar-share">
            {share && <input aria-label="分享链接" readOnly value={share} ref={(node) => node?.select()} />}
            <Button onClick={() => void copyShare()}>{copied ? '已复制' : '分享'}</Button>
          </div>
        )}
        {home && <a className="app-topbar-github" href="https://github.com/FabricSoul/eve-combat-analytics">GitHub</a>}
        <Button variant="ghost" onClick={onToggleAppearance} aria-label={appearance === 'dark' ? '切换到浅色' : '切换到深色'}>
          {appearance === 'dark' ? '浅色' : '深色'}
        </Button>
      </div>
    </header>
  )
}
