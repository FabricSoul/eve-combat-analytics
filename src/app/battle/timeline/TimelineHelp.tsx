import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/app/ui/Button'
import { clamp } from './model'

const helpItems = [
  '点击跳到某一刻',
  '拖动拖进度',
  'Shift+拖动选一段（只看这段），两端对齐到整秒。拖满 60 秒时对齐到 10 秒，按住 Alt 不对齐',
  'Esc 取消选段',
  '滚轮/双指缩放',
  '方向键逐秒，Shift+方向键以十秒为单位扩展选段',
  'Home/End 跳到当前视图的开头/结尾',
]

const hintKey = 'eve-combat-analytics:timeline-hint-dismissed'
const coarsePointer = '(pointer: coarse)'

export function useCoarsePointer() {
  const [matches, setMatches] = useState(() => window.matchMedia?.(coarsePointer).matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.(coarsePointer)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    media?.addEventListener('change', onChange)
    return () => media?.removeEventListener('change', onChange)
  }, [])
  return matches
}

export function useTimelineHint() {
  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem(hintKey) !== '1'
    } catch {
      return true
    }
  })

  function dismissHint() {
    if (!showHint) return
    setShowHint(false)
    try {
      localStorage.setItem(hintKey, '1')
    } catch {
      // Dismissal still works for this visit when storage is blocked.
    }
  }

  return { showHint, dismissHint }
}

export function TimelineHelp({ touchRange }: { touchRange: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const help = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const button = trigger.current
    const dialog = panel.current
    if (!open || !button || !dialog) return

    const place = () => {
      const anchor = button.getBoundingClientRect()
      const { width, height } = dialog.getBoundingClientRect()
      const style = getComputedStyle(dialog)
      const margin = parseFloat(style.getPropertyValue('--space-4')) || 0
      const gap = parseFloat(style.getPropertyValue('--space-2')) || 0
      const above = anchor.top - gap - height
      const left = clamp(anchor.right - width, margin, window.innerWidth - margin - width)
      const top = clamp(above >= margin ? above : anchor.bottom + gap, margin, window.innerHeight - margin - height)
      dialog.style.setProperty('--help-left', `${left}px`)
      dialog.style.setProperty('--help-top', `${top}px`)
    }
    place()
    dialog.focus({ preventScroll: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    const bar = button.closest('.eca-timeline-bar')
    const stage = button.closest('.battle-stage')
    observer?.observe(dialog)
    if (bar) observer?.observe(bar)
    if (stage) observer?.observe(stage)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !help.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  function closeHelp() {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return <div ref={help} className="eca-timeline-help" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={(event) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    closeHelp()
  }}>
    <Button ref={trigger} variant="ghost" className="eca-timeline-help-trigger" aria-label="时间轴用法"
      title="时间轴用法" aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
      onClick={() => setOpen(!open)}>?</Button>
    <div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1} hidden={!open}
      className="eca-timeline-help-popover">
      <div className="eca-timeline-help-header">
        <h2 id={`${id}-title`}>时间轴使用说明</h2>
        <Button variant="ghost" type="button" aria-label="关闭时间轴使用说明" title="关闭时间轴使用说明" onClick={closeHelp}>×</Button>
      </div>
      <ul>
        {touchRange && <li>点「选段」输入开始和结束时间</li>}
        {helpItems.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  </div>
}
