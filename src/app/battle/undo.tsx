import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BattleSummary } from '@/core/contract'
import { useBattleContext } from '../state/battle-store'

type Visible = (summary: BattleSummary) => boolean
type Revert = (publishedVersion: number) => Promise<Visible | { unavailable: string } | void>
type Conflict = { label: string; when: Visible }
type Toast = { label: string; revert?: Revert; visible?: Visible; conflict?: Conflict }
type Begin = (optimistic?: Toast) => (result?: Toast) => void
type Notice = {
  id: number
  toast: Toast
  deadline?: number
  remaining: number
  undoStarted?: boolean
}
type Update = (id: number, change: (notice: Notice) => Notice | undefined, promote?: boolean) => void

const UndoContext = createContext<Begin>(() => () => {})
const applying: Toast = { label: '正在应用…' }
const undoDuration = 10_000
const feedbackDuration = 2500
const fullNoticeCount = 3
const stackItemStyle = { position: 'static', translate: 'none', maxWidth: '100%', whiteSpace: 'normal' } as const
const touchTarget = 'max-[760px]:min-h-[44px]! max-[760px]:min-w-[44px] pointer-coarse:min-h-[44px]! pointer-coarse:min-w-[44px]'

function waiting(toast: Toast) {
  return toast === applying || toast.visible !== undefined
}

function expire(notice: Notice) {
  if (waiting(notice.toast)) return { ...notice, deadline: undefined, remaining: 0 }
}

function canUndo({ toast, remaining }: Notice) {
  return Boolean(toast.revert && remaining > 0 && !waiting(toast))
}

function feedback(notice: Notice, toast: Toast): Notice {
  return { ...notice, deadline: undefined, remaining: 0, toast }
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
  const [expanded, setExpanded] = useState(false)
  const expandedAtPointerDown = useRef<boolean | undefined>(undefined)
  const stackId = useId()
  const current = useRef<Notice[]>([])
  const nextId = useRef(0)
  const show = useCallback((next: Notice[]) => {
    current.current = next
    setNotices(next)
  }, [])

  const update = useCallback<Update>((id, change, promote) => {
    const notice = current.current.find((entry) => entry.id === id)
    if (!notice) return
    const next = change(notice)
    if (next === notice) return
    if (next && !promote) {
      show(current.current.map((entry) => entry === notice ? next : entry))
    } else {
      const rest = current.current.filter((entry) => entry !== notice)
      show(next ? [...rest, next] : rest)
    }
  }, [show])

  const begin = useCallback<Begin>((optimistic) => {
    const id = ++nextId.current
    const notice: Notice = {
      id, toast: optimistic ?? applying, deadline: Date.now() + undoDuration, remaining: undoDuration,
    }
    // Completed feedback yields its space when another action begins.
    const active = current.current.filter((entry) => waiting(entry.toast) || canUndo(entry))
    show([...active, notice])
    return (result) => update(id, (latest) => {
      if (latest.undoStarted) return latest
      if (result) return { ...latest, toast: result }
    })
  }, [show, update])

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
      const result = await revert(publishedVersion)
      if (typeof result === 'object') {
        update(id, (notice) => feedback(notice, { label: result.unavailable }), true)
      } else {
        update(id, (notice) => feedback(notice, { label: '已撤销', visible: result || undefined }))
      }
    } catch {
      update(id, (notice) => ({
        ...notice,
        toast: notice.remaining > 0 ? { ...edit.toast, label: '撤销失败，请重试' } : { label: '撤销失败' },
      }))
    }
  }

  const firstFullNotice = Math.max(0, notices.length - fullNoticeCount)
  const older = notices.slice(0, firstFullNotice)
  const olderCount = older.filter((notice) => notice.remaining > 0).length
  const showOlder = olderCount > 0 && expanded
  useEffect(() => {
    if (olderCount === 0) setExpanded(false)
  }, [olderCount])

  const element = notices.length > 0 && <div className={[
    'z-[100] mx-auto mt-[var(--space-2)] mb-[calc(var(--space-2)_+_env(safe-area-inset-bottom))] flex max-w-[calc(100%_-_var(--space-4))] flex-none flex-col items-center gap-[var(--space-2)]',
    showOlder ? 'max-h-[75dvh] overflow-y-auto px-[var(--space-1)] py-[var(--space-1)]' : 'pointer-events-none',
  ].join(' ')}>
    {olderCount > 0 && <button type="button" className={`battle-undo pointer-events-auto shrink-0 cursor-pointer ${touchTarget}`}
      style={stackItemStyle} aria-expanded={showOlder} aria-controls={older.map(({ id }) => `${stackId}-${id}`).join(' ')}
      onFocus={() => setExpanded(true)}
      onPointerDown={() => { expandedAtPointerDown.current = showOlder }}
      onClick={(event) => {
        // A pointer can focus and open the row before its click arrives.
        const wasExpanded = event.detail > 0 ? expandedAtPointerDown.current : undefined
        expandedAtPointerDown.current = undefined
        setExpanded(!(wasExpanded ?? showOlder))
      }}>
      还有 {olderCount} 项可撤销
      <span aria-hidden="true" className={`size-2 border-r border-b ${showOlder ? 'rotate-225' : 'rotate-45'}`} />
    </button>}
    {/* Keep every timer mounted as its toast moves into or out of the overflow. */}
    {notices.map((notice, index) => <UndoNotice key={notice.id} notice={notice} update={update}
      domId={`${stackId}-${notice.id}`} shown={index >= firstFullNotice || showOlder} onUndo={() => void undo(notice.id)} />)}
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

function WatchUndoConflict({ id, conflict, update }: { id: number; conflict: Conflict; update: Update }) {
  const { summary } = useBattleContext()
  useLayoutEffect(() => {
    if (summary && conflict.when(summary)) {
      update(id, (notice) => notice.toast.conflict === conflict ? feedback(notice, { label: conflict.label }) : notice, true)
    }
  }, [id, conflict, summary, update])
  return null
}

function UndoNotice({ notice, update, domId, shown, onUndo }: {
  notice: Notice
  update: Update
  domId: string
  shown: boolean
  onUndo: () => void
}) {
  const { id, deadline, remaining, toast } = notice
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [seconds, setSeconds] = useState(Math.ceil(remaining / 1000))
  const paused = shown && (hovered || focused)
  const pending = waiting(toast)
  const undoable = canUndo(notice)

  useEffect(() => {
    if (!shown) setHovered(false)
    if (!shown || !undoable) setFocused(false)
  }, [shown, undoable])

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
  return <div className="battle-undo pointer-events-auto shrink-0" id={domId}
    style={shown ? stackItemStyle : { display: 'none' }} hidden={!shown} data-battle-toast=""
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    }}>
    {toast.conflict && <WatchUndoConflict id={id} conflict={toast.conflict} update={update} />}
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <span role="status">{pending ? applying.label : toast.label}</span>
    </div>
    {remaining > 0 && (pending || undoable) && <span role="timer" aria-label={`撤销剩余时间 ${secondsLeft} 秒`}
      data-seconds={`${secondsLeft}s`}
      className="min-w-[3ch] shrink-0 text-right [font-family:var(--font-mono)] tabular-nums after:content-[attr(data-seconds)]" />}
    {undoable && <button type="button"
      className={`shrink-0 text-[color:var(--color-accent-line)]! ${touchTarget}`}
      onClick={onUndo}>撤销</button>}
  </div>
}
