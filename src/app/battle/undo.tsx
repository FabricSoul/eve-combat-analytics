import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Revert = () => Promise<unknown>
type Offer = (label: string, revert: Revert) => void
type Toast = { label: string; revert?: Revert }
const UndoContext = createContext<Offer>(() => {})

export function useBattleUndo() { return useContext(UndoContext) }

export function BattleUndo({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const current = useRef<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((next: Toast) => {
    clearTimeout(timer.current)
    current.current = next
    setToast(next)
    timer.current = setTimeout(() => {
      current.current = null
      setToast(null)
    }, 6000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const offer = useCallback<Offer>((label, revert) => show({ label, revert }), [show])

  async function undo() {
    const edit = current.current
    if (!edit?.revert) return
    const pending = { label: '正在撤销…' }
    show(pending)
    try {
      await edit.revert()
      if (current.current === pending) show({ label: '已撤销' })
    } catch {
      if (current.current === pending) show({ label: '撤销失败，请重试', revert: edit.revert })
    }
  }

  return <UndoContext value={offer}>
    {children}
    {toast && <div className="battle-undo">
      <span role="status">{toast.label}</span>
      {toast.revert && <button type="button" onClick={() => void undo()}>撤销</button>}
    </div>}
  </UndoContext>
}
