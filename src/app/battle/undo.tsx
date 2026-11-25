import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BattleSummary, IdentityMerge, SideSubject } from '@/core/contract'
import { normalizeRevision, type EditRevision, type ObservedEdit, type VersionedFit } from '../api/client'
import { useOptionalBattleContext, type EditRevisions } from '../state/battle-store'

type Visible = (summary: BattleSummary) => boolean
type ReadRevisions = () => EditRevisions | undefined
type RevertedEdits = { complete: number[]; partialTargets: string[][] }
type Revert = (publishedVersion: number, readRevisions: ReadRevisions) => Promise<Visible | { unavailable: string } | { reverted: RevertedEdits; skipped?: string } | void>
type ConflictStatus = { label: string; partial?: true }
type Conflict = { label: string; when: (summary: BattleSummary, revisions?: EditRevisions) => boolean }
  | { status: (summary: BattleSummary, revisions?: EditRevisions) => ConflictStatus | undefined }
type Toast = { label: string; revert?: Revert; visible?: Visible; conflict?: Conflict; pending?: true }
type Finish = ((result?: Toast) => void) & { id: number }
type Begin = (optimistic?: Toast) => Finish
type Notice = {
  id: number
  toast: Toast
  conflictLabel?: string
  deadline?: number
  remaining: number
  undoStarted?: boolean
}
type Update = (id: number, change: (notice: Notice) => Notice | undefined, promote?: boolean) => void

const UndoContext = createContext<Begin>(() => Object.assign(() => {}, { id: 0 }))
const EditHistoryContext = createContext<ReturnType<typeof createHistories> | null>(null)
const applying: Toast = { label: '正在应用…', pending: true }
const reverting: Toast = { label: '正在撤销…', pending: true }
const undoDuration = 10_000
const feedbackDuration = 2500
const fullNoticeCount = 3
const stackItemStyle = { position: 'static', translate: 'none', maxWidth: '100%', whiteSpace: 'normal' } as const
const touchTarget = 'max-[760px]:min-h-[44px]! max-[760px]:min-w-[44px] pointer-coarse:min-h-[44px]! pointer-coarse:min-w-[44px]'

function waiting(toast: Toast) {
  return toast.pending || toast.visible !== undefined
}

function expire(notice: Notice) {
  if (waiting(notice.toast)) return { ...notice, deadline: undefined, remaining: 0 }
}

function canUndo({ toast, remaining }: Notice) {
  return Boolean(toast.revert && remaining > 0 && !toast.visible)
}

function feedback(notice: Notice, toast: Toast): Notice {
  return { ...notice, deadline: undefined, remaining: 0, conflictLabel: undefined, toast }
}

export function useBattleUndo() { return useContext(UndoContext) }

type Revision<T> = { tag: string | null; value: T; sequence?: number }
type Head<T> = Revision<T> & { edit?: Edit<T>; overwritten?: T }
type Edit<T> = { id: number; before: Map<string, Head<T>>; tags: Map<string, string>; related: readonly string[] }

function revisionTarget(key: string) {
  return key.slice(key.indexOf('/') + 1)
}

function restoreLabel({ complete, partialTargets }: RevertedEdits, summary?: BattleSummary | null) {
  const count = complete.length + partialTargets.length
  if (count <= 1) return '已撤销'
  const countLabel = `撤销了 ${count} 次修改`
  if (!partialTargets.length) return countLabel
  const names = new Set(partialTargets.flat().map((target) => {
    const subject = target.replace(/^side:/, '')
    const id = Number(subject.split(':')[1])
    return summary?.meta.names[id]?.name ?? summary?.logs.find(({ charId }) => charId === id)?.charName ?? subject
  }))
  return `${countLabel}（含 ${[...names].join('、')} 的批量恢复）`
}

// A receipt links to a local edit only when the server confirms it was the immediate predecessor.
// Keep the chain at the battle level so a toast can outlive its menu or drawer.
class EditHistory<T> {
  private heads = new Map<string, Head<T>>()
  private edits: Edit<T>[] = []
  private observed = new Map<string, EditRevision>()
  private queue = Promise.resolve()
  private pending = new Map<string, number>()

  current(key: string) { return this.heads.get(key) }
  isPending(key: string) { return this.pending.has(key) }

  run<R>(key: string, action: () => Promise<R>): Promise<R> {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    const result = this.queue.then(action).finally(() => {
      const remaining = this.pending.get(key)! - 1
      if (remaining) this.pending.set(key, remaining)
      else this.pending.delete(key)
    })
    this.queue = result.then(() => {}, () => {})
    return result
  }

  clear() {
    this.heads.clear()
    this.edits = []
    this.observed.clear()
  }

  observe(revisions: readonly ObservedEdit[]) {
    for (const { target, revision, sequence } of revisions) {
      if (sequence > (this.observed.get(target)?.sequence ?? -1)) {
        this.observed.set(target, { revision: normalizeRevision(revision), sequence })
      }
    }
  }

  record(id: number, changes: { key: string; before: Revision<T>; after: Revision<T> & { tag: string } }[], related: readonly string[] = []) {
    const edit: Edit<T> = { id, before: new Map(), tags: new Map(), related }
    for (const { key, before, after } of changes) {
      const head = this.heads.get(key)
      const tag = before.tag === null ? null : normalizeRevision(before.tag)
      edit.before.set(key, head?.tag === tag ? { ...head, value: before.value } : { ...before, tag })
      const nextTag = normalizeRevision(after.tag)
      edit.tags.set(key, nextTag)
      this.heads.set(key, { ...after, tag: nextTag, edit, overwritten: before.value })
    }
    if (related.length) this.edits.push(edit)
    return edit
  }

  private chain(target: Edit<T>, key: string, revisions?: EditRevisions) {
    const head = this.heads.get(key)
    const subject = revisionTarget(key)
    const live = revisions?.get(subject)
    const remembered = this.observed.get(subject)
    const observed = remembered && (!live || remembered.sequence > live.sequence) ? remembered : live
    if (!head?.tag) return
    if (observed && head.sequence !== undefined && observed.sequence > head.sequence && observed.revision !== head.tag) {
      // A paused toast can outlive the battle store's recent revisions.
      this.observed.set(subject, observed)
      return
    }
    const chain: Edit<T>[] = []
    for (let edit = head.edit; edit; edit = edit.before.get(key)?.edit) {
      chain.push(edit)
      if (edit === target) return chain
    }
  }

  eligibility(edit: Edit<T>, revisions?: EditRevisions) {
    const excluded: T[] = []
    let available = false
    for (const [key, before] of edit.before) {
      if (this.chain(edit, key, revisions)) available = true
      else excluded.push(before.value)
    }
    return { available, excluded }
  }

  canRevert(edit: Edit<T>, revisions?: EditRevisions) {
    return this.eligibility(edit, revisions).available
  }

  plan(target: Edit<T>, revisions?: EditRevisions, includeRelated = true) {
    const selected = new Map<Edit<T>, Set<string>>()
    const restored = new Map<string, { before: Head<T>; edit: Edit<T> }>()
    const collect = (edit: Edit<T>, key: string) => {
      const current = restored.get(key)
      if (current && current.edit.id <= edit.id) return
      const chain = this.chain(edit, key, revisions)
      if (!chain) return
      restored.set(key, { before: edit.before.get(key)!, edit })
      for (const member of chain) {
        const keys = selected.get(member) ?? new Set<string>()
        keys.add(key)
        selected.set(member, keys)
      }
    }
    for (const key of target.before.keys()) collect(target, key)
    if (!restored.size) return
    let includesRelated = false
    // Map iteration also visits newly selected edits. Each subject has its own predecessor chain.
    for (const [edit, keys] of selected) {
      for (const key of edit.before.keys()) collect(edit, key)
      if (!includeRelated) continue
      for (const candidate of this.edits) {
        if (candidate.id <= edit.id || !(edit.related.some((key) => candidate.tags.has(key)) ||
          candidate.related.some((key) => keys.has(key)))) continue
        const count = restored.size
        for (const key of candidate.before.keys()) collect(candidate, key)
        includesRelated ||= restored.size > count
      }
    }
    const reverted: RevertedEdits = { complete: [], partialTargets: [] }
    for (const [edit, keys] of selected) {
      if (keys.size === edit.before.size) reverted.complete.push(edit.id)
      else reverted.partialTargets.push([...keys].map(revisionTarget))
    }
    return {
      changes: [...restored].map(([key, { before, edit }]) => ({
        key, value: before.value, through: edit.tags.get(key)!, tag: this.heads.get(key)!.tag!,
      })),
      reverted,
      includesRelated,
      commit: (read: (key: string, restored: T) => Revision<T>) => {
        for (const [key, { before }] of restored) {
          const overwritten = this.heads.get(key)!.value
          this.heads.set(key, { ...read(key, before.value), edit: before.edit, overwritten })
        }
        for (const [edit, keys] of selected) {
          for (const key of keys) {
            edit.before.delete(key)
            edit.tags.delete(key)
          }
        }
        this.edits = this.edits.filter((edit) => edit.before.size > 0)
      },
    }
  }
}

function createHistories() {
  return {
    fit: new EditHistory<VersionedFit | undefined>(),
    side: new EditHistory<SideSubject>(),
    identity: new EditHistory<IdentityMerge | null>(),
  }
}

export function useEditHistory<K extends keyof ReturnType<typeof createHistories>>(kind: K) {
  const shared = useContext(EditHistoryContext)
  const [local] = useState(createHistories)
  return (shared ?? local)[kind]
}

export function BattleUndo({ children, analyzedSummary, publishedVersion = -1, host }: {
  children: ReactNode
  analyzedSummary?: BattleSummary | null
  publishedVersion?: number
  host?: HTMLElement | null
}) {
  const battle = useOptionalBattleContext()
  const liveRevisions = useRef(battle?.editRevisions)
  liveRevisions.current = battle?.editRevisions
  const [notices, setNotices] = useState<Notice[]>([])
  const [histories] = useState(createHistories)
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
    let resolveReceipt!: (result: Toast | undefined) => void
    const receipt = new Promise<Toast | undefined>((resolve) => { resolveReceipt = resolve })
    const revert: Revert = async (version, readRevisions) => {
      const result = await receipt
      return result?.revert ? result.revert(version, readRevisions) : { unavailable: '无法撤销，未收到修改确认' }
    }
    const notice: Notice = {
      id, toast: optimistic ?? { ...applying, revert }, deadline: Date.now() + undoDuration, remaining: undoDuration,
    }
    // Completed feedback yields its space when another action begins.
    const active = current.current.filter((entry) => waiting(entry.toast) || canUndo(entry))
    if (!active.length) {
      histories.fit.clear()
      histories.side.clear()
      histories.identity.clear()
    }
    show([...active, notice])
    const finish: Finish = Object.assign((result?: Toast) => {
      resolveReceipt(result)
      update(id, (latest) => {
        if (latest.undoStarted) return latest
        if (result) return { ...latest, toast: result }
      })
    }, { id })
    return finish
  }, [histories, show, update])

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
    update(id, (notice) => ({ ...notice, toast: reverting, conflictLabel: undefined, undoStarted: true }))
    try {
      const result = await revert(publishedVersion, () => liveRevisions.current)
      if (result && typeof result === 'object' && 'reverted' in result) {
        const restored = restoreLabel(result.reverted, battle?.summary ?? analyzedSummary)
        const label = result.skipped ? `${restored} · ${result.skipped}` : restored
        const reverted = new Set(result.reverted.complete)
        show(current.current.flatMap((notice) => notice.id === id ? [feedback(notice, { label })]
          : reverted.has(notice.id) ? [] : [notice]))
      } else if (typeof result === 'object') {
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
  return <UndoContext value={begin}><EditHistoryContext value={histories}>
    <div className={workspace}>
      {children}
      {host ? createPortal(element, host) : element}
    </div>
  </EditHistoryContext></UndoContext>
}

function WatchUndoConflict({ id, conflict, update }: { id: number; conflict: Conflict; update: Update }) {
  const battle = useOptionalBattleContext()
  useLayoutEffect(() => {
    if (!battle?.summary) return
    const { summary, editRevisions } = battle
    const status = 'when' in conflict
      ? (conflict.when(summary, editRevisions) ? { label: conflict.label, partial: false } : undefined)
      : conflict.status(summary, editRevisions)
    if (!status) return
    if (status.partial) update(id, (notice) => notice.toast.conflict === conflict && notice.conflictLabel !== status.label
      ? { ...notice, conflictLabel: status.label } : notice)
    else update(id, (notice) => notice.toast.conflict === conflict ? feedback(notice, { label: status.label }) : notice, true)
  })
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
      <span role="status">{toast.visible ? applying.label : notice.conflictLabel ?? toast.label}</span>
    </div>
    {remaining > 0 && (pending || undoable) && <span role="timer" aria-label={`撤销剩余时间 ${secondsLeft} 秒`}
      data-seconds={`${secondsLeft}s`}
      className="min-w-[3ch] shrink-0 text-right [font-family:var(--font-mono)] tabular-nums after:content-[attr(data-seconds)]" />}
    {undoable && <button type="button"
      className={`shrink-0 text-[color:var(--color-accent-line)]! ${touchTarget}`}
      onClick={onUndo}>撤销</button>}
  </div>
}
