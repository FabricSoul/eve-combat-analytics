import { useId, type KeyboardEvent, type ReactNode } from 'react'

export interface TabOption<T extends string> {
  value: T
  label: ReactNode
}

export interface TabsProps<T extends string> {
  tabs: readonly TabOption<T>[]
  value: T
  onChange(value: T): void
  label: string
  id?: string
}

export function Tabs<T extends string>({ tabs, value, onChange, label, id }: TabsProps<T>) {
  const generatedId = useId()
  const baseId = id ?? generatedId

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.value === value)
    let index: number
    switch (event.key) {
      case 'ArrowLeft': index = (current + tabs.length - 1) % tabs.length; break
      case 'ArrowRight': index = (current + 1) % tabs.length; break
      case 'Home': index = 0; break
      case 'End': index = tabs.length - 1; break
      default: return
    }
    const next = tabs[index]
    if (!next) return
    event.preventDefault()
    onChange(next.value)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
  }

  return (
    <div className="app-tabs" role="tablist" aria-label={label} onKeyDown={navigate}>
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" id={`${baseId}-tab-${tab.value}`}
          aria-selected={tab.value === value} aria-controls={id ? `${baseId}-panel-${tab.value}` : undefined}
          tabIndex={tab.value === value ? 0 : -1} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
