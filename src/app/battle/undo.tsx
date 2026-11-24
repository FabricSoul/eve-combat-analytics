import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BattleSummary } from '@/core/contract'

type Visible = (summary: BattleSummary) => boolean
type Revert = (publishedVersion: number) => Promise<Visible | void>
type Toast = { label: string; revert?: Revert; visible?: Visible }
type Begin = (optimistic?: Toast) => (result?: Toast) => void
type Notice = {
  id: number
  toast: Toast
  deadline?: number
  remaining: number
  undoStarted?: boolean
}
type Update = (id: number, change: (notice: Notice) => Notice | undefined) => void

const UndoContext = createContext<Begin>(() => () => {})
const applying: Toast = { label: '正在应用…' }
const undoDuration = 10_000
const feedbackDuration = 2500

function waiting(toast: Toast) {
  return toast === applying || toast.visible !== undefined
}

function expire(notice: Notice) {
  if (waiting(notice.toast)) return { ...notice, deadline: undefined, remaining: 0 }
}

function canUndo({ toast, remaining }: Notice) {
  return Boolean(toast.revert && remaining > 0 && !waiting(toast))
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
  const [notices, setNotices] = useState<Notice[]>([])
  const [overflow, setOverflow] = useState<number>()
  const current = useRef<Notice[]>([])
  const nextId = useRef(0)
  const show = useCallback((next: Notice[]) => {
    current.current = next
    setNotices(next)
  }, [])

  const update = useCallback<Update>((id, change) => {
    const notice = current.current.find((entry) => entry.id === id)
    if (!notice) return
    const next = change(notice)
    if (next === notice) return
    show(next
      ? current.current.map((entry) => entry === notice ? next : entry)
      : current.current.filter((entry) => entry !== notice))
  }, [show])

  const begin = useCallback<Begin>((optimistic) => {
    const id = ++nextId.current
    const notice: Notice = {
      id, toast: optimistic ?? applying, deadline: Date.now() + undoDuration, remaining: undoDuration,
    }
    // Completed feedback yields its space when another action begins.
    const active = current.current.filter((entry) => waiting(entry.toast) || canUndo(entry))
    const evicted = active.length >= 3 ? active[0] : undefined
    if (evicted && evicted.remaining > 0) setOverflow(id)
    show([...active, notice].slice(-3))
    return (result) => update(id, (latest) => {
      if (latest.undoStarted) return latest
      if (result) return { ...latest, toast: result }
    })
  }, [show, update])

  useEffect(() => {
    if (overflow === undefined) return
    const timer = setTimeout(() => setOverflow(undefined), feedbackDuration)
    return () => clearTimeout(timer)
  }, [overflow])

  useEffect(() => {
    if (!analyzedSummary) return
    const next = current.current.map((notice) => notice.toast.visible?.(analyzedSummary)
      ? { ...notice, toast: { ...notice.toast, visible: undefined } }
      : notice)
    if (next.some((notice, index) => notice !== current.current[index])) show(next)
  }, [analyzedSummary, notices, show])

  async function undo(id: number) {
    const edit = current.current.find((notice) => notice.id === id)
    const revert = edit?.toast.revert
    if (!edit || !revert || !canUndo(edit)) return
    if (edit.deadline !== undefined && Date.now() >= edit.deadline) return
    update(id, (notice) => ({ ...notice, toast: applying, undoStarted: true }))
    try {
      const visible = await revert(publishedVersion)
      update(id, (notice) => ({
        ...notice, deadline: undefined, remaining: 0, toast: { label: '已撤销', visible: visible || undefined },
      }))
    } catch {
      update(id, (notice) => ({
        ...notice,
        toast: notice.remaining > 0 ? { label: '撤销失败，请重试', revert } : { label: '撤销失败' },
      }))
    }
  }

  const element = notices.length > 0 && <div
    className="pointer-events-none z-[100] mx-auto mt-[var(--space-2)] mb-[calc(var(--space-2)_+_env(safe-area-inset-bottom))] flex max-w-[calc(100%_-_var(--space-4))] flex-none flex-col items-center gap-[var(--space-2)]">
    {notices.map((notice, index) => <UndoNotice key={notice.id} notice={notice} update={update}
      overflow={overflow !== undefined && index === notices.length - 1} onUndo={() => void undo(notice.id)} />)}
  </div>
  // The footer takes up its own space so the stack stays clear of the battle's scrollable rows.
  const workspace = element && !host
    ? 'flex h-dvh flex-col [&>.app-shell--battle]:min-h-0! [&>.app-shell--battle]:flex-1'
    : 'contents'
  return <UndoContext value={begin}>
    <div className={workspace}>
      {children}
      {host ? createPortal(element, host) : element}
    </div>
  </UndoContext>
}

function UndoNotice({ notice, update, overflow, onUndo }: {
  notice: Notice
  update: Update
  overflow: boolean
  onUndo: () => void
}) {
  const { id, deadline, remaining, toast } = notice
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [seconds, setSeconds] = useState(Math.ceil(remaining / 1000))
  const paused = hovered || focused
  const pending = waiting(toast)
  const undoable = canUndo(notice)

  useEffect(() => {
    if (!undoable) setFocused(false)
  }, [undoable])

  useEffect(() => {
    const now = Date.now()
    update(id, (latest) => {
      if (latest.remaining === 0) return latest
      if (paused && latest.deadline !== undefined) {
        const left = latest.deadline - now
        return left > 0 ? { ...latest, deadline: undefined, remaining: left } : expire(latest)
      }
      if (!paused && latest.deadline === undefined) return { ...latest, deadline: now + latest.remaining }
      return latest
    })
  }, [id, paused, update])

  useEffect(() => {
    if (deadline === undefined) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const left = deadline - Date.now()
      if (left <= 0) {
        update(id, (latest) => latest.deadline === deadline ? expire(latest) : latest)
        return
      }
      setSeconds(Math.ceil(left / 1000))
      timer = setTimeout(tick, left % 1000 || 1000)
    }
    tick()
    return () => clearTimeout(timer)
  }, [deadline, id, update])

  useEffect(() => {
    if (pending || undoable) return
    const timer = setTimeout(() => update(id, () => undefined), feedbackDuration)
    return () => clearTimeout(timer)
  }, [id, pending, undoable, update])

  const secondsLeft = deadline === undefined ? Math.ceil(remaining / 1000) : seconds
  return <div className="battle-undo pointer-events-auto"
    style={{ position: 'static', translate: 'none', maxWidth: '100%', whiteSpace: 'normal' }} data-battle-toast=""
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <span role="status">{pending ? applying.label : toast.label}</span>
      {overflow && <div role="status" className="text-[var(--color-text-2)]">
        最早一项改动的撤销时间已结束
      </div>}
    </div>
    {remaining > 0 && (pending || undoable) && <span role="timer" aria-label={`撤销剩余时间 ${secondsLeft} 秒`}
      data-seconds={`${secondsLeft}s`}
      className="min-w-[3ch] shrink-0 text-right [font-family:var(--font-mono)] tabular-nums after:content-[attr(data-seconds)]" />}
    {undoable && <button type="button"
      className="shrink-0 text-[color:var(--color-accent-line)]! [@media(pointer:coarse)]:min-h-[44px]! [@media(pointer:coarse)]:min-w-[44px]"
      onClick={onUndo}>撤销</button>}
  </div>
}
