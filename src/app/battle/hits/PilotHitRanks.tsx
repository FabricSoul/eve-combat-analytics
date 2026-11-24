import { fmtNum } from '../../lib/format'
import { hitMetricKeys, hitMetrics, MIN_RANKED_SHOTS, rankPilots, type PilotHits } from './analysis'

export function PilotHitRanks({ pilot, pilots }: { pilot: PilotHits; pilots: readonly PilotHits[] }) {
  if (pilot.shots < MIN_RANKED_SHOTS) return <p className="hit-secondary">
    样本不足 · <span className="app-number">{fmtNum(pilot.shots)} 发</span> · 排名至少需要 {MIN_RANKED_SHOTS} 发。
  </p>
  const side = pilot.entity.side
  const teammates = side >= 0 ? pilots.filter(({ entity }) => entity.side === side) : []
  const rankLabel = (rank: number | undefined) => rank === undefined ? '—' : `第 ${fmtNum(rank)} · ${fmtNum(pilot.shots)} 发`
  function rankOf(group: readonly PilotHits[], metric: typeof hitMetricKeys[number]) {
    return rankPilots(group, metric).ranked.find((row) => row.pilot.entity.key === pilot.entity.key)?.rank
  }

  return <dl className="hit-person-ranks" aria-label="命中排名">
    {hitMetricKeys.map((metric) => <div key={metric}>
      <dt>{hitMetrics[metric].label}</dt>
      <dd><small>同阵营</small> <span className="app-number">{rankLabel(rankOf(teammates, metric))}</span></dd>
      <dd><small>全场</small> <span className="app-number">{rankLabel(rankOf(pilots, metric))}</span></dd>
    </div>)}
  </dl>
}
