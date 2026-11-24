import { useId, useLayoutEffect, useRef, useState } from 'react'
import { fmtHms } from '@/app/lib/format'
import type { TimeRange } from '@/app/state/view-store'
import { Button } from '@/app/ui/Button'
import { rangeLabel } from '../RangeChip'
import { eveTimeInRange } from './model'

export function TimelineRange({ range, bounds, setRange, clearRange }: {
  range: TimeRange
  bounds: TimeRange
  setRange(range: TimeRange): void
  clearRange(): void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
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
    setOpen(false)
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
      setOpen(false)
      setError('')
    }
  }} onKeyDown={(event) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    close()
  }}>
    <div className="battle-range-chip eca-timeline-range-chip">
      <button ref={trigger} type="button" title="编辑选段" aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : setOpen(true)}>
        {rangeLabel(range)}
      </button>
      <button type="button" title="取消选段" aria-label={`取消${rangeLabel(range)}`} onClick={clearRange}>×</button>
    </div>
    {open && <form id={id} className="eca-timeline-range-editor" role="dialog" aria-label="编辑选段"
      aria-describedby={`${id}-bounds`} noValidate onSubmit={(event) => {
        event.preventDefault()
        const from = resolve(fromInput.current?.value ?? '', range[0])
        const to = resolve(toInput.current?.value ?? '', range[1])
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
        <label>开始<input ref={fromInput} defaultValue={fmtHms(range[0])} autoComplete="off" spellCheck={false} /></label>
        <label>结束<input ref={toInput} defaultValue={fmtHms(range[1])} autoComplete="off" spellCheck={false} /></label>
      </div>
      {error && <p role="alert" className="eca-timeline-range-error">{error}</p>}
      <div className="eca-timeline-range-actions">
        <Button variant="ghost" onClick={close}>取消</Button>
        <Button variant="primary" type="submit">应用</Button>
      </div>
    </form>}
  </div>
}
