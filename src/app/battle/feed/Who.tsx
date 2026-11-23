import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { sideColor } from '../../lib/sides'
import { Portrait } from '../../ui/Portrait'

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
  const entity = entityKey ? analysis.entities[entityKey] : undefined
  const name = entity?.name ?? fallback ?? (entityKey ? labelOf(entityKey, summary) : '—')
  const side = entity?.side ?? -1
  return (
    <span className="feed-who" title={name}>
      <i className="side-dot" aria-hidden="true" style={{ background: sideColor(side, order) }} />
      <Portrait charId={entity?.charId ?? (/^char:(\d+)$/.test(entityKey ?? '') ? Number(entityKey?.slice(5)) : null)} size={16} />
      <span>{name}</span>
    </span>
  )
}
