import { fmtNum, fmtPct } from '../../lib/format'
import { noHitQualityReason } from '../compare/hit-quality'
import { observedLabel } from '../compare/metrics'
import { classLabels, hitMetrics, hitObservationHint, shotTotal, type ShotCounts, type WeaponClass } from './analysis'

export function HitRateValue({ counts }: { counts?: ShotCounts }) {
  const rate = counts ? hitMetrics.hitRate.value(counts) : null
  return <span className="app-number" title={rate === null ? noHitQualityReason : undefined}>
    {fmtPct(rate)}{rate === null && <span className="sr-only"> {noHitQualityReason}</span>}
  </span>
}

export function UngradedShots({ count, detailed = false }: { count: number; detailed?: boolean }) {
  return <span className="hit-ungraded" title="立体炸弹、破袭等无命中质量的伤害另计。命中率和排名样本只统计有质量的命中和明确未命中。">
    {detailed ? '无命中质量（立体炸弹、破袭等）' : '无命中质量 '}<span className="app-number">{fmtNum(count)}</span> 发
  </span>
}

export function ObservedHitSample({ shots }: { shots: number }) {
  return <small className="u7-hit-sample" title={hitObservationHint}>
    {observedLabel} · <span className="app-number">{fmtNum(shots)} 发</span>
  </small>
}

export function WeaponClasses({ classes }: { classes: ReadonlyMap<WeaponClass, ShotCounts> }) {
  return <dl className="hit-classes">
    {(Object.keys(classLabels) as WeaponClass[]).map((kind) => {
      const counts = classes.get(kind)
      if (kind === 'other' && !counts) return null
      return <div key={kind}>
        <dt>{classLabels[kind]}</dt>
        <dd className="app-number">{fmtNum(counts ? shotTotal(counts) : 0)} 发
          {kind !== 'smartbomb' && <> · <HitRateValue counts={counts} />
            {counts && counts.shots > 0 && counts.ungraded > 0 && <>（{fmtNum(counts.shots)} 发样本）</>}
          </>}
        </dd>
      </div>
    })}
  </dl>
}

export function WeaponClassSummary({ classes }: { classes: ReadonlyMap<WeaponClass, ShotCounts> }) {
  const summary = [...classes].map(([kind, counts]) => {
    const rate = kind === 'smartbomb' ? '' : ` · ${fmtPct(hitMetrics.hitRate.value(counts))}`
    const sample = rate && counts.shots > 0 && counts.ungraded > 0 ? `（${fmtNum(counts.shots)} 发样本）` : ''
    return `${classLabels[kind]} ${fmtNum(shotTotal(counts))} 发${rate}${sample}`
  }).join(' / ')
  return <span className="hit-table-text" title={summary}>{summary}</span>
}
