import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { SideSubject } from '@/core/contract'
import { allianceLogoUrl, corpLogoUrl } from '../lib/images'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { sideName } from './roster/model'
import { SideMenu, type SideMenuSection } from './roster/SideMenu'
import { buildSideColumns, manualSubjects, newSideIndex, type CharRow, type SideColumn, type SideGroup } from './roster/sides-model'
import { useSideMove } from './roster/use-side-move'
import './roster/roster.css'

export interface SidesPanelProps {
  onClose?(): void
}

interface Drag { subject: SideSubject; from: number; spansSides: boolean }
interface OpenMenu { sections: SideMenuSection[]; x: number; y: number }

function Logo({ group }: { group: SideGroup }) {
  if (group.kind === 'char') return <Portrait charId={group.id} size={20} />
  const src = group.kind === 'ally' ? allianceLogoUrl(group.id, 20) : corpLogoUrl(group.id, 20)
  return <img className="app-image app-portrait" src={src} width={20} height={20} alt="" loading="lazy" />
}

export function SidesPanel({ onClose }: SidesPanelProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropOn, setDropOn] = useState<number | 'new' | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const dialog = useRef<HTMLDivElement>(null)
  const canClose = onClose !== undefined
  useLayoutEffect(() => {
    if (!canClose) return
    const opener = document.activeElement
    dialog.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [canClose])

  const mover = useSideMove(summary?.meta.brId ?? '')
  const data = useMemo(
    () => summary && analysis ? buildSideColumns(summary, analysis, view.oursSide) : null,
    [summary, analysis, view.oursSide],
  )
  const dialogProps = {
    ref: dialog, className: 'sides', role: 'dialog', 'aria-label': '排边', tabIndex: -1,
  }
  if (!summary || !data) {
    return <div {...dialogProps}>
      <div className="sides-head"><h2>排边</h2>{onClose && <Button onClick={onClose}>完成</Button>}</div>
      <div className="roster-note" role="status">正在等待分析结果…</div>
    </div>
  }

  const { columns, unassigned, order } = data
  const created = newSideIndex(summary)
  const manual = new Set(manualSubjects(summary))
  const shown: (SideColumn | 'new')[] = [...columns, ...(unassigned ? [unassigned] : []), 'new']

  function acceptsDrop(side: number | 'new') {
    return side === 'new' ? created !== undefined : order.includes(side)
  }

  function drop(event: DragEvent, side: number | 'new') {
    event.preventDefault()
    setDropOn(null)
    setDrag(null)
    if (drag && acceptsDrop(side) && (drag.from !== side || drag.spansSides)) void mover.move(drag.subject, side)
  }

  function startDrag(event: DragEvent, subject: SideSubject, from: number, spansSides: boolean) {
    event.stopPropagation()
    event.dataTransfer?.setData('text/plain', subject)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    setDrag({ subject, from, spansSides })
  }

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openMenu(event: MouseEvent, heading: string, subject: SideSubject, current?: number) {
    const box = event.currentTarget.getBoundingClientRect()
    setMenu({ sections: [{ heading, subject, current }], x: box.left, y: box.bottom })
  }

  const rowProps = (subject: SideSubject, side: number, spansSides = false) => ({
    draggable: true,
    'data-subject': subject,
    'data-dragging': drag?.subject === subject && drag.from === side ? '' : undefined,
    onDragStart: (event: DragEvent) => startDrag(event, subject, side, spansSides),
    onDragEnd: () => { setDrag(null); setDropOn(null) },
  })

  function actions(subject: SideSubject, name: string, current?: number, scope?: string) {
    return <span style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
      {manual.has(subject) && <button type="button" className="sides-more" disabled={mover.busy}
        aria-label={`${name}：移除手动排边`} title="移除手动排边"
        onClick={() => void mover.move(subject, -1)}>移除</button>}
      <button type="button" className="sides-more" aria-label={`${name} 的操作`} aria-haspopup="menu"
        onClick={(event) => openMenu(event, `移到… · ${name}${scope ? `（${scope}）` : ''}`, subject, current)}>⋯</button>
    </span>
  }

  function renderPilot(pilot: CharRow, side: number) {
    const subject = `char:${pilot.charId}` as const
    return <div key={pilot.key} className="sides-row sides-pilot" {...rowProps(subject, side)}
      style={manual.has(subject) ? { gridTemplateColumns: '20px minmax(0, 1fr) auto auto' } : undefined}>
      <Portrait charId={pilot.charId} size={20} />
      <span className="sides-name">{pilot.name}</span>
      <span className="roster-count">{pilot.hasLog ? '有日志' : ''}</span>
      {actions(subject, pilot.name, side)}
    </div>
  }

  function renderGroup(group: SideGroup, side: number, parent?: SideSubject) {
    const id = `${side}:${parent ?? ''}:${group.subject}`
    const open = expanded.has(id)
    const scope = group.spansSides ? `${group.kind === 'ally' ? '全联盟' : '全军团'} · ${group.scopeCount} 人` : undefined
    return <div key={group.subject} className={parent ? undefined : 'sides-group'}>
      <div className="sides-row" {...rowProps(group.subject, side, group.spansSides)}
        style={{
          paddingInlineStart: parent ? 'calc(var(--space-3) + 16px)' : undefined,
          gridTemplateColumns: manual.has(group.subject) ? '16px 20px minmax(0, 1fr) auto auto' : undefined,
        }}>
        <span className="grip" aria-hidden="true">⋮⋮</span>
        <Logo group={group} />
        <span className="sides-name">
          <button type="button" aria-expanded={open} onClick={() => toggle(id)}
            title={`${group.name}${group.kind === 'corp' ? '（军团）' : ''}`}>
            {group.name}{group.kind === 'corp' && <span className="side-letter">（军团）</span>}
          </button>
          {scope && <span className="roster-count" style={{ display: 'block' }} title={scope}>{scope}</span>}
        </span>
        <span className="roster-count">{group.pilots.length} 人</span>
        {actions(group.subject, group.name, group.spansSides ? undefined : side, scope)}
      </div>
      {open && (group.corporations
        ? group.corporations.map((corp) => renderGroup(corp, side, group.subject))
        : group.pilots.map((pilot) => renderPilot(pilot, side)))}
    </div>
  }

  return (
    <div {...dialogProps}>
      <div className="sides-head">
        <h2>排边</h2>
        <span className="sides-hint">像 br.evetools 一样拖动联盟或军团；点开一行可以单独移动某个人，也可以用 ⋯ 菜单</span>
        <div className="sides-actions">
          <Button disabled={manual.size === 0 || mover.busy}
            onClick={() => void Promise.all([...manual].map((subject) => mover.move(subject, -1)))}>恢复 BR 的划分</Button>
          {onClose && <Button onClick={onClose}>完成</Button>}
        </div>
      </div>
      {unassigned && <div className="sides-notice" role="status">还有 {unassigned.pilotCount} 人未分边</div>}
      {mover.error && <div className="sides-notice" role="alert">{mover.error}</div>}
      <div className="sides-cols" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(220px, 1fr))` }}>
        {shown.map((column) => {
          const key = column === 'new' ? 'new' : column.side
          const letter = column === 'new' ? null : sideLetter(column.side, order)
          const enabled = acceptsDrop(key)
          const handlers = enabled ? {
            onDragOver: (event: DragEvent) => { if (drag) { event.preventDefault(); setDropOn(key) } },
            onDragLeave: () => setDropOn((on) => on === key ? null : on),
            onDrop: (event: DragEvent) => drop(event, key),
          } : {}
          return (
            <section key={key} className="sides-col" data-side={key} data-drop={enabled && dropOn === key ? '' : undefined}
              data-hollow={column === 'new' || column.side < 0 ? '' : undefined}
              aria-disabled={column === 'new' && !enabled ? true : undefined} {...handlers}>
              <div className="sides-col-head">
                <i className="side-dot" aria-hidden="true"
                  style={column !== 'new' && column.side >= 0 ? { background: sideColor(column.side, order) } : undefined} />
                <span>{column === 'new' ? '新建一方' : sideName(column.side, order)}</span>
                {letter && <span className="side-letter">{letter}</span>}
                {column !== 'new' && (
                  <span className="roster-count">{column.side >= 0 ? `有日志 ${column.withLog} · ` : ''}{column.pilotCount} 人</span>
                )}
              </div>
              <div className="sides-col-body">
                {column === 'new'
                  ? <div className="sides-new">{enabled ? '放到这里 = 新建一方' : '已达到八方上限'}</div>
                  : column.groups.map((group) => renderGroup(group, column.side))}
              </div>
            </section>
          )
        })}
      </div>
      <div className="roster-note">改动立刻对所有正在看这场的人生效，分析会重算。人数是这场击毁报告和日志里出现的飞行员。</div>
      {menu && (
        <SideMenu x={menu.x} y={menu.y} sections={menu.sections} order={order}
          newSide={created} onMove={(subject, side) => void mover.move(subject, side === created ? 'new' : side)} onClose={closeMenu} />
      )}
    </div>
  )
}
