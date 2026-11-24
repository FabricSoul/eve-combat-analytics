import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Entity, EntityKey, IdentityMerge } from '@/core/contract'
import { useBattleContext } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import { affiliationOf } from './affiliation'
import { IdentityPicker } from './IdentityPicker'
import { fullSideOrder } from './model'
import { shipNameById } from './ships'
import { SideMenu, type SideMenuSection } from './SideMenu'
import { useIdentity } from './use-identity'
import { useSideMove } from './use-side-move'

type Open = (key: EntityKey, event: MouseEvent, anchor?: boolean) => void
type Target = { key: EntityKey; invoker: HTMLElement | null }
type Menu = Target & { x: number; y: number; anchorTop: number }
const PilotMenu = createContext<{ open: Open; active: EntityKey | null; closeMenu(): boolean; closePicker(): boolean; identify(key: EntityKey, invoker: HTMLElement | null): void; unmerge(from: EntityKey): void; flashed: EntityKey | null } | null>(null)
export const usePilotMenu = () => useContext(PilotMenu)

export function PilotMore({ pilot, name, className }: { pilot: EntityKey; name: string; className?: string }) {
  const menu = usePilotMenu()
  return menu && <button type="button" className={className ?? 'pilot-more'} title={`${name} 的操作`}
    aria-label={`${name} 的操作`} aria-haspopup="menu" aria-expanded={menu.active === pilot}
    onClick={(event) => { event.stopPropagation(); menu.open(pilot, event, true) }}>⋯</button>
}

export function PilotActions({ children }: { children: ReactNode }) {
  const { summary, analysis } = useBattleContext()
  const view = useView()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [picker, setPicker] = useState<Target | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const mover = useSideMove(summary?.meta.brId ?? '', summary?.sideOverrides, summary?.analysisVersion)
  const identity = useIdentity(summary?.meta.brId ?? '', summary?.identityMerges)
  const [flashed, setFlashed] = useState<EntityKey | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const mergeLabel = (from: EntityKey) => {
    const ship = /^ship:(\d+):/.exec(from)?.[1]
    return analysis?.entities[from]?.name ?? (ship ? shipNameById(Number(ship)) ?? from : from.replace(/^name:/, ''))
  }
  function unmerge(from: EntityKey) {
    void identity.put(from, null, `已取消合并 ${mergeLabel(from)}`)
  }
  /** The dialog is already closed: the merge shows at once, the toast names both and offers 撤销, the pilot's row flashes. */
  function pickIdentity(from: EntityKey, target: Entity) {
    const to = `char:${target.charId}` as IdentityMerge['to']
    void identity.put(from, to, `已合并 ${mergeLabel(from)} → ${target.name}`)
    if (view.selected === from) view.select(to)
    setFlashed(to)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashed(null), 1600)
  }

  const open: Open = (key, event, anchor = false) => {
    if (!analysis?.entities[key]) return
    const element = event.currentTarget as HTMLElement
    const box = element.getBoundingClientRect()
    const keyMenu = !anchor && event.clientX === 0 && event.clientY === 0
    const placed = anchor || keyMenu
    const invoker = element instanceof HTMLButtonElement ? element : element.querySelector<HTMLElement>('button')
    event.preventDefault()
    event.stopPropagation()
    setMenu({ key, x: placed ? box.left : event.clientX, y: placed ? box.bottom : event.clientY,
      anchorTop: placed ? box.top : event.clientY, invoker })
  }

  const pilot = menu && analysis?.entities[menu.key]
  const picking = picker && analysis?.entities[picker.key]
  const sections: SideMenuSection[] = []
  const actions: { label: string; run(): void }[] = []
  if (pilot && summary && menu) {
    if (pilot.charId === null) {
      actions.push({ label: '这是谁…', run: () => setPicker(menu) })
    } else {
      sections.push({ heading: `移到… · ${pilot.name}`, subject: `char:${pilot.charId}`, current: pilot.side })
      const affiliation = affiliationOf(summary, pilot.charId)
      if (affiliation) {
        const { corpId, allyId } = affiliation
        sections.push({ heading: `整个军团一起移 · ${summary.meta.names[corpId]?.name ?? corpId}`, subject: `corp:${corpId}`, current: pilot.side })
        if (allyId !== null) sections.push({
          heading: `整个联盟一起移 · ${summary.meta.names[allyId]?.name ?? allyId}`, subject: `ally:${allyId}`, current: pilot.side,
        })
      }
      for (const { from, to } of summary.identityMerges ?? []) {
        if (to !== pilot.key) continue
        actions.push({ label: `取消合并 · ${mergeLabel(from)}`, run: () => unmerge(from) })
      }
    }
    actions.push({ label: '看他的回放', run: () => {
      if (view.selected !== pilot.key) view.select(pilot.key)
      view.setFocusOnly(true)
    } })
  }
  const error = mover.error ?? identity.error

  return <PilotMenu value={{ open, active: menu?.key ?? null,
    closeMenu: () => { if (!menu) return false; closeMenu(); return true },
    closePicker: () => { if (!picker) return false; setPicker(null); return true },
    identify: (key, invoker) => setPicker({ key, invoker }), unmerge, flashed,
  }}>
    {children}
    {menu && pilot && analysis && createPortal(
      <SideMenu key={menu.key} x={menu.x} y={menu.y} anchorTop={menu.anchorTop} returnFocus={menu.invoker}
        sections={sections} order={fullSideOrder(analysis, view.oursSide)} actions={actions} onClose={closeMenu}
        pinAction={pilot.charId === null ? undefined : { label: view.pinned.has(pilot.key) ? '移出时间轴对比' : '加入时间轴对比', run: () => view.togglePin(pilot.key) }}
        onMove={(subject, side) => void mover.move(subject, side)} />, document.body)}
    {picker && picking && summary && analysis && createPortal(
      <IdentityPicker from={picker.key} label={picking.name} analysis={analysis} returnFocus={picker.invoker}
        onPick={(target) => pickIdentity(picker.key, target)} onClose={() => setPicker(null)} />, document.body)}
    {error && <div className="battle-undo" role="alert">{error}</div>}
  </PilotMenu>
}
