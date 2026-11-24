import { Fragment, useMemo, useState } from 'react'
import { statsForRange } from '@/core/analysis/range'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { Portrait } from '../ui/Portrait'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { buildRoster, fullSideOrder, sideName } from './roster/model'
import { PilotActions, PilotMore, usePilotMenu } from './roster/PilotActions'
import './roster/roster.css'

export interface RosterProps { search?: boolean; alphabetical?: boolean }

const tagLabel = { log: '据日志', manual: '手动', merge: '合并' } as const

export function Roster(props: RosterProps) {
  const menu = usePilotMenu()
  return menu ? <RosterContent {...props} /> : <PilotActions><RosterContent {...props} /></PilotActions>
}

function RosterContent({ search, alphabetical }: RosterProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const t = useCoarseTime()
  const menu = usePilotMenu()
  const [query, setQuery] = useState('')
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

  return (
    <div className="roster">
      {search && <input autoFocus type="search" className="battle-module-search" aria-label="搜索名单"
        placeholder="飞行员或舰船" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />}
      {needle && !groups.some(({ rows }) => rows.some(({ name, ship }) =>
        `${name} ${ship ?? ''}`.toLocaleLowerCase().includes(needle))) && <p className="module-empty">没有匹配的飞行员 · 试试其他名字或舰船。</p>}
      {groups.map(({ side, rows: allRows, withLog }) => {
        const rows = needle ? allRows.filter(({ name, ship }) => `${name} ${ship ?? ''}`.toLocaleLowerCase().includes(needle)) : allRows
        if (!rows.length) return null
        const ordered = alphabetical ? [...rows].sort((a, b) => Number(a.charId === null) - Number(b.charId === null) || a.name.localeCompare(b.name)) : rows
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
            {ordered.map((row, index) => (
              <Fragment key={row.key}>
              {row.charId === null && ordered[index - 1]?.charId !== null && (
                <h4 className="roster-sub">未识别 {rows.length - identified}</h4>
              )}
              <div className="roster-row" data-pilot-key={row.key} data-selected={view.selected === row.key ? '' : undefined}
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
                  {row.tag ? <Tag title={row.tag.title} data-kind={row.tag.kind}>{tagLabel[row.tag.kind]}</Tag> : <span />}
                  <span className="roster-ship"><TypeIcon typeId={row.shipTypeId} size={16} />{row.ship}</span>
                </button>
                <PilotMore pilot={row.key} name={row.name} className="roster-more" />
              </div>
              </Fragment>
            ))}
          </section>
        )
      })}
    </div>
  )
}
