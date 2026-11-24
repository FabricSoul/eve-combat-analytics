import type { CSSProperties } from 'react'
import type { PilotStats } from '@/core/contract'
import { fmtNum, fmtPct } from '../../lib/format'
import { hitSegments } from './hit-quality'
import './hit-quality.css'

export function HitQualityBar({ stats, color, showCounts = false }: {
  stats: Pick<PilotStats, 'hitQuality' | 'misses'>; color: string; showCounts?: boolean
}) {
  const segments = hitSegments(stats)
  if (!segments.length) return null
  const description = segments.map(({ label, count, share }) => `${label} ${fmtNum(count)}（${fmtPct(share)}）`).join('、')
  return <>
    <div className="u7-hit-quality" role="img" aria-label={description} title={description}
      style={{ '--quality-side': color } as CSSProperties}>
      {segments.map(({ key, share, strength }) => <span key={key} data-quality={key}
        style={{ width: `${share * 100}%`, '--quality-strength': `${strength}%` } as CSSProperties} />)}
    </div>
    {showCounts && <ul className="u7-hit-counts">{segments.map(({ key, label, count, share }) => (
      <li key={key}>{label} <span className="app-number">{fmtNum(count)} · {fmtPct(share)}</span></li>
    ))}</ul>}
  </>
}
