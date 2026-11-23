import { useCallback, useMemo, useState, type DragEvent } from 'react'
import type { SideSubject } from '@/core/contract'
import { allianceLogoUrl, corpLogoUrl } from '../lib/images'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { sideName } from './roster/model'
import { SideMenu, type SideMenuSection } from './roster/SideMenu'
import { buildSideColumns, manualSubjects, newSideIndex, type SideColumn, type SideGroup } from './roster/sides-model'
import { useSideMove } from './roster/use-side-move'
import './roster/roster.css'

export interface SidesPanelProps {
  onClose?(): void
}

interface Drag { subject: SideSubject; from: number }
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
  const mover = useSideMove(summary?.meta.brId ?? '')
  const data = useMemo(
    () => summary && analysis ? buildSideColumns(summary, analysis, view.oursSide) : null,
    [summary, analysis, view.oursSide],
  )
  if (!summary || !analysis || !data) {
    return <div className="sides"><div className="roster-note" role="status">正在等待分析结果…</div></div>
  }

  const { columns, unassigned, order } = data
  const created = newSideIndex(summary, analysis)
  const manual = manualSubjects(summary)
  const shown: (SideColumn | 'new')[] = [...columns, ...(unassigned ? [unassigned] : []), 'new']

  function drop(event: DragEvent, side: number | 'new') {
    event.preventDefault()
    setDropOn(null)
    const current = drag
    setDrag(null)
    const target = side === 'new' ? created : side
    if (current && current.from !== target) void mover.move(current.subject, target)
  }

  function startDrag(event: DragEvent, subject: SideSubject, from: number) {
    event.stopPropagation()
    event.dataTransfer?.setData('text/plain', subject)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    setDrag({ subject, from })
  }

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openMenu(event: React.MouseEvent, heading: string, subject: SideSubject, current: number) {
    const box = event.currentTarget.getBoundingClientRect()
    setMenu({ sections: [{ heading, subject, current }], x: box.left, y: box.bottom })
  }

  const rowProps = (subject: SideSubject, side: number) => ({
    draggable: true,
    'data-subject': subject,
    'data-dragging': drag?.subject === subject && drag.from === side ? '' : undefined,
    onDragStart: (event: DragEvent) => startDrag(event, subject, side),
    onDragEnd: () => { setDrag(null); setDropOn(null) },
  })

  return (
    <div className="sides" role="dialog" aria-label="排边">
      <div className="sides-head">
        <h2>排边</h2>
        <span className="sides-hint">像 br.evetools 一样拖动联盟或军团；点开一行可以单独移动某个人，也可以用 ⋯ 菜单</span>
        <div className="sides-actions">
          <Button disabled={manual.length === 0 || mover.busy}
            onClick={() => void Promise.all(manual.map((subject) => mover.move(subject, -1)))}>恢复 BR 的划分</Button>
          {onClose && <Button onClick={onClose}>完成</Button>}
        </div>
      </div>
      {unassigned && <div className="sides-notice" role="status">还有 {unassigned.pilotCount} 人未分边</div>}
      {mover.error && <div className="sides-notice" role="alert">{mover.error}</div>}
      <div className="sides-cols" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((column) => {
          const key = column === 'new' ? 'new' : column.side
          const letter = column === 'new' ? null : sideLetter(column.side, order)
          return (
            <section key={key} className="sides-col" data-side={key} data-drop={dropOn === key ? '' : undefined}
              data-hollow={column === 'new' || column.side < 0 ? '' : undefined}
              onDragOver={(event) => { if (drag) { event.preventDefault(); setDropOn(key) } }}
              onDragLeave={() => setDropOn((on) => on === key ? null : on)}
              onDrop={(event) => drop(event, key)}>
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
                  ? <div className="sides-new">放到这里 = 新建一方</div>
                  : column.groups.map((group) => {
                    const id = `${column.side}:${group.subject}`
                    const open = expanded.has(id)
                    return (
                      <div key={group.subject} className="sides-group">
                        <div className="sides-row" {...rowProps(group.subject, column.side)}>
                          <span className="grip" aria-hidden="true">⋮⋮</span>
                          <Logo group={group} />
                          <span className="sides-name">
                            <button type="button" aria-expanded={open} onClick={() => toggle(id)}
                              title={`${group.name}${group.kind === 'corp' ? '（军团）' : ''}`}>
                              {group.name}{group.kind === 'corp' && <span className="side-letter">（军团）</span>}
                            </button>
                          </span>
                          <span className="roster-count">{group.pilots.length} 人</span>
                          <button type="button" className="sides-more" aria-label={`${group.name} 的操作`} aria-haspopup="menu"
                            onClick={(event) => openMenu(event, `移到… · ${group.name}`, group.subject, column.side)}>⋯</button>
                        </div>
                        {open && group.pilots.map((pilot) => (
                          <div key={pilot.key} className="sides-row sides-pilot" {...rowProps(`char:${pilot.charId}`, column.side)}>
                            <Portrait charId={pilot.charId} size={20} />
                            <span className="sides-name">{pilot.name}</span>
                            <span className="roster-count">{pilot.hasLog ? '有日志' : ''}</span>
                            <button type="button" className="sides-more" aria-label={`${pilot.name} 的操作`} aria-haspopup="menu"
                              onClick={(event) => openMenu(event, `移到… · ${pilot.name}`, `char:${pilot.charId}`, column.side)}>⋯</button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
              </div>
            </section>
          )
        })}
      </div>
      <div className="roster-note">改动立刻对所有正在看这场的人生效，分析会重算。人数是这场击毁报告和日志里出现的飞行员。</div>
      {menu && (
        <SideMenu x={menu.x} y={menu.y} sections={menu.sections} order={order}
          newSide={created} onMove={(subject, side) => void mover.move(subject, side)} onClose={closeMenu} />
      )}
    </div>
  )
}
