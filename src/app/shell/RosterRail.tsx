import { useMemo, useState, type MouseEvent, type FocusEvent } from 'react'
import { buildRoster, fullSideOrder } from '../battle/roster/model'
import { sideColor, sideLetter, sideName } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, useView } from '../state/view-store'
import { TypeIcon } from '../ui/TypeIcon'

export function RosterRail() {
  const { analysis, summary } = useBattleContext()
  const { oursSide, selected, select, range } = useView()
  const t = useCoarseTime()
  const [tooltip, setTooltip] = useState<{ name: string; top: number } | null>(null)
  // Rebuild the roster only when playback crosses a kill, not on each replay frame.
  const at = range?.[1] ?? t
  const lastKill = summary?.meta.killmails.reduce((last, { t: killedAt }) => killedAt <= at ? Math.max(last, killedAt) : last, -Infinity) ?? -Infinity
  const groups = useMemo(
    () => summary && analysis ? buildRoster(summary, analysis, oursSide, lastKill) : [],
    [summary, analysis, oursSide, lastKill],
  )
  const order = useMemo(() => analysis ? fullSideOrder(analysis, oursSide) : [], [analysis, oursSide])
  const sideLabels = useMemo(() => summary && analysis
    ? new Map([...order, -1].map((side) => [side, sideName(side, summary, analysis)]))
    : new Map<number, string>(), [summary, analysis, order])

  function showName(event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, name: string) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setTooltip({ name, top: bounds.top + bounds.height / 2 })
  }

  return (
    <>
      <nav className="battle-rail" aria-label="飞行员名单" onScroll={() => setTooltip(null)}>
        {!analysis && <span className="sr-only" role="status">正在等待分析结果…</span>}
        {groups.map(({ side, rows }) => (
          <section key={side} aria-label={sideLabels.get(side)}>
            <div className="battle-rail-side" aria-hidden="true" title={sideLabels.get(side)}>
              <i className="side-dot" data-hollow={side < 0 ? '' : undefined}
                style={side < 0 ? undefined : { background: sideColor(side, order) }} />
              {sideLetter(side, order)}
            </div>
            {rows.map((row) => (
              <button type="button" className="battle-rail-pilot" key={row.key} aria-pressed={row.key === selected}
                aria-label={[
                  row.name, row.hasLog ? '有日志' : '没有日志', row.dead ? '已击毁' : null, row.ship ?? '未知舰船',
                ].filter(Boolean).join(' · ')}
                data-dead={row.dead || undefined} data-has-log={row.hasLog}
                onMouseEnter={(event) => showName(event, row.name)}
                onMouseLeave={(event) => { if (document.activeElement !== event.currentTarget) setTooltip(null) }}
                onFocus={(event) => showName(event, row.name)} onBlur={() => setTooltip(null)}
                onClick={() => { select(row.key); setTooltip(null) }}>
                <TypeIcon typeId={row.shipTypeId} size={20} />
                <i className="roster-dot" aria-hidden="true" />
              </button>
            ))}
          </section>
        ))}
      </nav>
      {tooltip && <span className="battle-rail-name" aria-hidden="true" style={{ top: tooltip.top }}>{tooltip.name}</span>}
    </>
  )
}
