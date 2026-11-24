import { fmtNum, fmtPct } from '../../lib/format'
import { classLabels, hitMetrics, type ShotCounts, type WeaponClass } from './analysis'

export function WeaponClasses({ classes }: { classes: ReadonlyMap<WeaponClass, ShotCounts> }) {
  return <dl className="hit-classes">
    {(Object.keys(classLabels) as WeaponClass[]).map((kind) => {
      const counts = classes.get(kind)
      if (kind === 'other' && !counts) return null
      return <div key={kind}>
        <dt>{classLabels[kind]}</dt>
        <dd className="app-number">{fmtNum(counts?.shots ?? 0)} 发 · {fmtPct(counts ? hitMetrics.hitRate.value(counts) : null)}</dd>
      </div>
    })}
  </dl>
}
