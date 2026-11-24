import { fmtHms } from '../lib/format'
import type { TimeRange } from '../state/view-store'
import './range-chip.css'

export function rangeLabel(range: TimeRange) {
  return `选段 ${fmtHms(range[0])}–${fmtHms(range[1])}`
}

export function RangeChip({ range, clearRange, label }: {
  range: TimeRange; clearRange(): void; label?: string
}) {
  return <button type="button" className="battle-range-chip" title="取消选段"
    aria-label={`取消${rangeLabel(range)}`} onClick={clearRange}>
    {label ?? rangeLabel(range)} <span aria-hidden="true">×</span>
  </button>
}
