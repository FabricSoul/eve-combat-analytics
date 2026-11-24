import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { sideColor } from '../../lib/sides'
import { Portrait } from '../../ui/Portrait'

import { useView } from '../../state/view-store'
import { PilotMore, usePilotMenu } from '../roster/PilotActions'

export interface WhoProps {
  entityKey: EntityKey | null
  analysis: Analysis
  summary: BattleSummary
  order: readonly number[]
  /** Shown when the key resolves to nothing. */
  fallback?: string | null
}

function labelOf(key: EntityKey, summary: BattleSummary): string {
  if (key.startsWith('name:')) return key.slice(5)
  const id = Number(/^char:(\d+)$/.exec(key)?.[1])
  return summary.meta.names[id]?.name ?? key
}

/** Side dot + portrait 16 + name; the dot is the only place the side color appears. */
export function Who({ entityKey, analysis, summary, order, fallback = null }: WhoProps) {
  const { select, selected } = useView()
  const menu = usePilotMenu()
  const entity = entityKey ? analysis.entities[entityKey] : undefined
  const name = entity?.name ?? fallback ?? (entityKey ? labelOf(entityKey, summary) : '—')
  const side = entity?.side ?? -1
  const label = <>
    <i className="side-dot" aria-hidden="true" style={{ background: sideColor(side, order) }} />
    <Portrait charId={entity?.charId ?? (/^char:(\d+)$/.test(entityKey ?? '') ? Number(entityKey?.slice(5)) : null)} size={16} />
    <span>{name}</span>
  </>
  return entity && entityKey
    ? <span className="feed-participant" data-pilot-key={entityKey} onContextMenu={(event) => menu?.open(entityKey, event)}>
      <button type="button" className="feed-who" title={name} aria-pressed={selected === entityKey} onClick={() => select(entityKey)}>{label}</button>
      <PilotMore pilot={entityKey} name={name} />
    </span>
    : <span className="feed-who" title={name}>{label}</span>
}
