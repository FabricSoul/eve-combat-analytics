// Test helpers for the roster, sides panel and feed: a small hand-made battle (names and ids are invented for tests).
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Analysis, BattleSummary, Entity, PilotStats } from '@/core/contract'
import { BattleProvider } from '../../state/battle-store'
import { ViewProvider } from '../../state/view-store'

export const stats = (id: number, damageOut: number): PilotStats => ({
  key: `char:${id}`, activeRatio: 0, damageOut, damageIn: 0, repairOut: 0, repairIn: 0, neutOut: 0, neutIn: 0,
  primaryShare: 0, switchDelayMedian: null, switchAfterKillMedian: null, repReactionMedian: null, firstShotDelay: null,
  hitQuality: {}, misses: 0, pointSeconds: 0, killmailDamage: 0, killmailCount: 0,
})

export const entity = (id: number, side: number, patch: Partial<Entity> = {}): Entity => ({
  key: `char:${id}`, name: `Pilot${id}`, charId: id, side, sideSource: 'br', shipTypes: ['Leshak'], hasLog: false, ...patch,
})

export const tinySummary: BattleSummary = {
  meta: {
    brId: 'tiny', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []],
    names: { 10: { name: 'Alpha Corp', category: 'corporation' }, 20: { name: 'Beta Alliance', category: 'alliance' } },
    killmails: [{
      id: 1, hash: 'h', systemId: 1, t: 0, value: 3e8,
      victim: { charId: 4, corpId: 10, allyId: null, shipTypeId: 47271, weaponTypeId: null, damage: 0 },
      attackers: [
        { charId: 1, corpId: 10, allyId: null, shipTypeId: 1, weaponTypeId: null, damage: 1 },
        { charId: 2, corpId: 10, allyId: null, shipTypeId: 1, weaponTypeId: null, damage: 1 },
        { charId: 3, corpId: 11, allyId: 20, shipTypeId: 1, weaponTypeId: null, damage: 1 },
        { charId: 5, corpId: 11, allyId: 20, shipTypeId: 1, weaponTypeId: null, damage: 1 },
      ],
    }],
  },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
}

export const tinyAnalysis: Analysis = {
  entities: Object.fromEntries([
    entity(1, 0, { hasLog: true }), entity(2, 0), entity(3, 0, { hasLog: true, sideSource: 'log' }),
    entity(4, 1), entity(5, 1, { sideSource: 'manual' }), entity(6, -1),
  ].map((e) => [e.key, e])),
  sideOverrides: [{ subject: 'char:3', side: 0, source: 'log', reason: 'repaired side 0: 842 events', setAt: 0 }],
  interactions: [], ewarSpans: [], primaries: [],
  stats: [stats(1, 10), stats(2, 500), stats(3, 100), stats(4, 5), stats(5, 900), stats(6, 1)],
  coverage: [{ side: 0, known: 3, withLog: 2 }, { side: 1, known: 2, withLog: 0 }],
  timeline: { start: 0, damageBySide: {} },
}

interface Data { summary: BattleSummary; analysis: Analysis }
interface ViewOptions { initialTime?: number; endTime?: number; defaultSide?: number }

export function mountApp(ui: ReactElement, data: Data = { summary: tinySummary, analysis: tinyAnalysis }, view: ViewOptions = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const tree = (node: ReactElement, battle: Data) => (
    <BattleProvider static={battle}>
      <ViewProvider syncUrl={false} defaultSide={0} {...view}>{node}</ViewProvider>
    </BattleProvider>
  )
  act(() => root.render(tree(ui, data)))
  return {
    container,
    rerender(next: ReactElement, nextData: Data = data) {
      act(() => root.render(tree(next, nextData)))
    },
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
