import { Fragment, useCallback, useMemo, useState, type MouseEvent } from 'react'
import { statsForRange } from '@/core/analysis/range'
import type { EntityKey, SideSubject } from '@/core/contract'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { affiliationOf } from './roster/affiliation'
import { buildRoster, fullSideOrder, sideName, type RosterRow } from './roster/model'
import { IdentityPicker } from './roster/IdentityPicker'
import { useIdentity } from './roster/use-identity'
import { shipNameById } from './roster/ships'
import { SideMenu, type SideMenuSection } from './roster/SideMenu'
import { useSideMove } from './roster/use-side-move'
import './roster/roster.css'

export interface RosterProps {}

const tagLabel = { log: '据日志', manual: '手动', merge: '合并' } as const

interface OpenMenu { row: RosterRow; x: number; y: number; anchorTop: number; invoker: HTMLElement | null }

export function Roster(_props: RosterProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const t = useCoarseTime()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const mover = useSideMove(summary?.meta.brId ?? '')
  const identity = useIdentity(summary?.meta.brId ?? '')
  const [picking, setPicking] = useState<{ row: RosterRow; invoker: HTMLElement | null } | null>(null)
  const at = view.range ? view.range[1] : t
  const { range } = view
  const rangeStats = useMemo(
    () => summary && analysis && range ? statsForRange(analysis, summary.meta.killmails, range[0], range[1]) : undefined,
    [summary, analysis, range],
  )
  const groups = useMemo(
    () => summary && analysis ? buildRoster(summary, analysis, view.oursSide, at, rangeStats) : [],
    [summary, analysis, view.oursSide, at, rangeStats],
  )
  if (!summary || !analysis) return <div className="roster-note" role="status">正在等待分析结果…</div>
  if (groups.length === 0) return <div className="roster-note">这场战斗还没有名单。</div>
  const order = fullSideOrder(analysis, view.oursSide)

  function sectionsFor(row: RosterRow): SideMenuSection[] {
    if (row.charId === null) return []
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
    const invoker = anchor ? event.currentTarget as HTMLElement : event.currentTarget.querySelector<HTMLElement>('.roster-main')
    setMenu({
      row, x: anchor ? box.left : event.clientX, y: anchor ? box.bottom : event.clientY,
      anchorTop: anchor ? box.top : event.clientY, invoker,
    })
  }

  const mergeLabel = (key: EntityKey) => {
    const ship = /^ship:(\d+):/.exec(key)?.[1]
    return ship ? shipNameById(Number(ship)) ?? key : key.replace(/^name:/, '')
  }
  function actionsFor(row: RosterRow, invoker: HTMLElement | null) {
    if (row.charId === null) return [{ label: '这是谁…', run: () => setPicking({ row, invoker }) }]
    return (summary?.identityMerges ?? []).filter(({ to }) => to === `char:${row.charId}`)
      .map(({ from }) => ({ label: `取消合并 · ${mergeLabel(from)}`, run: () => void identity.put(from, null) }))
  }

  return (
    <div className="roster">
      {groups.map(({ side, rows, withLog }) => {
        const identified = rows.filter((row) => row.charId !== null).length
        const letter = sideLetter(side, order)
        return (
          <section key={side} aria-label={sideName(side, order)}>
            <h3 className="roster-head">
              <i className="side-dot" data-hollow={side < 0 ? '' : undefined}
                style={side < 0 ? undefined : { background: sideColor(side, order) }} aria-hidden="true" />
              <span>{sideName(side, order)}{letter && <span className="side-letter"> {letter}</span>}{side === view.oursSide ? ` · 有日志 ${withLog}` : ''}</span>
              <span className="roster-count">{identified}</span>
            </h3>
            {rows.map((row, index) => (
              <Fragment key={row.key}>
              {row.charId === null && rows[index - 1]?.charId !== null && (
                <h4 className="roster-sub">未识别 {rows.length - identified}</h4>
              )}
              <div className="roster-row" data-selected={view.selected === row.key ? '' : undefined}
                data-nolog={row.hasLog ? undefined : ''} data-dead={row.dead ? '' : undefined}
                onContextMenu={(event) => open(row, event, false)}>
                <button type="button" className="roster-main" aria-pressed={view.selected === row.key}
                  onClick={() => view.select(row.key)}>
                  <Portrait charId={row.charId} size={20} />
                  <span className="roster-name">
                    <i className="roster-dot" role="img" aria-label={row.hasLog ? '有日志' : '没有日志'}
                      title={row.observed ? '没有日志 · 数据据我方日志' : undefined} />
                    <span>{row.name}</span>
                  </span>
                  {row.tag ? <Tag title={row.tag.title} data-kind={row.tag.kind}>{tagLabel[row.tag.kind]}</Tag> : <span />}
                  <span className="roster-ship"><TypeIcon typeId={row.shipTypeId} size={16} />{row.ship}</span>
                </button>
                {(
                  <button type="button" className="roster-more" aria-label={`${row.name} 的操作`} aria-haspopup="menu"
                    aria-expanded={menu?.row.key === row.key} onClick={(event) => open(row, event, true)}>⋯</button>
                )}
              </div>
              </Fragment>
            ))}
          </section>
        )
      })}
      {(mover.error ?? identity.error) && <div className="roster-error" role="alert">{mover.error ?? identity.error}</div>}
      {menu && (
        <SideMenu x={menu.x} y={menu.y} anchorTop={menu.anchorTop} returnFocus={menu.invoker} sections={sectionsFor(menu.row)} order={order} onClose={closeMenu}
          actions={actionsFor(menu.row, menu.invoker)}
          pinAction={menu.row.charId === null ? undefined : { label: view.pinned.has(menu.row.key) ? '移出时间轴对比' : '加入时间轴对比', run: () => view.togglePin(menu.row.key) }}
          onMove={(subject: SideSubject, side: number) => void mover.move(subject, side)} />
      )}
      {picking && analysis && summary && (
        <IdentityPicker from={picking.row.key} label={picking.row.name} summary={summary} analysis={analysis}
          returnFocus={picking.invoker} onClose={() => setPicking(null)} />
      )}
    </div>
  )
}
