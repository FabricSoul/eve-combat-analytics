import type { Killmail } from '@/core/contract'
import { fmtHms, fmtIsk, fmtNum } from '../lib/format'
import { sideColor, sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { PilotMore, usePilotMenu } from './roster/PilotActions'
import { Portrait } from '../ui/Portrait'
import { TypeIcon } from '../ui/TypeIcon'
import './upload/kills.css'

export interface KillsListProps { expanded?: boolean; onRestore?: () => void }

/** Capsule and the Genolution capsule variant: pods are left out of the list (spec: kills without pods). */
const podTypeIds = new Set([670, 33328])

export function KillsList({ expanded, onRestore }: KillsListProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const t = useCoarseTime()
  const pilotMenu = usePilotMenu()
  if (!summary) return null
  const { names } = summary.meta
  const kills = summary.meta.killmails
    .filter(({ victim }) => !podTypeIds.has(victim.shipTypeId ?? -1))
    .sort((a, b) => a.t - b.t || a.id - b.id)
  const order = analysis ? sideOrder(analysis, view.oursSide) : [view.oursSide]

  function victimKey(kill: Killmail) {
    const key = kill.victim.charId == null ? null : `char:${kill.victim.charId}` as const
    return key && analysis?.entities[key] ? key : null
  }

  // The current kill is the one at the cursor: the selected victim's latest loss at or before the cursor,
  // or, with nothing selected, the latest kill at or before it.
  const currentKillId = (() => {
    const upTo = kills.filter((kill) => kill.t <= t)
    const own = view.selected === null ? upTo : upTo.filter((kill) => victimKey(kill) === view.selected)
    return own.at(-1)?.id ?? null
  })()

  function open(kill: Killmail) {
    view.seek(kill.t)
    const key = victimKey(kill)
    if (key) view.select(key)
  }

  return (
    <div className="kills" data-expanded={expanded || undefined}>
      <div className="kills-head">
        击毁 · <span className="app-number">{fmtNum(kills.length)}</span> 艘（不含太空舱）· 点一行跳到那一刻
        {expanded && <button type="button" data-full-page-close title="收起击毁整页" aria-label="收起击毁整页" onClick={onRestore}>×</button>}
      </div>
      {!kills.length && <p className="module-empty">暂无舰船击毁记录 · 导入含击毁报告的战斗链接查看。</p>}
      {kills.map((kill) => {
        const key = victimKey(kill)
        const side = key ? analysis!.entities[key]!.side : -1
        const name = (kill.victim.charId != null && names[kill.victim.charId]?.name) || (key && analysis!.entities[key]!.name) || '—'
        const ship = (kill.victim.shipTypeId != null && names[kill.victim.shipTypeId]?.name) || '—'
        const current = kill.id === currentKillId
        const selected = key !== null && key === view.selected
        return (
          <div key={kill.id} className="kills-entry" data-pilot-key={key ?? undefined} data-selected={selected || undefined}
            onContextMenu={(event) => { if (key) pilotMenu?.open(key, event) }}>
          <button type="button" className={current || selected ? 'kills-row kills-row--sel' : 'kills-row'}
            aria-current={current || undefined} aria-pressed={key ? selected : undefined} onClick={() => open(kill)}>
            <span className="app-number kills-time">{fmtHms(kill.t).slice(0, 5)}</span>
            <span className="kills-ship">
              <Portrait charId={kill.victim.charId} size={28} />
              <TypeIcon typeId={kill.victim.shipTypeId} size={16} className="kills-type" />
            </span>
            <span className="kills-who">
              <span className="kills-name"><i className="kills-dot" style={{ background: sideColor(side, order) }} />{name}</span>
              <span className="kills-sub">{ship}</span>
            </span>
            <span className="app-number kills-isk">{fmtIsk(kill.value)}</span>
          </button>
          {key && <PilotMore pilot={key} name={name} />}
          </div>
        )
      })}
    </div>
  )
}
