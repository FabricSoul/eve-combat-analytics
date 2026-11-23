import { useState } from 'react'
import { fmtDate, fmtHms, fmtIsk, fmtNum } from '../lib/format'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { Icon } from './upload/icons'
import './upload/upload.css'
import './upload/empty.css'

export interface EmptyBattleProps {
  onUpload?(): void
}

export function EmptyBattle({ onUpload }: EmptyBattleProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const window0 = summary?.meta.windows[0]
  const start = summary?.meta.windows.reduce((min, { start }) => Math.min(min, start), Infinity)
  const kills = summary?.meta.killmails.length
  const oursKnown = analysis?.coverage.find(({ side }) => side === view.oursSide)?.known

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(globalThis.location.href)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="empty-battle">
      <div className="empty-card">
        <div>
          <h2 className="empty-title">还没有人上传日志</h2>
          <p className="empty-lead">
            BR 已导入{window0 ? `：${window0.systemName}` : ''}
            {kills != null && <> · <span className="app-number">{fmtNum(kills)}</span> 次击毁</>}
            {summary && <> · <span className="app-number">{fmtIsk(summary.meta.killmails.reduce((sum, { value }) => sum + value, 0), 0)}</span></>}
            。现在只能看击毁记录，有人上传日志后回放和对比才会出现。
          </p>
          <ol className="empty-steps">
            <li>
              <b>打开日志文件夹</b><br />
              <span className="empty-path-row">Windows <code className="empty-path">文档\EVE\logs\Gamelogs</code></span>
              <span className="empty-path-row">macOS <code className="empty-path">~/Documents/EVE/logs/Gamelogs</code></span>
            </li>
            <li>
              <b>找{start !== undefined && Number.isFinite(start) ? ` ${fmtDate(start)} ${fmtHms(start).slice(0, 5)}（EVE 时间）前后` : '这场开始前后'}开始的文件</b><br />
              一场仗可能分成好几个文件（重新登录会新开一个），都拖进来
            </li>
            <li><b>拖到右边</b>，或把这个页面的链接发给队友</li>
          </ol>
          {oursKnown != null && (
            <div className="empty-progress">
              我方日志 <span className="app-number">{fmtNum(summary?.logs.length ?? 0)}</span> / <span className="app-number">{fmtNum(oursKnown)}</span> 人
              <div className="empty-bar"><i style={{ width: `${Math.min(100, ((summary?.logs.length ?? 0) / Math.max(1, oursKnown)) * 100)}%` }} /></div>
            </div>
          )}
        </div>
        <div className="upload-drop empty-drop">
          <Icon name="upload" size={28} />
          <b>拖入 Gamelog</b>
          <span>或 <button type="button" className="empty-pick" onClick={onUpload}>选择文件</button>，可多选、可拖整个文件夹</span>
          <Button className="empty-copy" onClick={() => void copyInvite()}>
            <Icon name="link" />{copied === 'ok' ? '已复制' : '复制邀请链接'}
          </Button>
          <div className="empty-copy-status" role={copied === 'failed' ? 'alert' : 'status'}>
            {copied === 'ok' && '已复制邀请链接'}
            {copied === 'failed' && (
              <>
                复制失败，请手动复制：
                <input className="empty-link" readOnly value={globalThis.location.href} aria-label="邀请链接"
                  ref={(node) => node?.select()} onFocus={(event) => event.currentTarget.select()} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
