import { useId, useMemo, useState, type CSSProperties } from 'react'
import type { EntityKey } from '@/core/contract'
import { fmtHms } from '../lib/format'
import { sideColor, sideLetter, sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { Tabs } from '../ui/Tabs'
import { defaultColumns, metricValue, metrics, sideLabel, useCombatRows, type Metric } from './compare/metrics'
import { Distribution, makeColumn, MetricBar, MetricLabel, MetricValue, PilotName, SideBySide } from './compare/CompareViews'
import './compare/compare.css'

export interface CompareTableProps {}

const views = [
  { value: 'table', label: '大表' }, { value: 'side-by-side', label: '并排' }, { value: 'distribution', label: '分布' },
] as const
type CompareMode = (typeof views)[number]['value']
const groups = [...new Set(metrics.map(({ group }) => group))]
const initialSort = { key: 'damageOut', direction: 'descending' } as const
const maxPinned = 4

export function CompareTable(_props: CompareTableProps) {
  const { analysis, summary } = useBattleContext()
  const { oursSide, select, range } = useView()
  const { rows } = useCombatRows()
  const [mode, setMode] = useState<CompareMode>('table')
  const [sort, setSort] = useState<{ key: Metric['key']; direction: 'ascending' | 'descending' }>(initialSort)
  const [visible, setVisible] = useState<ReadonlySet<Metric['key']>>(() => new Set(defaultColumns))
  const [pinned, setPinned] = useState<ReadonlySet<EntityKey>>(() => new Set())
  const [hiddenSides, setHiddenSides] = useState<ReadonlySet<number>>(() => new Set())
  const [expanded, setExpanded] = useState(false)
  const [compactMetric, setCompactMetric] = useState<Metric['key']>('damageOut')
  const id = useId()

  const order = useMemo(() => analysis ? sideOrder(analysis, oursSide) : [], [analysis, oursSide])
  const shown = useMemo(() => rows.filter(({ entity }) => !hiddenSides.has(entity.side)), [rows, hiddenSides])
  const columns = useMemo(() => metrics.filter(({ key }) => visible.has(key)).map((metric) => makeColumn(metric, shown)), [shown, visible])
  const sorted = useMemo(() => {
    const metric = metrics.find(({ key }) => key === sort.key)!
    return [...shown].sort((a, b) => {
      const pinOrder = Number(pinned.has(b.entity.key)) - Number(pinned.has(a.entity.key))
      if (pinOrder) return pinOrder
      const first = metricValue(a, metric)
      const second = metricValue(b, metric)
      if (first === second) return a.entity.name.localeCompare(b.entity.name)
      if (first === null) return 1
      if (second === null) return -1
      return sort.direction === 'ascending' ? first - second : second - first
    })
  }, [shown, pinned, sort])

  if (!analysis) return <p className="u7-compare-message" role="status">正在加载对比数据…</p>
  const sides = rows.some(({ entity }) => entity.side < 0) ? [...order, -1] : order
  const checked = sorted.filter(({ entity }) => pinned.has(entity.key))
  const viewColumns = groups.map((group) => ({ group, columns: columns.filter(({ metric }) => metric.group === group) }))
    .filter((entry) => entry.columns.length)
  const activeCompact = visible.has(compactMetric) ? compactMetric : columns[0]?.metric.key
  const windows = summary?.meta.windows ?? []
  const bounds = range ?? (windows.length
    ? [Math.min(...windows.map(({ start }) => start)), Math.max(...windows.map(({ end }) => end))]
    : undefined)

  function toggle<K>(set: ReadonlySet<K>, key: K) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  function toggleColumn(key: Metric['key']) {
    const next = toggle(visible, key)
    if (!next.size) return
    setVisible(next)
    if (!next.has(sort.key)) setSort({ key: metrics.find((metric) => next.has(metric.key))!.key, direction: 'descending' })
  }

  function pin(key: EntityKey) {
    if (pinned.has(key) || pinned.size < maxPinned) setPinned(toggle(pinned, key))
  }

  function changeSort(key: Metric['key']) {
    setSort({ key, direction: sort.key === key && sort.direction === 'descending' ? 'ascending' : 'descending' })
  }

  return <section className="u7-compare" data-expanded={expanded} aria-label="飞行员对比">
    <header className="u7-compare-header">
      <h2>飞行员对比</h2>
      <Tabs<CompareMode> id={id} label="对比视图" tabs={views} value={mode} onChange={setMode} />
      <div className="u7-compare-controls">
        <details><summary>阵营</summary><div className="u7-compare-options">
          {sides.map((side) => <label key={side}>
            <input type="checkbox" checked={!hiddenSides.has(side)} onChange={() => setHiddenSides(toggle(hiddenSides, side))} />
            <i className="u7-side-dot" data-unknown={side < 0} style={{ '--u7-side': sideColor(side, order) } as CSSProperties} />
            {sideLabel(side, oursSide, order)} {sideLetter(side, order)}
          </label>)}
        </div></details>
        <details><summary>列</summary><div className="u7-compare-options u7-column-options">
          {groups.map((group) => <fieldset key={group}><legend>{group}</legend>
            {metrics.filter((metric) => metric.group === group).map((metric) => <label key={metric.key}>
              <input type="checkbox" checked={visible.has(metric.key)} onChange={() => toggleColumn(metric.key)}
                disabled={visible.size === 1 && visible.has(metric.key)} />
              <MetricLabel metric={metric} />
            </label>)}
          </fieldset>)}
        </div></details>
        <Button variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '整页'}</Button>
      </div>
    </header>
    <div className="u7-compare-note">
      <span>{mode === 'table' ? '勾选的人置顶 · 竖线是中位数' : mode === 'side-by-side' ? '每项一组条形 · 竖线是中位数' : '每项一条轴 · 虚线是中位数'}</span>
      {bounds && <span>{range ? '选段' : '全场'} <span className="app-number">{fmtHms(bounds[0])}–{fmtHms(bounds[1])}</span></span>}
    </div>
    {mode !== 'table' && <details className="u7-compare-pick">
      <summary>选择飞行员 <span className="app-number">{pinned.size} / {maxPinned}</span></summary>
      <div>{shown.map((row) => <label key={row.entity.key}>
        <input type="checkbox" checked={pinned.has(row.entity.key)} onChange={() => pin(row.entity.key)}
          disabled={pinned.size >= maxPinned && !pinned.has(row.entity.key)} />
        <PilotName row={row} />
      </label>)}</div>
    </details>}
    <div role="tabpanel" id={`${id}-panel-${mode}`} aria-labelledby={`${id}-tab-${mode}`} className="u7-compare-body">
      {mode === 'table' && <>
        <label className="u7-compact-metric">指标 <select className="app-select" value={activeCompact} onChange={(event) => {
          const metric = columns.find(({ metric }) => metric.key === event.currentTarget.value)?.metric
          if (metric) setCompactMetric(metric.key)
        }}>
          {viewColumns.map(({ group, columns: entries }) => <optgroup key={group} label={group}>
            {entries.map(({ metric }) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
          </optgroup>)}
        </select></label>
        <div className="u7-compare-scroll" tabIndex={0} aria-label="对比表">
          <table><colgroup />{viewColumns.map(({ group, columns: entries }) => <colgroup key={group} span={entries.length} />)}<thead>
            <tr className="u7-compare-groups"><th rowSpan={2} scope="col">
              飞行员 <small>· 有日志 <span className="app-number">{shown.filter(({ entity }) => entity.hasLog).length}</span></small>
            </th>{viewColumns.map(({ group, columns: entries }) => <th key={group} colSpan={entries.length} scope="colgroup">{group}</th>)}</tr>
            <tr><th className="u7-compact-pilot" scope="col">飞行员</th>{columns.map(({ metric }) => <th key={metric.key} scope="col" data-compact={metric.key === activeCompact}
              aria-sort={sort.key === metric.key ? sort.direction : undefined}>
              <button type="button" onClick={() => changeSort(metric.key)}><MetricLabel metric={metric} />
                {metric.key === sort.key && <span aria-hidden="true">{sort.direction === 'descending' ? ' ↓' : ' ↑'}</span>}
              </button>
            </th>)}</tr>
          </thead><tbody>{sorted.map((row) => <tr key={row.entity.key} data-pinned={pinned.has(row.entity.key)}>
            <th scope="row"><label><input type="checkbox" aria-label={`并排对比 ${row.entity.name}`}
              checked={pinned.has(row.entity.key)} onChange={() => pin(row.entity.key)}
              disabled={pinned.size >= maxPinned && !pinned.has(row.entity.key)} /></label>
              <PilotName row={row} onClick={() => select(row.entity.key)} /></th>
            {columns.map((column) => <td key={column.metric.key} data-compact={column.metric.key === activeCompact}>
              <MetricValue row={row} metric={column.metric} />
              <MetricBar value={metricValue(row, column.metric)} column={column} color={sideColor(row.entity.side, order)} />
            </td>)}
          </tr>)}</tbody></table>
          {!sorted.length && <p className="u7-compare-message">没有符合筛选条件的飞行员。</p>}
        </div>
      </>}
      {mode === 'side-by-side' && <SideBySide rows={checked} columns={columns} order={order} />}
      {mode === 'distribution' && <Distribution rows={shown} columns={columns} order={order} pinned={pinned} onSelect={select} />}
    </div>
  </section>
}
