import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BattleSummary } from '@/core/contract'

type Visible = (summary: BattleSummary) => boolean
type Revert = (publishedVersion: number) => Promise<Visible | void>
type Toast = { label: string; revert?: Revert; visible?: Visible }
type Begin = (optimistic?: Toast) => (result?: Toast) => void
type Countdown = { deadline: number | undefined; remaining: number }
type Notice = { toast: Toast; countdown: Countdown; expired: boolean }

const UndoContext = createContext<Begin>(() => () => {})
const applying: Toast = { label: '正在应用…' }
const undoDuration = 10_000

function waiting(toast: Toast) {
  return toast === applying || toast.visible !== undefined
}

export function useBattleUndo() { return useContext(UndoContext) }

export function visibleAfter(version: number, predicate: Visible): Visible {
  return (state) => state.analysisVersion > version && predicate(state)
}

export function BattleUndo({ children, analyzedSummary, publishedVersion = -1, host }: {
  children: ReactNode
  analyzedSummary?: BattleSummary | null
  publishedVersion?: number
  host?: HTMLElement | null
}) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const current = useRef<Notice | null>(null)
  const show = useCallback((next: Notice | null) => {
    current.current = next
    setNotice(next)
  }, [])

  const begin = useCallback<Begin>((optimistic) => {
    const countdown = { deadline: Date.now() + undoDuration, remaining: undoDuration }
    show({ countdown, toast: optimistic ?? applying, expired: false })
    return (result) => {
      const latest = current.current
      if (latest?.countdown === countdown) show(result ? { ...latest, toast: result } : null)
    }
  }, [show])

  const countdown = notice?.countdown
  const paused = hovered || focused
  useEffect(() => {
    if (!countdown || countdown.remaining === 0) return

    function expire() {
      if (!countdown) return
      countdown.remaining = 0
      const latest = current.current
      if (latest?.countdown !== countdown) return
      if (waiting(latest.toast)) show({ ...latest, expired: true })
      else if (latest.toast.revert) show(null)
    }

    if (paused) {
      if (countdown.deadline !== undefined) {
        countdown.remaining = Math.max(0, countdown.deadline - Date.now())
        countdown.deadline = undefined
        if (countdown.remaining === 0) expire()
      }
      return
    }
    countdown.deadline ??= Date.now() + countdown.remaining
    const timer = setTimeout(expire, Math.max(0, countdown.deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [countdown, paused, show])

  useEffect(() => {
    const visible = notice?.toast.visible
    if (visible && analyzedSummary && visible(analyzedSummary)) {
      show({ ...notice, toast: { ...notice.toast, visible: undefined } })
    }
  }, [analyzedSummary, notice, show])

  const pending = notice !== null && waiting(notice.toast)
  const canUndo = Boolean(notice?.toast.revert && !notice.expired && !pending)
  const showing = notice !== null
  useEffect(() => {
    if (!showing) setHovered(false)
    if (!canUndo) setFocused(false)
  }, [canUndo, showing])

  useEffect(() => {
    if (!notice || pending || canUndo) return
    const timer = setTimeout(() => { if (current.current === notice) show(null) }, 2500)
    return () => clearTimeout(timer)
  }, [canUndo, notice, pending, show])

  async function undo() {
    const edit = current.current
    if (!edit?.toast.revert || waiting(edit.toast) || edit.expired) return
    if (edit.countdown.deadline !== undefined && Date.now() >= edit.countdown.deadline) return
    const finish = begin()
    try {
      const visible = await edit.toast.revert(publishedVersion)
      finish({ label: '已撤销', visible: visible || undefined })
    } catch {
      finish({ label: '撤销失败，请重试', revert: edit.toast.revert })
    }
  }

  const element = notice && <div className="battle-undo" data-battle-toast=""
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    <span role="status">{pending ? applying.label : notice.toast.label}</span>
    {canUndo && <button type="button" onClick={() => void undo()}>撤销</button>}
  </div>
  return <UndoContext value={begin}>
    {children}
    {host ? createPortal(element, host) : element}
  </UndoContext>
}
