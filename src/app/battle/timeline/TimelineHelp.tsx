import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/app/ui/Button'

const helpItems = [
  '点击跳到某一刻',
  '拖动拖进度',
  'Shift+拖动选一段（只看这段）',
  'Esc 取消选段',
  '滚轮/双指缩放',
  '方向键逐秒，Shift+方向键以十秒为单位扩展选段',
  'Home/End 跳到当前视图的开头/结尾',
]

const hintKey = 'eve-combat-analytics:timeline-hint-dismissed'

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

export function TimelineHelp() {
  const id = useId()
  const [open, setOpen] = useState(false)
  const help = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !help.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return <div ref={help} className="eca-timeline-help" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={(event) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }}>
    <Button ref={trigger} variant="ghost" className="eca-timeline-help-trigger" aria-label="时间轴用法"
      title="时间轴用法" aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
      onClick={() => setOpen(!open)}>?</Button>
    <div ref={panel} id={id} role="dialog" aria-label="时间轴用法" tabIndex={-1} hidden={!open}
      className="eca-timeline-help-popover">
      <ul>{helpItems.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  </div>
}
