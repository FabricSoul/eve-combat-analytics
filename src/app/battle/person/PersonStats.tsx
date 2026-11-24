import { useMemo } from 'react'
import type { Analysis, Entity, EntityKey, EwarSpan, Interaction } from '@/core/contract'
import { fmtHms, fmtNum } from '../../lib/format'
import { sideColor } from '../../lib/sides'
import { TypeIcon } from '../../ui/TypeIcon'
import { HitQualityBar } from '../compare/HitQualityBar'
import { noHitQualityReason } from '../compare/hit-quality'
import { hitMetrics, hitObservationHint, shotTotal, weaponRows, type aggregateHits } from '../hits/analysis'
import { PilotHitRanks } from '../hits/PilotHitRanks'
import { HitRateValue, ObservedHitSample, UngradedShots, WeaponClasses } from '../hits/WeaponClasses'
import '../hits/hits.css'
import {
  damageKinds, isObserved, metricValue, metrics, medianSample, medianTooltip, missingReason, rowMedian, seconds, shipId, unknownDamageReason, type CompareRow,
} from '../compare/metrics'

const tileKeys = ['damageOut', 'damageIn', 'repairOut', 'repairIn', 'activeRatio', 'repReactionMedian', 'hitRate'] as const
const tileMetrics = tileKeys.map((key) => metrics.find((metric) => metric.key === key)!)
const num = (value: number) => fmtNum(Math.round(value))
const bucketDuration = 10_000
type Related = [key: EntityKey, data: { amount: number; count: number }]

function relationship(pilot: Entity, events: readonly Interaction[]) {
  const repaired = new Map<EntityKey, Related[1]>()
  const attacked = new Map<EntityKey, Related[1]>()
  const attackers = new Map<EntityKey, Related[1]>()
  const repair = new Map<number, number>()
  const damage = new Map<number, number>()
  function tally(target: Map<EntityKey, Related[1]>, key: EntityKey, event: Interaction) {
    const old = target.get(key) ?? { amount: 0, count: 0 }
    target.set(key, { amount: old.amount + event.amount, count: old.count + 1 })
  }
  function tallyBucket(target: Map<number, number>, event: Interaction) {
    const bucket = Math.floor(event.t / bucketDuration) * bucketDuration
    target.set(bucket, (target.get(bucket) ?? 0) + event.amount)
  }
  for (const event of events) {
    if (event.kind === 'repair' && event.from === pilot.key) {
      if (event.from !== event.to) tally(repaired, event.to, event)
      tallyBucket(repair, event)
    }
    if (event.kind === 'damage' && event.from === pilot.key) tally(attacked, event.to, event)
    if (event.kind === 'damage' && event.to === pilot.key) {
      tally(attackers, event.from, event)
      tallyBucket(damage, event)
    }
  }
  const top = (map: Map<EntityKey, Related[1]>) =>
    [...map].sort(([aKey, a], [bKey, b]) => b.amount - a.amount || aKey.localeCompare(bKey)).slice(0, 5)
  return { repaired: top(repaired), attacked: top(attacked), attackers: top(attackers), repair, damage }
}

export function PersonStats({ analysis, pilot, rows, interactions, hits, bounds, order, select }: {
  analysis: Analysis; pilot: Entity; rows: readonly CompareRow[]; interactions: readonly Interaction[];
  hits: ReturnType<typeof aggregateHits> | null;
  bounds: readonly [number, number]; order: readonly number[]; select(key: EntityKey): void
}) {
  const origin = Math.floor(bounds[0] / bucketDuration) * bucketDuration
  const end = Math.floor(bounds[1] / bucketDuration) * bucketDuration
  const row = rows.find(({ entity }) => entity.key === pilot.key)
  const team = useMemo(() => rows.filter(({ entity }) => entity.side === pilot.side && entity.side >= 0), [rows, pilot.side])
  const details = useMemo(() => relationship(pilot, interactions), [pilot, interactions])
  const observed = hits?.pilots.get(pilot.key)
  const observedSample = row && isObserved(row) ? observed : undefined
  const hitPilots = useMemo(() => [...(hits?.pilots.values() ?? [])], [hits])
  const weapons = useMemo(() => observed ? weaponRows(observed).slice(0, 5) : [], [observed])
  const sideHitMedian = useMemo(() => medianSample(hitPilots.flatMap(({ entity, ...counts }) =>
    entity.side === pilot.side && pilot.side >= 0 ? hitMetrics.hitRate.value(counts) ?? [] : [],
  )), [hitPilots, pilot.side])
  const points = useMemo(() => pointSpans(analysis.ewarSpans, pilot.key, bounds), [analysis.ewarSpans, pilot.key, bounds])
  const counterpartyColor = (key: EntityKey) => sideColor(analysis.entities[key]?.side ?? -1, order)
  return <div className="u7-person-stack">
    <div className="u7-stat-tiles">
      {tileMetrics.map((metric) => {
        const isHitRate = metric.key === 'hitRate'
        const value = isHitRate ? (observed ? hitMetrics.hitRate.value(observed) : null) : row ? metricValue(row, metric) : null
        const middle = isHitRate ? sideHitMedian : rowMedian(team, metric)
        const unavailable = isHitRate ? noHitQualityReason : row ? missingReason(row, metric) : undefined
        return <section key={metric.key} className="u7-stat-tile">
          <h3>{metric.label}</h3>
          <div className="app-number" title={value === null ? unavailable : undefined}>{metric.format(value)}</div>
          {isHitRate && observedSample && <ObservedHitSample shots={observedSample.shots} />}
          <small title={medianTooltip(middle)}>全队中位 <span className="app-number">{metric.format(middle.value)}</span></small>
        </section>
      })}
    </div>
    <section className="u7-person-card">
      <h3>命中质量</h3>
      {observedSample && <ObservedHitSample shots={observedSample.shots} />}
      <p className="u7-secondary">{hitObservationHint}</p>
      {observed && <UngradedShots count={observed.ungraded} />}
      {hits && observed && <PilotHitRanks pilot={observed} ranking={hits.ranking} />}
      {observed && observed.shots > 0 && <HitQualityBar stats={observed} color={sideColor(pilot.side, order)} showCounts />}
      {observed && observed.classes.size > 0 && <WeaponClasses classes={observed.classes} />}
      {weapons.length > 0 && <><h4 className="hit-weapon-heading">武器 · 出手 / 命中率</h4>
        <ul>{weapons.map(([name, counts]) => <li className="u7-hit-weapon" key={name}>
        <span>{name}</span><span className="app-number">{fmtNum(shotTotal(counts))} 次</span>
        <HitRateValue counts={counts} />
      </li>)}</ul></>}
      {!observed?.shots && <p className="u7-secondary">{noHitQualityReason}。</p>}
    </section>
    <section className="u7-person-card">
      <h3>按时间 · 每 10 秒</h3>
      <Series title="维修输出" values={details.repair} color="var(--color-repair)" start={origin} end={end} />
      <Series title="承伤" values={details.damage} color={sideColor(-1, order)} start={origin} end={end} />
      <div className="u7-series-times app-number">
        {[origin, origin + (end - origin) / 3, origin + (end - origin) * 2 / 3, end]
          .filter((time, index, ticks) => index === 0 || time > ticks[index - 1]!)
          .map((time) => <time key={time}>{fmtHms(time).slice(0, 5)}</time>)}
      </div>
    </section>
    <TopList title="维修给了谁" rows={details.repaired} entities={analysis.entities} select={select} colorFor={() => "var(--color-repair)"} />
    <TopList title="伤害给了谁" rows={details.attacked} entities={analysis.entities} select={select} colorFor={counterpartyColor} />
    <TopList title="谁对他造成伤害" rows={details.attackers} entities={analysis.entities} select={select} colorFor={counterpartyColor} />
    <section className="u7-person-card">
      <h3>承伤构成</h3>
      {!row?.damage && <p className="u7-secondary">这段时间没有可用的承伤记录。</p>}
      {row?.damage && <dl className="u7-person-damage">
        {Object.entries(damageKinds).map(([key, { label, icon }]) => {
          const amount = row.damage?.[key as keyof typeof damageKinds]
          return amount === undefined ? null : <div key={key}>
            <dt title={key === 'unknown' ? unknownDamageReason : undefined}>{icon && <img src={icon} alt="" width="16" height="16" />}{label}</dt>
            <dd className="app-number">{num(amount)}</dd>
          </div>
        })}
      </dl>}
    </section>
    <PointLog points={points} entities={analysis.entities} limit={6} />
  </div>
}

export function pointSpans(spans: readonly EwarSpan[], key: EntityKey, [from, to]: readonly [number, number]) {
  return spans.filter((span) => (span.from === key || span.to === key)
    && (span.ewar === 'warp_scramble' || span.ewar === 'warp_disrupt') && span.start <= to && span.end >= from)
    .map((span) => ({ ...span, start: Math.max(from, span.start), end: Math.min(to, span.end) }))
    .sort((a, b) => a.start - b.start)
}

function Series({ title, values, color, start, end }: {
  title: string; values: Map<number, number>; color: string; start: number; end: number
}) {
  const width = 300
  const height = 40
  const max = Math.max(1, ...values.values())
  const span = Math.max(bucketDuration, end - start)
  const points = new Map<number, number>([[start, 0], [end, 0]])
  for (const [time, value] of values) {
    const previous = time - bucketDuration
    const next = time + bucketDuration
    if (previous >= start && !points.has(previous)) points.set(previous, 0)
    if (next <= end && !points.has(next)) points.set(next, 0)
    points.set(time, value)
  }
  const line = [...points].sort(([a], [b]) => a - b).map(([time, value]) =>
    `${(time - start) / span * width},${height - value / max * (height - 4)}`).join(' ')
  return <div className="u7-series">
    <span>{title}</span>
    <div className="u7-series-plot">
      <span className="app-number">峰值 {num(values.size ? max / 10 : 0)}/秒</span>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={`0,${height} ${line} ${width},${height}`} fill={color} opacity=".24" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  </div>
}

function CompactEntity({ entity, fallback }: { entity?: Entity; fallback: EntityKey }) {
  const name = entity?.name ?? fallback
  return <span className="u7-compact-entity" title={name}>
    <TypeIcon typeId={entity ? shipId(entity) : null} size={16} /><span className="u7-ellipsis">{name}</span>
  </span>
}

function TopList({ title, rows, entities, select, colorFor }: {
  title: string; rows: Related[]; entities: Analysis['entities']; select(key: EntityKey): void; colorFor(key: EntityKey): string
}) {
  const max = Math.max(rows[0]?.[1].amount ?? 0, 1)
  return <section className="u7-person-card">
    <h3>{title}（前 5）</h3>
    {!rows.length && <p className="u7-secondary">这段时间没有相关记录。</p>}
    {rows.map(([key, { amount, count }]) => <div className="u7-person-top" key={key}>
      <button type="button" onClick={() => select(key)}><CompactEntity entity={entities[key]} fallback={key} /></button>
      <span className="u7-top-track"><i style={{ width: `${amount / max * 100}%`, background: colorFor(key) }} /></span>
      <span className="app-number">{num(amount)}</span><span className="app-number">{fmtNum(count)} 次</span>
    </div>)}
  </section>
}

export function PointLog({ points, entities, limit }: {
  points: EwarSpan[]; entities: Analysis['entities']; limit?: number
}) {
  return <section className="u7-person-card">
    <h3>点控记录 <small><span className="app-number">{fmtNum(points.length)}</span> 段</small></h3>
    {!points.length && <p className="u7-secondary">这段时间没有相关的点控记录。</p>}
    {points.slice(0, limit).map(({ start, end, from, to, ewar }, index) => <div className="u7-person-point" key={index}>
      <time className="app-number">{fmtHms(start)}</time>
      <CompactEntity entity={entities[from]} fallback={from} />
      <span>{ewar === 'warp_scramble' ? '扰频' : '扰断'} →</span>
      <CompactEntity entity={entities[to]} fallback={to} />
      <span className="app-number">{seconds((end - start) / 1000)}</span>
    </div>)}
  </section>
}
