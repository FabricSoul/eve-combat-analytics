import { useState } from 'react'
import type { BattleSummary } from '@/core/contract'
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
  const system = summary?.meta.windows[0]
  const title = system ? `${system.systemName} · ${fmtDate(system.start)}` : 'EVE Combat Analytics'
  const totalIsk = summary?.meta.killmails.reduce((sum, { value }) => sum + value, 0)

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
    <header className="app-topbar">
      <a className="app-topbar-title" href="/">{title}</a>
      {summary && (
        <span className="app-topbar-meta">
          <span className="app-number">{fmtNum(summary.meta.killmails.length)}</span> 次击毁 ·{' '}
          <span className="app-number">{fmtIsk(totalIsk, 0)}</span> ISK · 日志{' '}
          <span className="app-number">{fmtNum(summary.logs.length)}</span> 份
        </span>
      )}
      <div className="app-topbar-actions">
        {summary && onOursSideChange && summary.meta.teams.length > 1 && (
          <label className="app-topbar-side">
            <span className="app-topbar-label">我方</span>
            <select aria-label="我方" className="app-select" value={oursSide} onChange={(event) => onOursSideChange(Number(event.target.value))}>
              {summary.meta.teams.map((_, index) => <option key={index} value={index}>第 {index + 1} 方</option>)}
            </select>
          </label>
        )}
        {onOpenSides && <Button variant="ghost" onClick={onOpenSides}>排边</Button>}
        {onUpload && <Button onClick={onUpload}>上传日志</Button>}
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
