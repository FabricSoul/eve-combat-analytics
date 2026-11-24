import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { BattleSummary } from '@/core/contract'

type Visible = (summary: BattleSummary) => boolean
type Revert = (publishedVersion: number) => Promise<Visible | void>
type Toast = { label: string; revert?: Revert; visible?: Visible }
type Begin = () => (result?: Toast) => void
const UndoContext = createContext<Begin>(() => () => {})
const applying: Toast = { label: '正在应用…' }

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
  const [toast, setToast] = useState<Toast | null>(null)
  const current = useRef<Toast | null>(null)
  const show = useCallback((next: Toast | null) => {
    current.current = next
    setToast(next)
  }, [])

  const begin = useCallback<Begin>(() => {
    const pending = { ...applying }
    show(pending)
    return (result) => {
      if (current.current === pending) show(result ?? null)
    }
  }, [show])

  useEffect(() => {
    if (toast?.visible && analyzedSummary && toast.visible(analyzedSummary)) show({ ...toast, visible: undefined })
  }, [analyzedSummary, show, toast])

  useEffect(() => {
    if (!toast || toast.label === applying.label || toast.visible) return
    const timer = setTimeout(() => { if (current.current === toast) show(null) }, toast.revert ? 9000 : 2500)
    return () => clearTimeout(timer)
  }, [show, toast])

  async function undo() {
    const edit = current.current
    if (!edit?.revert || edit.visible) return
    const finish = begin()
    try {
      const visible = await edit.revert(publishedVersion)
      finish({ label: '已撤销', visible: visible || undefined })
    } catch {
      finish({ label: '撤销失败，请重试', revert: edit.revert })
    }
  }

  const pending = toast?.visible !== undefined
  const notice = toast && <div className="battle-undo" data-battle-toast="">
    <span role="status">{pending ? applying.label : toast.label}</span>
    {!pending && toast.revert && <button type="button" onClick={() => void undo()}>撤销</button>}
  </div>
  return <UndoContext value={begin}>
    {children}
    {host ? createPortal(notice, host) : notice}
  </UndoContext>
}
