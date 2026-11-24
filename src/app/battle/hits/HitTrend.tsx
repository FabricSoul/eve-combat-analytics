import { fmtHms, fmtNum, fmtPct } from '../../lib/format'
import { sideColor, sideLabel } from '../../lib/sides'
import { HIT_MINUTE, hitMetrics, type ShotCounts } from './analysis'

export function HitTrend({ teams, order, bounds }: {
  teams: readonly { side: number; minutes?: ReadonlyMap<number, ShotCounts> }[]
  order: readonly number[]
  bounds: readonly [number, number]
}) {
  const [start, end] = bounds
  const axes = [0, .5, 1]
  const w = 560
  const h = 113
  const inset = 36
  return <section className="hit-trend" aria-label="逐分钟命中率">
    <h3>逐分钟命中率</h3>
    {teams.some(({ minutes }) => minutes?.size) ? <svg viewBox={`0 0 ${w} ${h + 24}`} role="img" aria-label="各方逐分钟命中率曲线">
      {axes.map((rate) => {
        const y = 8 + (h - 8) * (1 - rate)
        return <g key={rate}>
          <text x={inset - 5} y={y + 3} textAnchor="end">{fmtPct(rate)}</text>
          <line x1={inset} x2={w - inset} y1={y} y2={y} />
        </g>
      })}
      {axes.map((position) => <text key={position} textAnchor="middle" x={inset + position * (w - 2 * inset)} y={h + 18}>
        {fmtHms(start + (end - start) * position).slice(0, 5)}
      </text>)}
      {teams.map(({ side, minutes }) => {
        const color = sideColor(side, order)
        const points = [...(minutes ?? [])].sort(([a], [b]) => a - b).map(([t, counts]) => ({
          t,
          counts,
          x: inset + (Math.max(start, t) - start) / Math.max(1, end - start) * (w - 2 * inset),
          y: 8 + (h - 8) * (1 - counts.hits / counts.shots),
        }))
        const path = points.map(({ x, y, t }, index) =>
          `${index > 0 && t - points[index - 1]!.t === HIT_MINUTE ? 'L' : 'M'}${x},${y}`).join(' ')
        return <g key={side} stroke={color}>
          <path d={path} fill="none" strokeWidth="1.5" />
          {points.map(({ x, y, t, counts }) => <circle key={t} cx={x} cy={y} r="2" fill={color}>
            <title>{sideLabel(side, order)} · {fmtHms(t).slice(0, 5)} · {fmtPct(hitMetrics.hitRate.value(counts))} · {fmtNum(counts.shots)} 发</title>
          </circle>)}
        </g>
      })}
    </svg> : <p className="hit-secondary">这段时间没有可统计的射击。</p>}
    <ul className="hit-legend">{teams.map(({ side }) => <li key={side}>
      <span className="hit-side-dot" style={{ background: sideColor(side, order) }} aria-hidden="true" />
      {sideLabel(side, order)}
    </li>)}</ul>
  </section>
}
