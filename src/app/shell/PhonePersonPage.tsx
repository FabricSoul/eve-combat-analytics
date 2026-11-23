import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function PhonePersonPage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  return <dialog ref={ref} className="battle-person-page" aria-label="个人详情" onCancel={(event) => event.preventDefault()}>
    {children}
  </dialog>
}
