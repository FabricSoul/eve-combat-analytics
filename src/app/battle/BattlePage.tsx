import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { recordRecent } from '../home/recent'
import { fmtNum } from '../lib/format'
import { defaultOursSide } from '../lib/sides'
import { AppShell } from '../shell/AppShell'
import { battleTitle } from '../shell/battle-title'
import { PhonePersonPage } from '../shell/PhonePersonPage'
import { useBattleLayout } from '../shell/useBattleLayout'
import { useWindowViewport } from '../shell/windows/DesktopWindows'
import { ModuleControls, ModuleWorkspace, StageGrip } from '../shell/windows/ModuleWorkspace'
import { clampStage, loadModules, moduleLayoutReducer, saveModules, type ModuleId } from '../shell/windows/modules'
import '../shell/windows/windows.css'
import { BattleProvider, useBattleContext } from '../state/battle-store'
import { ViewProvider, useView, writeReplayNoise } from '../state/view-store'
import { BottomSheet } from '../ui/BottomSheet'
import { CompareTable } from './CompareTable'
import { EmptyBattle } from './EmptyBattle'
import { EventFeed } from './EventFeed'
import { HitAnalysis } from './HitAnalysis'
import { KillsList } from './KillsList'
import { PersonDrawer } from './PersonDrawer'
import { ReplayCanvas } from './ReplayCanvas'
import { Roster } from './Roster'
import { SidesPanel } from './SidesPanel'
import { Timeline, PilotTimelineModule } from './Timeline'
import { activityBounds } from './timeline/model'
import { UploadDock } from './UploadDock'
import { PilotActions, usePilotMenu } from './roster/PilotActions'
import { BattleUndo } from './undo'

const phoneTabs = [
  { value: 'roster', label: '名单' }, { value: 'events', label: '事件' }, { value: 'compare', label: '对比' }, { value: 'hits', label: '命中' },
] as const
type PhoneTab = typeof phoneTabs[number]['value']
const phonePanels = { roster: Roster, compare: CompareTable, hits: HitAnalysis, events: EventFeed }

const modules = { roster: Roster, compare: CompareTable, hits: HitAnalysis, kills: KillsList, feed: EventFeed, lanes: PilotTimelineModule }

function BattleWorkspace() {
  const battle = useBattleContext()
  const { summary, analysis, status, error, live } = battle
  const reconnecting = 'reconnecting' in battle && battle.reconnecting === true
  const view = useView()
  const layout = useBattleLayout()
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('events')
  const PhonePanel = phonePanels[phoneTab]
  const [sidesOpen, setSidesOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const sidesTrigger = useRef<HTMLButtonElement | null>(null)
  const desktopDrawer = useRef<HTMLElement>(null)
  const [dismissedDrawer, setDismissedDrawer] = useState(false)
  const [lastSelection, setLastSelection] = useState(view.selected)
  if (lastSelection !== view.selected) {
    setLastSelection(view.selected)
    setDismissedDrawer(false)
  }
  const drawerOpen = Boolean(summary && view.selected && !dismissedDrawer)
  const desktopDrawerOpen = drawerOpen && layout !== 'phone'
  const pilotMenu = usePilotMenu()
  const picker = useRef<HTMLInputElement>(null)
  const openPicker = () => picker.current?.click()
  const desk = useRef<HTMLDivElement>(null)
  const workspace = layout !== 'phone'
  const [moduleLayout, dispatchModule] = useReducer(moduleLayoutReducer, undefined, () => loadModules())
  const viewport = useWindowViewport(desk, workspace && Boolean(summary))
  const viewportHeight = viewport.height + 48
  const stageHeight = clampStage(moduleLayout.stageHeight ?? viewportHeight * 0.60, viewportHeight)
  const [search, setSearch] = useState<'feed' | 'roster' | null>(null)
  const [eventFilters, setEventFilters] = useState(true)
  const [rosterAlphabetical, setRosterAlphabetical] = useState(false)
  const [killsExpanded, setKillsExpanded] = useState(false)
  const cancelDrag = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    if (workspace) saveModules(moduleLayout)
  }, [workspace, moduleLayout])

  const opened = useRef<string | null>(null)
  const meta = summary?.meta
  const logCount = summary?.logs.length

  useEffect(() => {
    if (!meta || logCount === undefined || opened.current === meta.brId) return
    opened.current = meta.brId
    recordRecent({
      brId: meta.brId,
      title: battleTitle(meta),
      start: meta.windows.length ? Math.min(...meta.windows.map(({ start }) => start)) : undefined,
      end: meta.windows.length ? Math.max(...meta.windows.map(({ end }) => end)) : undefined,
      kills: meta.killmails.length,
      logs: logCount,
      openedAt: Date.now(),
    })
  }, [meta, logCount])

  function openSides(trigger: HTMLButtonElement) {
    sidesTrigger.current = trigger
    setMenuOpen(false)
    setSidesOpen(true)
  }

  const closeSides = useCallback(() => {
    if (layout === 'phone') setMenuOpen(true)
    setSidesOpen(false)
  }, [layout])

  useLayoutEffect(() => {
    if (sidesOpen || !sidesTrigger.current) return
    sidesTrigger.current.focus({ preventScroll: true })
    sidesTrigger.current = null
  }, [sidesOpen])

  useLayoutEffect(() => {
    if (!desktopDrawerOpen) return
    const opener = document.activeElement
    desktopDrawer.current?.querySelector<HTMLElement>('button[aria-label="关闭个人详情"], button[aria-label="关闭"]')
      ?.focus({ preventScroll: true })
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true })
      } else {
        desk.current?.querySelector<HTMLElement>('.battle-window-titlebar')
          ?.focus({ preventScroll: true })
      }
    }
  }, [desktopDrawerOpen])

  useEffect(() => {
    function closeOrClear(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (cancelDrag.current?.()) {
        event.preventDefault()
        return
      }
      const lastFloat = moduleLayout.order.filter((id) => moduleLayout.modules[id].floating && !moduleLayout.modules[id].hidden).at(-1)
      const localMenu = document.activeElement?.closest('[role="menu"], .eca-timeline-help-popover, .app-side-picker:has([aria-expanded="true"])')
      if (localMenu) return // These widgets close themselves and restore the focus.
      if (document.activeElement?.closest('[data-timeline-chart][data-range-draft]')) return
      const openMenu = [...document.querySelectorAll<HTMLDetailsElement>(
        '.battle-module-controls[open], .battle-layout details[open]:not(.replay-close-fights)',
      )].filter((menu) => menu.getClientRects().length > 0).at(-1)
      const expanded = [...document.querySelectorAll<HTMLButtonElement>('[data-full-page-close]')].filter((button) => button.getClientRects().length > 0).at(-1)
      if (pilotMenu?.closeMenu()) { /* closed the shared row menu */ }
      else if (openMenu) {
        openMenu.open = false
        openMenu.querySelector('summary')?.focus({ preventScroll: true })
      } else if (menuOpen) {
        setMenuOpen(false)
        menuTrigger.current?.focus()
      } else if (pilotMenu?.closePicker()) { /* closed the identity picker */ }
      else if (sidesOpen) closeSides()
      else if (drawerOpen) {
        if (workspace) setDismissedDrawer(true)
        else view.select(null)
      } else if (expanded) expanded.click()
      else if (lastFloat && workspace) dispatchModule({ type: 'dock', id: lastFloat })
      else if (view.range) view.clearRange()
      else if (view.selected) view.select(null)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', closeOrClear, true)
    return () => window.removeEventListener('keydown', closeOrClear, true)
  }, [sidesOpen, closeSides, menuOpen, view.range, view.selected, view.select, view.clearRange, drawerOpen, moduleLayout, workspace, pilotMenu])

  function renderModule(id: ModuleId) {
    if (id === 'roster') return <Roster search={search === id} alphabetical={rosterAlphabetical} />
    if (id === 'feed') return <EventFeed search={search === id} showFilters={eventFilters} />
    if (id === 'kills') return <KillsList expanded={killsExpanded} onRestore={() => setKillsExpanded(false)} />
    const Module = modules[id]
    return <Module />
  }

  function moduleTools(id: ModuleId) {
    if (id === 'lanes') return <button title="将所选飞行员加入时间线" aria-label="将所选飞行员加入时间线" type="button"
      disabled={!view.selected || view.pinned.has(view.selected)} onClick={() => { if (view.selected) view.togglePin(view.selected) }}>+</button>
    if (id === 'feed' || id === 'roster') {
      const label = id === 'feed' ? '搜索事件' : '搜索名单'
      return <>
        {id === 'feed' ? <button type="button" title="筛选事件" aria-label="筛选事件" aria-pressed={eventFilters}
          onClick={() => setEventFilters(!eventFilters)}>⧩</button>
          : <button type="button" title="按飞行员名称排序" aria-label="按飞行员名称排序" aria-pressed={rosterAlphabetical}
            onClick={() => setRosterAlphabetical(!rosterAlphabetical)}>⇅</button>}
        <button type="button" title={label} aria-label={label} aria-pressed={search === id}
          onClick={() => setSearch(search === id ? null : id)}>⌕</button>
      </>
    }
    if (id === 'kills') return <button title="整页查看击毁" aria-label="整页查看击毁" type="button"
      onClick={() => setKillsExpanded(true)}>⤢</button>
    return <>
      <button title={id === 'compare' ? '整页查看对比' : '整页查看命中'}
        aria-label={id === 'compare' ? '整页查看对比' : '整页查看命中'} type="button" onClick={(event) => {
        const root = event.currentTarget.closest('[data-module]')
        root?.querySelector<HTMLButtonElement>(id === 'compare' ? '.u7-compare-controls > .app-button' : '.hit-analysis-header > .app-button')?.click()
      }}>⤢</button>
      <button title={id === 'hits' ? '命中排名指标' : '对比列'} aria-label={id === 'hits' ? '命中排名指标' : '对比列'} type="button"
        onClick={(event) => {
          const root = event.currentTarget.closest('[data-module]')
          const control = root?.querySelector<HTMLElement>(id === 'hits' ? 'select' : '.u7-compare-controls details:nth-of-type(2) summary')
          control?.focus()
          if (control instanceof HTMLSelectElement && typeof control.showPicker === 'function') {
            try { control.showPicker() } catch { /* The focused select remains keyboard operable. */ }
          }
          else if (id === 'compare') control?.click()
        }}>{id === 'hits' ? '⇅' : '▤'}</button>
    </>
  }

  function shareUrl() {
    const url = new URL(window.location.href)
    url.searchParams.set('ours', String(view.oursSide))
    const t = view.getTime()
    if (t > 0) url.searchParams.set('t', String(Math.floor(t)))
    if (view.selected) url.searchParams.set('sel', view.selected)
    else url.searchParams.delete('sel')
    writeReplayNoise(url.searchParams, view.hiddenNoise)
    return url.href
  }

  return (
    <AppShell battle topBar={{
      summary,
      analysis,
      live,
      reconnecting,
      menuOpen,
      onMenuOpenChange: setMenuOpen,
      menuTrigger,
      windowControls: workspace && summary ? <ModuleControls layout={moduleLayout} dispatch={dispatchModule} /> : undefined,
      oursSide: view.oursSide,
      onOursSideChange: view.setOursSide,
      onUpload: summary ? openPicker : undefined,
      onOpenSides: summary ? openSides : undefined,
      shareUrl: summary ? shareUrl : undefined,
    }}>
      {summary ? (
        <div ref={desk} className="battle-layout" data-layout={layout} data-density={workspace ? 'compact' : undefined}>
          {workspace ? <div className="battle-module-scroll">
            <section className="battle-stage" aria-label="回放舞台" style={{ height: stageHeight }}>
              <section className="battle-replay" aria-label="回放">
                {summary.logs.length === 0 ? <EmptyBattle onUpload={openPicker} /> : <ReplayCanvas stage />}
              </section>
              <section className="battle-timeline" aria-label="时间轴"><Timeline separateLanes /></section>
              <StageGrip height={stageHeight} viewportHeight={viewportHeight} dispatch={dispatchModule} />
            </section>
            <ModuleWorkspace desk={desk} viewport={viewport} columns={layout === 'desktop' ? 3 : 2}
              layout={moduleLayout} dispatch={dispatchModule} dragCancel={cancelDrag}
              subtitles={{
                feed: { merged: '合并同类', raw: '逐条', key: '只看关键' }[view.feedMode],
                compare: analysis ? `${fmtNum(analysis.stats.length)} 人` : '',
                roster: analysis ? `我方 ${fmtNum(analysis.coverage.find(({ side }) => side === view.oursSide)?.known ?? 0)} · 其他 ${fmtNum(analysis.coverage.reduce((total, { side, known }) => total + (side === view.oursSide ? 0 : known), 0))}` : '',
                kills: `${fmtNum(summary.meta.killmails.length)} 次击毁`, hits: '我方 · 敌方',
                lanes: `${fmtNum(view.pinned.size)} 人`,
              }} content={renderModule} tools={moduleTools} />
          </div> : <>
            <section className="battle-replay" aria-label="回放">
              {summary.logs.length === 0 ? <EmptyBattle onUpload={openPicker} /> : <ReplayCanvas />}
            </section>
            <section className="battle-timeline" aria-label="时间轴"><Timeline compact /></section>
          </>}
          {layout === 'phone' && (
            <BottomSheet<PhoneTab> tabs={phoneTabs} value={phoneTab} onChange={setPhoneTab}>
              <PhonePanel />
            </BottomSheet>
          )}
          {drawerOpen && (layout === 'phone'
            ? <PhonePersonPage><PersonDrawer /></PhonePersonPage>
            : <aside ref={desktopDrawer} tabIndex={-1} className="battle-drawer" aria-label="个人详情"><PersonDrawer /></aside>)}
          {sidesOpen && <div className="battle-sides"><SidesPanel onClose={closeSides} /></div>}
          <div className="battle-upload"><UploadDock pickerRef={picker} /></div>
        </div>
      ) : (
        <div className="battle-status" role={status === 'error' ? 'alert' : 'status'}>
          {status !== 'error' ? '正在加载战斗…' : error?.code === 'br_not_found' ? '未找到该战斗' : '无法加载战斗'}
        </div>
      )}
    </AppShell>
  )
}

function BattleViewRoot() {
  const { summary, analysis } = useBattleContext()
  const activity = useMemo(() => activityBounds(summary, analysis), [summary, analysis])
  const initialTime = activity?.[0] ?? summary?.meta.windows[0]?.start ?? 0
  const endTime = activity?.[1] ?? initialTime
  return (
    <ViewProvider initialTime={initialTime} endTime={endTime} defaultSide={summary ? defaultOursSide(summary) : 0}>
      <BattleUndo><PilotActions><BattleWorkspace /></PilotActions></BattleUndo>
    </ViewProvider>
  )
}

export interface BattlePageProps { brId: string }

export function BattlePage({ brId }: BattlePageProps) {
  return <BattleProvider brId={brId}><BattleViewRoot /></BattleProvider>
}
