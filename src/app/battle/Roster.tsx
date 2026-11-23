import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { SideSubject } from '@/core/contract'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { affiliationOf } from './roster/affiliation'
import { buildRoster, fullSideOrder, sideName, type RosterRow } from './roster/model'
import { SideMenu, type SideMenuSection } from './roster/SideMenu'
import { useSideMove } from './roster/use-side-move'
import './roster/roster.css'

export interface RosterProps {}

interface OpenMenu { row: RosterRow; x: number; y: number }

export function Roster(_props: RosterProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const mover = useSideMove(summary?.meta.brId ?? '')
  const groups = useMemo(
    () => summary && analysis ? buildRoster(summary, analysis, view.oursSide) : [],
    [summary, analysis, view.oursSide],
  )
  if (!summary || !analysis) return <div className="roster-note" role="status">正在等待分析结果…</div>
  if (groups.length === 0) return <div className="roster-note">这场战斗还没有名单。</div>
  const order = fullSideOrder(analysis, view.oursSide)

  function sectionsFor(row: RosterRow): SideMenuSection[] {
    const affiliation = summary ? affiliationOf(summary, row.charId) : null
    const names = summary?.meta.names ?? {}
    const sections: SideMenuSection[] = [{ heading: `移到… · ${row.name}`, subject: `char:${row.charId}`, current: row.side }]
    if (affiliation) {
      sections.push({ heading: `整个军团一起移 · ${names[affiliation.corpId]?.name ?? affiliation.corpId}`, subject: `corp:${affiliation.corpId}` })
      if (affiliation.allyId !== null) {
        sections.push({ heading: `整个联盟一起移 · ${names[affiliation.allyId]?.name ?? affiliation.allyId}`, subject: `ally:${affiliation.allyId}` })
      }
    }
    return sections
  }

  function open(row: RosterRow, event: MouseEvent, anchor: boolean) {
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    setMenu({ row, x: anchor ? box.left : event.clientX, y: anchor ? box.bottom : event.clientY })
  }

  return (
    <div className="roster">
      {groups.map(({ side, rows, withLog }) => {
        const letter = sideLetter(side, order)
        return (
          <section key={side} aria-label={sideName(side, order)}>
            <h3 className="roster-head">
              <i className="side-dot" data-hollow={side < 0 ? '' : undefined}
                style={side < 0 ? undefined : { background: sideColor(side, order) }} aria-hidden="true" />
              <span>{sideName(side, order)}{letter && <span className="side-letter"> {letter}</span>}{side === view.oursSide ? ` · 有日志 ${withLog}` : ''}</span>
              <span className="roster-count">{rows.length}</span>
            </h3>
            {rows.map((row) => (
              <div key={row.key} className="roster-row" data-selected={view.selected === row.key ? '' : undefined}
                data-nolog={row.hasLog ? undefined : ''} data-dead={row.dead ? '' : undefined}
                onContextMenu={(event) => open(row, event, false)}>
                <button type="button" className="roster-main" aria-pressed={view.selected === row.key}
                  onClick={() => view.select(row.key)}>
                  <Portrait charId={row.charId} size={20} />
                  <span className="roster-name">
                    <i className="roster-dot" role="img" aria-label={row.hasLog ? '有日志' : '没有日志'} />
                    <span>{row.name}</span>
                  </span>
                  {row.tag ? <Tag title={row.tag.title} data-kind={row.tag.kind}>{row.tag.kind === 'log' ? '据日志' : '手动'}</Tag> : <span />}
                  <span className="roster-ship"><TypeIcon typeId={row.shipTypeId} size={16} />{row.ship}</span>
                </button>
                <button type="button" className="roster-more" aria-label={`${row.name} 的操作`} aria-haspopup="menu"
                  aria-expanded={menu?.row.key === row.key} onClick={(event) => open(row, event, true)}>⋯</button>
              </div>
            ))}
          </section>
        )
      })}
      {mover.error && <div className="roster-error" role="alert">{mover.error}</div>}
      {menu && (
        <SideMenu x={menu.x} y={menu.y} sections={sectionsFor(menu.row)} order={order} onClose={closeMenu}
          onMove={(subject: SideSubject, side: number) => void mover.move(subject, side)} />
      )}
    </div>
  )
}
