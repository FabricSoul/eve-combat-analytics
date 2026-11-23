import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import type { Analysis, Entity } from '@/core/contract'
import { fmtHms, fmtNum } from '../lib/format'
import { sideColor, sideLetter, sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useView, type DrawerTab } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { Tabs, type TabOption } from '../ui/Tabs'
import { Tag } from '../ui/Tag'
import { TypeIcon } from '../ui/TypeIcon'
import { shipId, sideLabel, useCombatRows } from './compare/metrics'
import { FitTab } from './FitTab'
import { PersonStats, PointLog, pointSpans } from './person/PersonStats'
import './person/person.css'

export interface PersonDrawerProps {}

const tabs: readonly TabOption<DrawerTab>[] = [
  { value: 'stats', label: '数据' }, { value: 'fit', label: '配装' }, { value: 'events', label: '事件' },
]

export function PersonDrawer(_props: PersonDrawerProps) {
  const { analysis } = useBattleContext()
  const { selected, select, range } = useView()
  const pilot = selected ? analysis?.entities[selected] : undefined

  useEffect(() => {
    if (!selected) return
    function dismiss(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || range) return
      event.preventDefault()
      select(null)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [selected, select, range])

  if (!selected) return null
  if (!analysis || !pilot) {
    return <div className="u7-person"><div className="u7-person-toolbar">
      <p role="status">{analysis ? '没有该飞行员的数据。' : '正在加载个人数据…'}</p>
      <Button aria-label="关闭" onClick={() => select(null)}>×</Button>
    </div></div>
  }

  return <PilotDrawer key={pilot.key} pilot={pilot} analysis={analysis} />
}

function PilotDrawer({ pilot, analysis }: { pilot: Entity; analysis: Analysis }) {
  const { summary } = useBattleContext()
  const { drawerTab, setDrawerTab, focusOnly, setFocusOnly, select, oursSide, range, seek } = useView()
  const { rows, interactions } = useCombatRows()
  const [expanded, setExpanded] = useState(false)
  const [eventPage, setEventPage] = useState(1)
  const id = useId()
  const order = useMemo(() => sideOrder(analysis, oursSide), [analysis, oursSide])
  const bounds = useMemo(() => range ?? [
    analysis.timeline.start,
    Math.max(analysis.timeline.start, analysis.interactions.at(-1)?.t ?? 0),
  ] as const, [range, analysis])
  const events = useMemo(() => drawerTab === 'events'
    ? interactions.filter(({ from, to }) => from === pilot.key || to === pilot.key)
    : [], [drawerTab, interactions, pilot.key])
  const corporation = useMemo(() => {
    if (!summary || pilot.charId === null) return undefined
    const participant = summary.meta.killmails.flatMap(({ victim, attackers }) => [victim, ...attackers])
      .find(({ charId }) => pilot.charId === charId)
    const corpId = participant?.corpId ?? summary.names[pilot.name]?.corpId
    return corpId == null ? undefined : summary.meta.names[corpId]?.name
  }, [summary, pilot])
  const letter = sideLetter(pilot.side, order)
  return <div className="u7-person" data-expanded={expanded}>
    <header className="u7-person-header">
      <div className="u7-person-identity">
        <span className="u7-person-portrait"><Portrait charId={pilot.charId} size={56} /><TypeIcon typeId={shipId(pilot)} size={24} /></span>
        <div className="u7-person-name">
          <h2 title={pilot.name}>{pilot.name}</h2>
          <div className="u7-person-meta">
            <i className="u7-side-dot" data-unknown={pilot.side < 0} style={{ '--u7-side': sideColor(pilot.side, order) } as CSSProperties} />
            {sideLabel(pilot.side, oursSide, order)} {letter}
            {' · '}{pilot.shipTypes[0] ?? '未知舰船'}{' · '}{pilot.hasLog ? '有日志' : '无日志'}
          </div>
          {corporation && <div className="u7-person-meta">{corporation}</div>}
          {pilot.sideSource === 'log' && <Tag>阵营据日志</Tag>}
        </div>
        <div className="u7-person-actions">
          <Button variant="ghost" className="u7-drawer-expand" aria-label={expanded ? '还原抽屉' : '展开整页'}
            title={expanded ? '还原抽屉' : '展开整页'} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</Button>
          <Button variant="ghost" aria-label="关闭个人详情" title="关闭个人详情" onClick={() => select(null)}>×</Button>
        </div>
      </div>
      <div className="u7-person-toolbar">
        <Tabs tabs={tabs} value={drawerTab} onChange={setDrawerTab} id={id} label="个人详情" />
        <Button variant="ghost" className="u7-focus-player" aria-label="只看他的回放" aria-pressed={focusOnly}
          onClick={() => setFocusOnly(!focusOnly)}>只看他的回放</Button>
      </div>
    </header>
    <div role="tabpanel" id={`${id}-panel-${drawerTab}`} aria-labelledby={`${id}-tab-${drawerTab}`} className="u7-person-body">
      {drawerTab === 'stats' && <PersonStats analysis={analysis} pilot={pilot} rows={rows} interactions={interactions} bounds={bounds} order={order} select={select} />}
      {drawerTab === 'fit' && <FitTab />}
      {drawerTab === 'events' && <div className="u7-person-stack">
        <PointLog points={pointSpans(analysis.ewarSpans, pilot.key, bounds)} entities={analysis.entities} />
        <section className="u7-person-card">
          <h3>个人事件</h3>
          {!events.length && <p className="u7-secondary">这段时间没有相关事件。</p>}
          <ul>{events.slice(0, eventPage * 40).map((event, index) => {
            const outgoing = event.from === pilot.key
            const other = analysis.entities[outgoing ? event.to : event.from]
            const action = { damage: '伤害', miss: '未命中', repair: '维修', neut: '能量中和', nos: '能量吸取', ewar: '电子战' }[event.kind]
            return <li key={index}><button type="button" className="u7-person-event" onClick={() => seek(event.t)}>
              <time className="app-number">{fmtHms(event.t)}</time>
              <span>{outgoing ? '出手' : '受到'} · {action}</span>
              <Portrait charId={other?.charId ?? null} size={16} />
              <span className="u7-ellipsis" title={other?.name}>{other?.name ?? '未知'}</span>
              {event.amount !== 0 && <span className="app-number">{fmtNum(event.amount)}</span>}
            </button></li>
          })}</ul>
          {events.length > eventPage * 40 && <Button onClick={() => setEventPage(eventPage + 1)}>显示更多事件</Button>}
        </section>
      </div>}
    </div>
  </div>
}
