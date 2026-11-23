import { useEffect, useRef, useState } from 'react'
import { defaultOursSide } from '../lib/sides'
import { AppShell } from '../shell/AppShell'
import { BattleProvider, useBattleContext } from '../state/battle-store'
import { ViewProvider, useView, type PanelTab } from '../state/view-store'
import { Tabs, type TabOption } from '../ui/Tabs'
import { CompareTable } from './CompareTable'
import { EmptyBattle } from './EmptyBattle'
import { EventFeed } from './EventFeed'
import { FitTab } from './FitTab'
import { KillsList } from './KillsList'
import { PersonDrawer } from './PersonDrawer'
import { ReplayCanvas } from './ReplayCanvas'
import { Roster } from './Roster'
import { SidesPanel } from './SidesPanel'
import { Timeline } from './Timeline'
import { UploadDock } from './UploadDock'

const tabs: readonly TabOption<PanelTab>[] = [
  { value: 'roster', label: '名单' }, { value: 'compare', label: '对比' },
  { value: 'kills', label: '击毁' }, { value: 'fit', label: '配装' },
]

const panels = { roster: Roster, compare: CompareTable, kills: KillsList, fit: FitTab }
const panelId = 'battle-panel'

function BattleWorkspace() {
  const { summary, status, error } = useBattleContext()
  const view = useView()
  const [sidesOpen, setSidesOpen] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const openPicker = () => picker.current?.click()
  const Panel = panels[view.panelTab]

  useEffect(() => {
    function closeOrClear(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (sidesOpen) setSidesOpen(false)
      else if (view.range) view.setRange(null)
      else if (view.selected) view.select(null)
    }
    window.addEventListener('keydown', closeOrClear)
    return () => window.removeEventListener('keydown', closeOrClear)
  }, [sidesOpen, view.range, view.selected, view.select, view.setRange])

  function shareUrl() {
    const url = new URL(window.location.href)
    url.searchParams.set('ours', String(view.oursSide))
    if (view.t > 0) url.searchParams.set('t', String(Math.floor(view.t)))
    if (view.selected) url.searchParams.set('sel', view.selected)
    else url.searchParams.delete('sel')
    return url.href
  }

  return (
    <AppShell battle topBar={{
      summary,
      oursSide: view.oursSide,
      onOursSideChange: view.setOursSide,
      onUpload: summary ? openPicker : undefined,
      onOpenSides: summary ? () => setSidesOpen(true) : undefined,
      shareUrl: summary ? shareUrl : undefined,
    }}>
      {summary ? (
        <div className="battle-layout">
          <aside className="battle-panel" aria-label="战斗数据">
            <Tabs id={panelId} tabs={tabs} value={view.panelTab} onChange={view.setPanelTab} label="战斗数据" />
            <div className="battle-panel-content" role="tabpanel" id={`${panelId}-panel-${view.panelTab}`}
              aria-labelledby={`${panelId}-tab-${view.panelTab}`}>
              <Panel />
            </div>
          </aside>
          <section className="battle-replay" aria-label="回放">
            {summary.logs.length === 0 ? <EmptyBattle onUpload={openPicker} /> : <ReplayCanvas />}
          </section>
          <aside className="battle-feed" aria-label="事件流">
            <div className="battle-feed-content"><EventFeed /></div>
          </aside>
          <section className="battle-timeline" aria-label="时间轴"><Timeline /></section>
          {view.selected && <aside className="battle-drawer" aria-label="个人详情"><PersonDrawer /></aside>}
          {sidesOpen && <div className="battle-sides"><SidesPanel onClose={() => setSidesOpen(false)} /></div>}
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
  const initialTime = analysis?.timeline.start || summary?.meta.windows[0]?.start || 0
  const endTime = Math.max(
    initialTime,
    analysis?.interactions.at(-1)?.t ?? 0,
    summary?.meta.killmails.at(-1)?.t ?? 0,
  )
  return (
    <ViewProvider initialTime={initialTime} endTime={endTime} defaultSide={summary ? defaultOursSide(summary) : 0}>
      <BattleWorkspace />
    </ViewProvider>
  )
}

export interface BattlePageProps { brId: string }

export function BattlePage({ brId }: BattlePageProps) {
  return <BattleProvider brId={brId}><BattleViewRoot /></BattleProvider>
}
