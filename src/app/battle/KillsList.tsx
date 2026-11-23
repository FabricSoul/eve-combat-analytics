import type { Killmail } from '@/core/contract'
import { fmtHms, fmtIsk, fmtNum } from '../lib/format'
import { sideColor, sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { TypeIcon } from '../ui/TypeIcon'
import './upload/kills.css'

export interface KillsListProps {}

/** Capsule and the Genolution capsule variant: pods are left out of the list (spec: kills without pods). */
const podTypeIds = new Set([670, 33328])

export function KillsList(_props: KillsListProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
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

  function open(kill: Killmail) {
    view.seek(kill.t)
    const key = victimKey(kill)
    if (key && view.selected !== key) view.select(key)
  }

  return (
    <div className="kills">
      <div className="kills-head">
        击毁 · <span className="app-number">{fmtNum(kills.length)}</span> 艘（不含太空舱）· 点一行跳到那一刻
      </div>
      {kills.map((kill) => {
        const key = victimKey(kill)
        const side = key ? analysis!.entities[key]!.side : -1
        const name = (kill.victim.charId != null && names[kill.victim.charId]?.name) || (key && analysis!.entities[key]!.name) || '—'
        const ship = (kill.victim.shipTypeId != null && names[kill.victim.shipTypeId]?.name) || '—'
        const selected = key !== null && view.selected === key
        return (
          <button type="button" key={kill.id} className={selected ? 'kills-row kills-row--sel' : 'kills-row'}
            aria-current={selected || undefined} onClick={() => open(kill)}>
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
        )
      })}
    </div>
  )
}
