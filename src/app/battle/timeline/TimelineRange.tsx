import { useId, useLayoutEffect, useRef, useState } from 'react'
import { fmtHms } from '@/app/lib/format'
import type { TimeRange } from '@/app/state/view-store'
import { Button } from '@/app/ui/Button'
import { rangeLabel } from '../RangeChip'
import { clamp, eveTimeInRange, second } from './model'

function suggestedRange(cursor: number, bounds: TimeRange): TimeRange {
  const first = Math.ceil(bounds[0] / second) * second
  const last = Math.floor(bounds[1] / second) * second
  if (first >= last) return bounds
  const duration = 60 * second
  const from = clamp(Math.round(cursor / second) * second, first, Math.max(first, last - duration))
  return [from, Math.min(last, from + duration)]
}

export function TimelineRange({ range, bounds, cursor, setRange, clearRange }: {
  range: TimeRange | null
  bounds: TimeRange
  cursor: number
  setRange(range: TimeRange): void
  clearRange(): void
}) {
  const id = useId()
  const [editing, setEditing] = useState<TimeRange | null>(null)
  const open = editing !== null
  const [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (open) {
      fromInput.current?.focus({ preventScroll: true })
      fromInput.current?.select()
    }
  }, [open])

  function close() {
    setEditing(null)
    setError('')
    trigger.current?.focus({ preventScroll: true })
  }

  function resolve(value: string, previous: number) {
    const clock = value.trim()
    // Keep subsecond precision on an unchanged endpoint from a drag with Alt.
    if (clock === fmtHms(previous) && previous >= bounds[0] && previous <= bounds[1]) return previous
    return eveTimeInRange(clock, previous, bounds)
  }

  return <div className="eca-timeline-range" data-range-editing={open ? '' : undefined} onBlur={(event) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) {
      setEditing(null)
      setError('')
    }
  }} onKeyDown={(event) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    close()
  }}>
    <div className={range ? 'battle-range-chip eca-timeline-range-chip' : undefined}>
      <button ref={trigger} type="button" title={range ? '编辑选段' : '选段'} aria-haspopup="dialog"
        className={range ? undefined : 'app-button eca-timeline-range-start'}
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => open ? close() : setEditing(range ?? suggestedRange(cursor, bounds))}>
        {range ? rangeLabel(range) : '选段'}
      </button>
      {range && <button type="button" title="取消选段" aria-label={`取消${rangeLabel(range)}`} onClick={clearRange}>×</button>}
    </div>
    {editing && <form id={id} className="eca-timeline-range-editor" role="dialog" aria-label="编辑选段"
      aria-describedby={`${id}-bounds`} noValidate onSubmit={(event) => {
        event.preventDefault()
        const from = resolve(fromInput.current?.value ?? '', editing[0])
        const to = resolve(toInput.current?.value ?? '', editing[1])
        if (from === null || to === null) {
          setError('请输入战斗范围内的 EVE 时间（HH:MM:SS）。')
        } else if (from >= to) {
          setError('结束时间必须晚于开始时间。')
        } else {
          setRange([from, to])
          close()
        }
      }}>
      <p id={`${id}-bounds`}>EVE 时间（HH:MM:SS）<br />战斗范围 {fmtHms(bounds[0])}–{fmtHms(bounds[1])}</p>
      <div className="eca-timeline-range-fields">
        <label>开始<input ref={fromInput} defaultValue={fmtHms(editing[0])} autoComplete="off" spellCheck={false} /></label>
        <label>结束<input ref={toInput} defaultValue={fmtHms(editing[1])} autoComplete="off" spellCheck={false} /></label>
      </div>
      {error && <p role="alert" className="eca-timeline-range-error">{error}</p>}
      <div className="eca-timeline-range-actions">
        <Button variant="ghost" onClick={close}>取消</Button>
        <Button variant="primary" type="submit">应用</Button>
      </div>
    </form>}
  </div>
}
