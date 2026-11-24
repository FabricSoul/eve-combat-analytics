import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Button } from '../ui/Button'

export interface SideChoice {
  side: number
  label: string
  color: string
  letter: string | null
}

interface SidePickerProps {
  choices: readonly SideChoice[]
  value: number | undefined
  onChange(side: number): void
}

function Swatch({ color, letter }: Pick<SideChoice, 'color' | 'letter'>) {
  return <>
    <span className="app-side-picker-dot" aria-hidden="true" style={{ backgroundColor: color }} />
    {letter && <span className="side-letter">{letter}</span>}
  </>
}

export function SidePicker({ choices, value, onChange }: SidePickerProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [activeSide, setActiveSide] = useState<number>()
  const selected = choices.find(({ side }) => side === value) ?? choices[0]
  const active = choices.find(({ side }) => side === activeSide) ?? selected
  const optionId = (side: number) => `${id}-${side}`

  useEffect(() => {
    if (open && active) document.getElementById(`${id}-${active.side}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, open, active])

  if (!selected || !active) return null
  const count = selected.label.match(/ (?:等|·) [\d,]+ 人$/)?.[0] ?? ''
  const name = count ? selected.label.slice(0, -count.length) : selected.label
  const characters = [...name]
  const shortName = characters.length > 10 ? `${characters.slice(0, 10).join('')}…` : name

  function choose(side: number) {
    setOpen(false)
    onChange(side)
  }

  function start() {
    setActiveSide(selected?.side)
    setOpen(true)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!open) start()
        else {
          const index = choices.findIndex(({ side }) => side === active?.side)
          const delta = event.key === 'ArrowUp' ? -1 : 1
          setActiveSide(choices[Math.max(0, Math.min(choices.length - 1, index + delta))]?.side)
        }
        break
      }
      case 'Home': case 'End':
        setOpen(true)
        setActiveSide((event.key === 'Home' ? choices[0] : choices.at(-1))?.side)
        break
      case 'Enter': case ' ':
        if (open && active) choose(active.side)
        else start()
        break
      case 'Escape':
        if (!open) return
        setOpen(false)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div className="app-topbar-side">
      <span className="app-topbar-label" aria-hidden="true">我方</span>
      <div className="app-side-picker">
        <Button className="app-side-picker-trigger" role="combobox" aria-label="我方" aria-expanded={open}
          aria-controls={id} aria-activedescendant={open ? optionId(active.side) : undefined}
          title={selected.label} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} onClick={() => {
            if (open) setOpen(false)
            else start()
          }}>
          <Swatch {...selected} />
          <span className="app-side-picker-label">{selected.label}</span>
          <span className="app-side-picker-compact-label">
            <span className="app-side-picker-compact-name">{shortName}</span>{count && <span>{count}</span>}
          </span>
          <span aria-hidden="true" className="app-side-picker-chevron" />
        </Button>
        <ul className="app-side-picker-options" role="listbox" aria-label="我方" id={id} hidden={!open}>
          {choices.map((choice) => (
            <li key={choice.side} id={optionId(choice.side)} role="option" aria-selected={choice.side === selected.side}
              data-active={open && choice.side === active.side} title={choice.label}
              onPointerDown={(event) => event.preventDefault()} onClick={() => choose(choice.side)}>
              <Swatch {...choice} />
              <span className="app-side-picker-label">{choice.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
