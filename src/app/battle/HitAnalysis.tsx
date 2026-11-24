import { useMemo, useState } from 'react'
import { fmtHms, fmtNum } from '../lib/format'
import { sideColor, sideLabel, sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { PilotMore, usePilotMenu } from './roster/PilotActions'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { HitQualityBar } from './compare/HitQualityBar'
import { HitTrend } from './hits/HitTrend'
import { HitRateValue, UngradedShots, WeaponClasses } from './hits/WeaponClasses'
import {
  hitMetricKeys, hitMetrics, hitObservationHint, MIN_RANKED_SHOTS, weaponRows, type HitMetric,
} from './hits/analysis'
import { useHitAnalysis } from './hits/use-hit-analysis'
import { RangeChip } from './RangeChip'
import { pilotCountLabel } from './pilot-count'
import './hits/hits.css'

export function HitAnalysis() {
  const { analysis, summary } = useBattleContext()
  const { oursSide, range, clearRange, selected, select, includeUnidentified, toggleUnidentified } = useView()
  const pilotMenu = usePilotMenu()
  const hits = useHitAnalysis()
  const [expanded, setExpanded] = useState(false)
  const [metric, setMetric] = useState<HitMetric>('hitRate')
  const [reverse, setReverse] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const order = useMemo(() => analysis ? sideOrder(analysis, oursSide) : [], [analysis, oursSide])
  if (!hits || !analysis) return <p className="hit-secondary" role="status">正在加载命中数据…</p>

  const include = includeUnidentified.has('hits')
  const sides = [...order, ...new Set(Object.values(analysis.entities).map(({ side }) => side).filter((side) => !order.includes(side)))]
  const teams = sides.filter((side) => !hidden.has(side) && (side >= 0 || hits.sides.has(side)))
    .map((side) => ({ side, counts: hits.sides.get(side) }))
  const ranking = hits.ranking(metric)
  const rows = ranking.ranked.filter(({ pilot }) => !hidden.has(pilot.entity.side))
  if (reverse) rows.reverse()
  const insufficient = ranking.insufficient.filter(({ entity }) => !hidden.has(entity.side))
  const unidentified = [...hits.unidentified.values()].filter(({ entity }) => !hidden.has(entity.side))
    .sort((a, b) => b.shots - a.shots || a.entity.name.localeCompare(b.entity.name))
  const definition = hitMetrics[metric]
  const direction = reverse ? (definition.direction === 'ascending' ? 'descending' : 'ascending') : definition.direction
  let start = analysis.interactions[0]?.t ?? Infinity
  let end = analysis.interactions.at(-1)?.t ?? -Infinity
  for (const { t } of summary?.meta.killmails ?? []) {
    start = Math.min(start, t)
    end = Math.max(end, t)
  }
  const bounds = range ?? (start <= end ? [start, end] as const : undefined)

  function toggleSide(side: number) {
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(side)) next.delete(side)
      else next.add(side)
      return next
    })
  }

  return <section className="hit-analysis" aria-label="命中分析" data-expanded={expanded}>
    <header className="hit-analysis-header">
      <h2>命中分析</h2>
      <Button variant="ghost" data-full-page-close={expanded || undefined} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '整页'}</Button>
    </header>
    <div className="hit-analysis-body">
      <p className="hit-secondary">{hitObservationHint}</p>
      <div className="hit-analysis-controls">
        <details>
          <summary>阵营</summary>
          {sides.map((side) => <label key={side}><input type="checkbox" checked={!hidden.has(side)} onChange={() => toggleSide(side)} />
            <span className="hit-side-dot" style={{ background: sideColor(side, order) }} aria-hidden="true" />{sideLabel(side, order)}
          </label>)}
        </details>
        <label>排名指标 <select className="app-select" value={metric} onChange={(event) => {
          const key = hitMetricKeys.find((candidate) => candidate === event.currentTarget.value)
          if (!key) return
          setMetric(key)
          setReverse(false)
        }}>
          {hitMetricKeys.map((key) => <option key={key} value={key}>{hitMetrics[key].label}</option>)}
        </select></label>
        {unidentified.length > 0 && <Button variant="ghost" aria-pressed={include}
          onClick={() => toggleUnidentified('hits')}>含未识别 {fmtNum(unidentified.length)}</Button>}
        {range ? <RangeChip range={range} clearRange={clearRange} /> : bounds
          && <span>全场 <span className="app-number">{fmtHms(bounds[0])}–{fmtHms(bounds[1])}</span></span>}
      </div>
      <div className="hit-team-grid" aria-label="阵营命中对比">
        {teams.map(({ side, counts }) => <section className="hit-card" key={side}>
          <h3><span className="hit-side-dot" style={{ background: sideColor(side, order) }} aria-hidden="true" />
            {sideLabel(side, order)} {side !== oursSide && <small>据我方日志</small>}
          </h3>
          <div className="hit-team-summary">
            <span>命中率 <strong><HitRateValue counts={counts} /></strong></span>
            <span className="app-number">{fmtNum(counts?.shots ?? 0)} 发</span>
          </div>
          <UngradedShots count={counts?.ungraded ?? 0} />
          {counts && <HitQualityBar stats={counts} color={sideColor(side, order)} />}
          <WeaponClasses classes={counts?.classes ?? new Map()} />
        </section>)}
      </div>
      {bounds && <HitTrend order={order} bounds={bounds} teams={teams.map(({ side, counts }) => ({ side, minutes: counts?.minutes }))} />}
      <section className="hit-pilot-ranks">
        <h3>飞行员排名 <small>{pilotCountLabel(rows.length + insufficient.length, include ? unidentified.length : 0)}</small></h3>
        {rows.length > 0 ? <div className="hit-table-scroll" role="region" aria-label="飞行员命中排名" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">全场名次 / 样本</th><th scope="col">飞行员</th><th scope="col" aria-sort={direction}>
              <button type="button" onClick={() => setReverse(!reverse)}>{definition.label} {direction === 'ascending' ? '↑' : '↓'}</button>
            </th><th scope="col">命中质量</th><th scope="col">出手最多的武器</th><th scope="col">武器类别 · 出手 / 命中率</th></tr></thead>
            <tbody>{rows.map(({ pilot, value, rank }) => {
              const { entity } = pilot
              return <tr key={entity.key} data-pilot-key={entity.key} data-selected={selected === entity.key || undefined} onContextMenu={(event) => pilotMenu?.open(entity.key, event)}>
                <td className="app-number">{fmtNum(rank)} · {fmtNum(pilot.shots)} 发</td>
                <th scope="row">
                  <div className="hit-pilot-cell">
                    <button className="hit-pilot-name" type="button" onClick={() => select(entity.key)}>
                      <Portrait charId={entity.charId} size={20} />{entity.name}
                    </button>
                    <PilotMore pilot={entity.key} name={entity.name} />
                  </div>
                  <small>{sideLabel(entity.side, order)}{entity.side !== oursSide && ' · 据我方日志'}</small>
                  <UngradedShots count={pilot.ungraded} />
                </th>
                <td className="app-number">{definition.format(value)}</td>
                <td><HitQualityBar stats={pilot} color={sideColor(entity.side, order)} /></td>
                <td>{weaponRows(pilot)[0]?.[0] ?? '—'}</td>
                <td><WeaponClasses classes={pilot.classes} /></td>
              </tr>
            })}</tbody>
          </table>
        </div> : <p className="hit-secondary">当前筛选下没有达到排名门槛的飞行员 · 调整选段或上传更多战斗日志。</p>}
        <details className="hit-insufficient">
          <summary>样本不足 <span className="app-number">{fmtNum(insufficient.length)}</span> 人 · 少于 {MIN_RANKED_SHOTS} 发</summary>
          <ul>{insufficient.map((pilot) => {
            const { entity, shots, ungraded } = pilot
            return <li key={entity.key} data-pilot-key={entity.key} data-selected={selected === entity.key || undefined} onContextMenu={(event) => pilotMenu?.open(entity.key, event)}>
              <div className="hit-pilot-cell">
                <button type="button" onClick={() => select(entity.key)}>{entity.name}</button>
                <PilotMore pilot={entity.key} name={entity.name} />
              </div>
              <small>{sideLabel(entity.side, order)}</small>
              <span className="app-number">{fmtNum(shots)} 发</span>
              {ungraded > 0 && <div className="hit-insufficient-coverage">
                <UngradedShots count={ungraded} /><span>命中率 <HitRateValue counts={pilot} /></span>
              </div>}
            </li>
          })}</ul>
        </details>
        {include && unidentified.length > 0 && <section className="hit-insufficient hit-unidentified" aria-label="未识别">
          <h4>未识别 {fmtNum(unidentified.length)}</h4>
          <ul>{unidentified.map((pilot) => {
            const { entity, shots, ungraded } = pilot
            return <li key={entity.key} data-pilot-key={entity.key} data-selected={selected === entity.key || undefined}
              onContextMenu={(event) => pilotMenu?.open(entity.key, event)}>
              <div className="hit-pilot-cell">
                <button type="button" onClick={() => select(entity.key)}>{entity.name}</button>
                <PilotMore pilot={entity.key} name={entity.name} />
              </div>
              <small>{sideLabel(entity.side, order)}</small>
              <span className="app-number">{fmtNum(shots)} 发</span>
              <div className="hit-insufficient-coverage">
                <span>命中率 <HitRateValue counts={pilot} /></span>
                {ungraded > 0 && <UngradedShots count={ungraded} />}
              </div>
            </li>
          })}</ul>
        </section>}
      </section>
    </div>
  </section>
}
