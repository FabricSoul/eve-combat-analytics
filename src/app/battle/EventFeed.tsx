import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtHms, fmtIsk, fmtNum } from '../lib/format'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView, type FeedMode } from '../state/view-store'
import { TypeIcon } from '../ui/TypeIcon'
import { buildFeed, defaultFeedKinds, rangeLimit, scopeLabel, type FeedKind, type FeedRow } from './feed/model'
import { useModuleTypeId } from './feed/item-icon'
import { Who } from './feed/Who'
import { useNoiseFilteredAnalysis } from './replay/noise'
import { fullSideOrder } from './roster/model'
import { RangeChip } from './RangeChip'
import './roster/roster.css'
import './feed/feed.css'

export interface EventFeedProps {
  /** Force the compact variant; otherwise it follows the column width. */
  compact?: boolean
  search?: boolean
  onSearchClose?: () => void
  showFilters?: boolean
}

const compactUpTo = 400
const modes: readonly { value: FeedMode; label: string }[] = [
  { value: 'merged', label: '合并同类' }, { value: 'raw', label: '逐条' }, { value: 'key', label: '只看关键' },
]
const kinds: readonly { value: FeedKind; label: string }[] = [
  { value: 'damage', label: '伤害' }, { value: 'repair', label: '维修' }, { value: 'ewar', label: '点' }, { value: 'neut', label: '中和' },
]
const kindLabel = { damage: '打', miss: '打', repair: '修', ewar: '点', neut: '中和', nos: '吸电' } as const
const keyBadge = { kill: ['击', '被击毁'], primary: ['主', '主目标切换'], big: ['大', '大额伤害'] } as const

function useNarrow(forced: boolean | undefined) {
  const root = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setNarrow(element.clientWidth > 0 && element.clientWidth <= compactUpTo))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { root, compact: forced ?? narrow }
}

export function EventFeed({ compact: forcedCompact, search, onSearchClose, showFilters = true }: EventFeedProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const visibleAnalysis = useNoiseFilteredAnalysis(analysis)
  const t = useCoarseTime()
  const { root, compact } = useNarrow(forcedCompact)
  const moduleTypeId = useModuleTypeId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<readonly FeedKind[]>(defaultFeedKinds)
  const mode = view.feedMode
  const focus = view.focusOnly ? view.selected : null
  const allRows = useMemo(
    () => summary && visibleAnalysis ? buildFeed({ analysis: visibleAnalysis, summary, mode, t, oursSide: view.oursSide, kinds: active, focus, range: view.range }) : [],
    [summary, visibleAnalysis, mode, t, view.oursSide, active, focus, view.range],
  )
  const needle = search ? query.trim().toLocaleLowerCase() : ''
  const rows = needle ? allRows.filter(({ from, to, victim, weapon }) =>
    [from && analysis?.entities[from]?.name, to && analysis?.entities[to]?.name, victim && analysis?.entities[victim]?.name, weapon]
      .some((value) => value && value.toLocaleLowerCase().includes(needle))) : allRows
  const order = useMemo(() => analysis ? fullSideOrder(analysis, view.oursSide) : [], [analysis, view.oursSide])

  const toggleKind = (kind: FeedKind) =>
    setActive((previous) => previous.includes(kind) ? previous.filter((k) => k !== kind) : [...previous, kind])

  const who = (key: FeedRow['from'], fallback?: string | null) =>
    summary && analysis ? <Who entityKey={key} analysis={analysis} summary={summary} order={order} fallback={fallback} /> : null

  function weapon(row: FeedRow) {
    const typeId = moduleTypeId(row.weapon)
    return (
      <span className="feed-weapon" title={row.weapon ?? undefined}>
        {typeId === null ? kindLabel[row.kind] : <TypeIcon typeId={typeId} size={16} />}
      </span>
    )
  }

  function amount(row: FeedRow) {
    return (
      <span className="feed-amount">
        {row.kind === 'ewar' || row.kind === 'miss' ? '—' : fmtNum(Math.round(row.total))}
        {row.count > 1 && <span className="feed-count"> ×{row.count}</span>}
      </span>
    )
  }

  function keyContent(row: FeedRow) {
    if (row.type === 'kill') {
      return (
        <span className="feed-text">
          {who(row.victim, row.victimName ?? row.shipName)}
          <span className="feed-muted">的</span>
          <TypeIcon typeId={row.shipTypeId} size={16} />
          {row.shipName && <span>{row.shipName}</span>}
          <span className="feed-muted">被击毁</span>
          <span className="feed-amount">{fmtIsk(row.total)}</span>
        </span>
      )
    }
    if (row.type === 'primary') {
      return <span className="feed-text"><span className="feed-muted">主目标换成</span>{who(row.to)}<span className="feed-muted">{row.count} 人在打</span></span>
    }
    return <span className="feed-text">{who(row.from)}{weapon(row)}{who(row.to)}<span className="feed-amount">{fmtNum(Math.round(row.total))}</span></span>
  }

  function renderRows() {
    let lastSeparator: number | null = null
    return rows.flatMap((row) => {
      const separator = compact && mode !== 'key' && row.lastT !== lastSeparator
        ? [<div key={`sep-${row.id}`} className="feed-sep">{fmtHms(row.lastT)}</div>] : []
      lastSeparator = row.lastT
      const time = compact && mode !== 'key' ? null : <span className="feed-time">{fmtHms(row.lastT)}</span>
      const current = row.current ? { 'aria-current': 'true' as const } : {}
      const selected = view.selected !== null && (view.selected === row.from || view.selected === row.to || view.selected === row.victim)
      if (mode === 'key') {
        const [glyph, label] = keyBadge[row.type === 'event' ? 'big' : row.type]
        return [<div key={row.id} className="feed-row" data-selected={selected || undefined} data-type={row.type} {...current}>
          {time}<span className="feed-kev" title={label}>{glyph}</span>{keyContent(row)}
        </div>]
      }
      return [...separator, <div key={row.id} className="feed-row" data-selected={selected || undefined} data-kind={row.kind} {...current}>
        {time}{who(row.from)}{weapon(row)}{who(row.to)}{amount(row)}
      </div>]
    })
  }

  const compactHead = compact && mode !== 'key'
  const heads = mode === 'key' ? ['时间', '', '事件']
    : compactHead ? ['出手', '用', '对象', mode === 'merged' ? '总量 ×次数' : '数值']
      : [mode === 'merged' ? '最后时间' : '时间', '出手', '用', '对象', mode === 'merged' ? '总量 ×次数' : '数值']

  return (
    <div ref={root} className="feed" data-mode={mode} data-compact={compactHead ? '' : undefined}>
      <div className="feed-bar">
        <div className="feed-title"><span>事件</span>{view.range
          ? <RangeChip range={view.range} clearRange={view.clearRange} label={`选段 ${scopeLabel(mode, t, view.range)} · ${rows.length >= rangeLimit ? "最新 " : ""}${rows.length} 条`} />
          : <span className="feed-at">{scopeLabel(mode, t, null)}</span>}</div>
        <div className="feed-modes" role="group" aria-label="事件流模式">
          {modes.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => view.setFeedMode(value)}>{label}</button>
          ))}
        </div>
      </div>
      {search && <input autoFocus type="search" className="battle-module-search" aria-label="搜索事件"
        placeholder="飞行员或武器" value={query} onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (query) setQuery('')
          else { event.currentTarget.blur(); onSearchClose?.() }
        }} />}
      {showFilters && <div className="feed-chips">
        {mode === 'key' ? <span>击毁 · 主目标切换 · 前 1% 的大额伤害</span> : kinds.map(({ value, label }) => (
          <button key={value} type="button" aria-pressed={active.includes(value)} onClick={() => toggleKind(value)}>{label}</button>
        ))}
      </div>}
      <div className="feed-head" role="presentation">
        {heads.map((head, index) => <span key={index} className={index === heads.length - 1 && mode !== 'key' ? 'feed-r' : undefined}>{head}</span>)}
      </div>
      {rows.length === 0 ? <div className="feed-empty" role="status">{needle ? '没有匹配的事件 · 试试其他飞行员或武器。' : (view.range ? '选段内没有事件 · 调整筛选条件' : '这一刻前后没有事件 · 移动时间轴或调整筛选条件')}</div> : renderRows()}
    </div>
  )
}
