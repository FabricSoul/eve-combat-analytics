import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { suggestMerges } from '@/core/analysis/merges'
import type { Analysis, Entity, EntityKey } from '@/core/contract'
import { Portrait } from '../../ui/Portrait'

const suggestionLimit = 5
const resultLimit = 30
const why = '同阵营 · 同船型 · 同时在场'

export interface IdentityPickerProps {
  from: EntityKey
  /** Name of the unidentified row, for the title. */
  label: string
  analysis: Analysis
  returnFocus?: HTMLElement | null
  /** The character chosen. The dialog closes at once; the caller saves and reports. */
  onPick(entity: Entity): void
  onClose(): void
}

function Candidate({ entity, reason, attr, active, onPick }: {
  entity: Entity; reason?: string; attr: 'data-suggestion' | 'data-result'; active: boolean; onPick(): void
}) {
  return (
    <button type="button" className="identity-item" id={`identity-option-${entity.key}`} {...{ [attr]: '' }}
      data-active={active ? '' : undefined} onClick={onPick}
      ref={(node) => { if (active) node?.scrollIntoView?.({ block: 'nearest' }) }}>
      <Portrait charId={entity.charId} size={24} />
      <span className="identity-text">
        <span className="identity-name">{entity.name}</span>
        <span className="identity-sub">{entity.shipTypes[0] ?? '未知舰船'}{reason ? ` · ${reason}` : ''}</span>
      </span>
    </button>
  )
}

/** "这是谁…": pick the known character an unidentified ship or label really is. */
export function IdentityPicker({ from, label, analysis, returnFocus, onPick, onClose }: IdentityPickerProps) {
  const root = useRef<HTMLDivElement>(null)
  const [invoker] = useState(() => returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(-1)

  const suggestions = useMemo(() => suggestMerges(analysis, from).slice(0, suggestionLimit)
    .flatMap(({ to }) => analysis.entities[to] ?? []), [analysis, from])
  const characters = useMemo(() => Object.values(analysis.entities).filter(({ charId }) => charId !== null)
    .sort((a, b) => a.name.localeCompare(b.name)), [analysis])
  const needle = query.trim().toLowerCase()
  const results = needle ? characters.filter(({ name }) => name.toLowerCase().includes(needle)).slice(0, resultLimit) : []

  const items = needle ? results : suggestions
  useEffect(() => { root.current?.querySelector('input')?.focus() }, [])
  useEffect(() => () => { if (invoker?.isConnected) invoker.focus() }, [invoker])

  function pick(entity: Entity) {
    onPick(entity)
    onClose()
  }

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (items.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((highlight + step + items.length) % items.length)
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && items[highlight]) {
      event.preventDefault()
      pick(items[highlight]!)
    }
  }

  return (
    <div className="identity-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={root} className="identity-picker" role="dialog" aria-modal="true" aria-label={`这是谁 · ${label}`} onKeyDown={keys}>
        <h3 className="identity-title">这是谁 · {label}</h3>
        <input type="search" className="identity-search" placeholder="搜索已知飞行员" aria-label="搜索已知飞行员"
          value={query} aria-activedescendant={items[highlight] ? `identity-option-${items[highlight]!.key}` : undefined}
          onChange={(event) => { setQuery(event.target.value); setHighlight(event.target.value.trim() ? 0 : -1) }} />
        <div className="identity-list">
          {!needle && (suggestions.length > 0
            ? <>
              <div className="identity-head">可能是</div>
              {suggestions.map((entity, index) => <Candidate key={entity.key} entity={entity} reason={why} attr="data-suggestion"
                active={index === highlight} onPick={() => pick(entity)} />)}
            </>
            : <div className="identity-empty">没有自动建议，可以搜索。</div>)}
          {needle && (results.length > 0
            ? results.map((entity, index) => <Candidate key={entity.key} entity={entity} attr="data-result"
              active={index === highlight} onPick={() => pick(entity)} />)
            : <div className="identity-empty">没有匹配的飞行员。</div>)}
        </div>
        <button type="button" className="identity-close" onClick={onClose}>取消</button>
      </div>
    </div>
  )
}

