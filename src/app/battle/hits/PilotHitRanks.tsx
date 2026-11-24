import { fmtNum } from '../../lib/format'
import { hitMetricKeys, hitMetrics, MIN_RANKED_SHOTS, type aggregateHits, type PilotHits } from './analysis'

export function PilotHitRanks({ pilot, ranking }: { pilot: PilotHits; ranking: ReturnType<typeof aggregateHits>['ranking'] }) {
  if (pilot.shots < MIN_RANKED_SHOTS) return <p className="hit-secondary">
    样本不足 · <span className="app-number">{fmtNum(pilot.shots)} 发</span> · 排名至少需要 {MIN_RANKED_SHOTS} 发。
  </p>
  const { key, side } = pilot.entity
  const rankLabel = (entry: ReturnType<typeof ranking>['ranked'][number] | undefined) =>
    entry ? `第 ${fmtNum(entry.rank)} · ${fmtNum(entry.pilot.shots)} 发` : '—'

  return <dl className="hit-person-ranks" aria-label="命中排名">
    {hitMetricKeys.map((metric) => {
      const entry = ranking(metric).byPilot.get(key)
      const sameSide = side < 0 ? undefined : ranking(metric, side).byPilot.get(key)
      return <div key={metric} data-hit-metric={metric}>
        <dt>{hitMetrics[metric].label} <span className="app-number hit-rank-value">{hitMetrics[metric].format(entry?.value ?? null)}</span></dt>
        <dd><small>同阵营</small> <span className="app-number">{rankLabel(sameSide)}</span></dd>
        <dd><small>全场</small> <span className="app-number">{rankLabel(entry)}</span></dd>
      </div>
    })}
  </dl>
}
