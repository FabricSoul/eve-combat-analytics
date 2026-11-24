import { useEffect, useMemo, useRef, useState } from 'react'
import { statsForRange } from '@/core/analysis/range'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { buildRoster, fullSideOrder, sideName } from './roster/model'
import { revealInList } from './roster/reveal'
import { PilotActions, PilotMore, usePilotMenu } from './roster/PilotActions'
import './roster/roster.css'

export interface RosterProps { search?: boolean; alphabetical?: boolean; onSearchClose?: () => void }

const tagLabel = { log: '据日志', manual: '手动', merge: '合并' } as const

export function Roster(props: RosterProps) {
  const menu = usePilotMenu()
  return menu ? <RosterContent {...props} /> : <PilotActions><RosterContent {...props} /></PilotActions>
}

function RosterContent({ search, alphabetical, onSearchClose }: RosterProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const t = useCoarseTime()
  const menu = usePilotMenu()
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const flashed = menu?.flashed ?? null
  // A pilot the user just merged into: bring the row into view inside 名单, once.
  useEffect(() => {
    if (!flashed) return
    const row = [...root.current?.querySelectorAll<HTMLElement>('[data-pilot-key]') ?? []].find((el) => el.dataset.pilotKey === flashed)
    if (row) revealInList(row, 40)
  }, [flashed])
  const needle = search ? query.trim().toLocaleLowerCase() : ''
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
  if (groups.length === 0) return <div className="roster-note">上传飞行员的日志，名单会自动更新。</div>
  const order = fullSideOrder(analysis, view.oursSide)

  const unidentified = groups.reduce((n, { rows }) => n + rows.filter((row) => row.charId === null).length, 0)
  const matches = ({ name, ship }: { name: string; ship: string | null }) => !needle || `${name} ${ship ?? ''}`.toLocaleLowerCase().includes(needle)

  function renderRow(row: (typeof groups)[number]['rows'][number]) {
    const mergeTag = row.tag?.kind === 'merge'
    return (
      <div key={row.key} className="roster-row" data-pilot-key={row.key} data-selected={view.selected === row.key ? '' : undefined}
        data-flash={flashed === row.key ? '' : undefined}
        data-nolog={row.hasLog ? undefined : ''} data-dead={row.dead ? '' : undefined}
        onContextMenu={(event) => menu?.open(row.key, event)}>
        <button type="button" className="roster-main" aria-pressed={view.selected === row.key}
          onClick={() => view.select(row.key)}>
          <Portrait charId={row.charId} size={20} />
          <span className="roster-name">
            <i className="roster-dot" role="img" aria-label={row.hasLog ? '有日志' : '没有日志'}
              title={row.observed ? '没有日志 · 数据据我方日志' : undefined} />
            <span>{row.name}</span>
          </span>
          {row.tag && !mergeTag ? <Tag title={row.tag.title} data-kind={row.tag.kind}>{tagLabel[row.tag.kind]}</Tag> : <span />}
          <span className="roster-ship"><TypeIcon typeId={row.shipTypeId} size={16} />{row.ship}</span>
        </button>
        {row.tag && mergeTag && (
          <button type="button" className="app-tag roster-tag-button" data-kind="merge" title={`${row.tag.title} · 点击取消合并`}
            aria-label={`${row.name} 的合并 · 取消合并…`} aria-haspopup="menu"
            onClick={(event) => { event.stopPropagation(); menu?.open(row.key, event, true) }}>{tagLabel.merge}</button>
        )}
        <PilotMore pilot={row.key} name={row.name} className="roster-more" />
      </div>
    )
  }

  return (
    <div className="roster" ref={root}>
      {search && <input autoFocus type="search" className="battle-module-search" aria-label="搜索名单"
        placeholder="飞行员或舰船" value={query} onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (query) setQuery('')
          else { event.currentTarget.blur(); onSearchClose?.() }
        }} />}
      {unidentified > 0 && !needle && (
        <button type="button" className="roster-jump" onClick={() => {
          const first = root.current?.querySelector<HTMLElement>('[data-unidentified]')
          if (first) revealInList(first, 0)
          first?.querySelector<HTMLElement>('.roster-main')?.focus({ preventScroll: true })
        }}>{unidentified} 未识别</button>
      )}
      {needle && !groups.some(({ rows }) => rows.some(matches)) && <p className="module-empty">没有匹配的飞行员 · 试试其他名字或舰船。</p>}
      {groups.map(({ side, rows: allRows, withLog }) => {
        const rows = allRows.filter(matches)
        if (!rows.length) return null
        const ordered = alphabetical ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows
        const known = ordered.filter((row) => row.charId !== null)
        const unknown = ordered.filter((row) => row.charId === null)
        const letter = sideLetter(side, order)
        return (
          <div key={side} className="roster-group">
            {known.length > 0 && (
              <section aria-label={sideName(side, order)}>
                <h3 className="roster-head">
                  <i className="side-dot" data-hollow={side < 0 ? '' : undefined}
                    style={side < 0 ? undefined : { background: sideColor(side, order) }} aria-hidden="true" />
                  <span>{sideName(side, order)}{letter && <span className="side-letter"> {letter}</span>}{side === view.oursSide ? ` · 有日志 ${withLog}` : ''}</span>
                  <span className="roster-count">{known.length}</span>
                </h3>
                {known.map(renderRow)}
              </section>
            )}
            {unknown.length > 0 && (
              <section aria-label={`未识别 · ${sideName(side, order)}`} data-unidentified="">
                <h3 className="roster-head roster-head-unidentified">
                  <i className="side-dot" data-hollow="" aria-hidden="true" />
                  <span>未识别 · {sideName(side, order)}</span>
                  <span className="roster-count">{unknown.length}</span>
                </h3>
                {unknown.map(renderRow)}
              </section>
            )}
          </div>
        )
      })}
    </div>
  )
}
