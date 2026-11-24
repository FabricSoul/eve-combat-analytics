import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { statsForRange } from '@/core/analysis/range'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { observedLabel } from './compare/metrics'
import { observedPilots } from './compare/observations'
import { buildRoster, fullSideOrder, sideName } from './roster/model'
import { hidePartialRosterRow, revealInList } from './roster/reveal'
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
  const observed = useMemo(() => analysis && observedPilots(analysis.interactions, analysis.ewarSpans), [analysis])
  useLayoutEffect(() => {
    if (root.current) return hidePartialRosterRow(root.current)
  }, [groups, needle, alphabetical, search])
  if (!summary || !analysis) return <div className="roster-note" role="status">正在等待分析结果…</div>
  if (groups.length === 0) return <div className="roster-note">上传飞行员的日志，名单会自动更新。</div>
  const order = fullSideOrder(analysis, view.oursSide)

  const unidentified = groups.reduce((n, { rows }) => n + rows.filter((row) => row.charId === null).length, 0)
  const matches = ({ name, ship }: { name: string; ship: string | null }) => !needle || `${name} ${ship ?? ''}`.toLocaleLowerCase().includes(needle)

  function renderRow(row: (typeof groups)[number]['rows'][number]) {
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
              title={row.observed && observed?.has(row.key) ? `没有日志 · 数据${observedLabel}` : undefined} />
            <span>{row.name}</span>
          </span>
          {row.tag ? <Tag title={row.tag.title} data-kind={row.tag.kind}>{tagLabel[row.tag.kind]}</Tag> : <span />}
          <span className="roster-ship"><TypeIcon typeId={row.shipTypeId} size={16} />{row.ship}</span>
        </button>
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
      {groups.map(({ side, rows: allRows }) => {
        const rows = allRows.filter(matches)
        if (!rows.length) return null
        const ordered = alphabetical ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows
        const known = ordered.filter((row) => row.charId !== null)
        const unknown = ordered.filter((row) => row.charId === null)
        const name = sideName(side, order)
        const letter = sideLetter(side, order)
        const renderGroup = (pilots: typeof rows, detail?: '有日志' | '无日志' | '未识别') => {
          if (!pilots.length) return null
          const unidentified = detail === '未识别'
          const title = unidentified ? `未识别 · ${name}` : detail ? `${name} · ${detail}` : name
          return <section key={title} aria-label={title} data-unidentified={unidentified || undefined}>
            <h3 className="roster-head">
              <i className="side-dot" data-hollow={side < 0 || unidentified ? '' : undefined}
                style={side < 0 || unidentified ? undefined : { background: sideColor(side, order) }} aria-hidden="true" />
              <span>{unidentified ? title : <>{name}{letter && <span className="side-letter"> {letter}</span>}
                {detail && ` · ${detail}`}</>}</span>
              <span className="roster-count">{pilots.length}</span>
            </h3>
            {pilots.map(renderRow)}
          </section>
        }
        return (
          <div key={side} className="roster-group">
            {side === view.oursSide ? <>
              {renderGroup(known.filter(({ hasLog }) => hasLog), '有日志')}
              {renderGroup(known.filter(({ hasLog }) => !hasLog), '无日志')}
            </> : renderGroup(known)}
            {renderGroup(unknown, '未识别')}
          </div>
        )
      })}
    </div>
  )
}
