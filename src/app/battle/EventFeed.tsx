import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtHms, fmtIsk, fmtNum } from '../lib/format'
import { useBattleContext } from '../state/battle-store'
import { useView, type FeedMode } from '../state/view-store'
import { TypeIcon } from '../ui/TypeIcon'
import { buildFeed, defaultFeedKinds, scopeLabel, type FeedKind, type FeedRow } from './feed/model'
import { useModuleTypeId } from './feed/item-icon'
import { Who } from './feed/Who'
import { fullSideOrder } from './roster/model'
import './roster/roster.css'
import './feed/feed.css'

export interface EventFeedProps {
  /** Force the compact variant; otherwise it follows the column width. */
  compact?: boolean
}

const compactBelow = 340
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
    const observer = new ResizeObserver(() => setNarrow(element.clientWidth > 0 && element.clientWidth < compactBelow))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { root, compact: forced ?? narrow }
}

export function EventFeed({ compact: forcedCompact }: EventFeedProps) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const { root, compact } = useNarrow(forcedCompact)
  const moduleTypeId = useModuleTypeId()
  const [active, setActive] = useState<readonly FeedKind[]>(defaultFeedKinds)
  const mode = view.feedMode
  const focus = view.focusOnly ? view.selected : null
  const rows = useMemo(
    () => summary && analysis ? buildFeed({ analysis, summary, mode, t: view.t, oursSide: view.oursSide, kinds: active, focus, range: view.range }) : [],
    [summary, analysis, mode, view.t, view.oursSide, active, focus, view.range],
  )
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
      const separator = compact && mode === 'merged' && row.lastT !== lastSeparator
        ? [<div key={`sep-${row.id}`} className="feed-sep">{fmtHms(row.lastT)}</div>] : []
      lastSeparator = row.lastT
      const time = compact && mode === 'merged' ? null : <span className="feed-time">{fmtHms(row.lastT)}</span>
      const current = row.current ? { 'aria-current': 'true' as const } : {}
      if (mode === 'key') {
        const [glyph, label] = keyBadge[row.type === 'event' ? 'big' : row.type]
        return [<div key={row.id} className="feed-row" data-type={row.type} {...current}>
          {time}<span className="feed-kev" title={label}>{glyph}</span>{keyContent(row)}
        </div>]
      }
      return [...separator, <div key={row.id} className="feed-row" data-kind={row.kind} {...current}>
        {time}{who(row.from)}{weapon(row)}{who(row.to)}{amount(row)}
      </div>]
    })
  }

  const compactHead = compact && mode === 'merged'
  const heads = mode === 'key' ? ['时间', '', '事件']
    : compactHead ? ['出手', '用', '对象', '总量 ×次数']
      : [mode === 'merged' ? '最后时间' : '时间', '出手', '用', '对象', mode === 'merged' ? '总量 ×次数' : '数值']

  return (
    <div ref={root} className="feed" data-mode={mode} data-compact={compactHead ? '' : undefined}>
      <div className="feed-bar">
        <div className="feed-title"><span>事件</span><span className="feed-at">{scopeLabel(mode, view.t, view.range)}</span></div>
        <div className="feed-modes" role="group" aria-label="事件流模式">
          {modes.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => view.setFeedMode(value)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="feed-chips">
        {mode === 'key' ? <span>击毁 · 主目标切换 · 前 1% 的大额伤害</span> : kinds.map(({ value, label }) => (
          <button key={value} type="button" aria-pressed={active.includes(value)} onClick={() => toggleKind(value)}>{label}</button>
        ))}
      </div>
      <div className="feed-head" role="presentation">
        {heads.map((head, index) => <span key={index} className={index === heads.length - 1 && mode !== 'key' ? 'feed-r' : undefined}>{head}</span>)}
      </div>
      {rows.length === 0 ? <div className="feed-empty" role="status">这一刻前后没有事件</div> : renderRows()}
    </div>
  )
}
