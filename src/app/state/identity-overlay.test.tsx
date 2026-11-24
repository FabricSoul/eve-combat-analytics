// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { Analysis, BattleSummary } from '@/core/contract'
import { entity, stats, tinyAnalysis, tinySummary } from '../battle/roster/testing'
import { BattleProvider, useBattleContext, useLocalIdentity } from './battle-store'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const hidden = entity(0, 0, { key: 'name:Hidden', name: 'Hidden', charId: null, shipTypes: ['Rifter'] })
const unfolded: Analysis = {
  ...tinyAnalysis,
  entities: { ...tinyAnalysis.entities, [hidden.key]: hidden },
  stats: [...tinyAnalysis.stats, { ...stats(0, 70), key: 'name:Hidden' }],
}
const folded: Analysis = { ...tinyAnalysis }
const merge = { from: 'name:Hidden' as const, to: 'char:2' as const, setAt: 1 }
const withMerges = (identityMerges: BattleSummary['identityMerges']): BattleSummary => ({ ...tinySummary, identityMerges })

let root: Root
let host: HTMLElement
afterEach(() => { act(() => root.unmount()); host.remove() })

function mount() {
  host = document.createElement('div')
  root = createRoot(host)
  let apply!: ReturnType<typeof useLocalIdentity> & object
  const renders: { merges: number; unidentified: number; stats: number; interactions: number }[] = []
  function Probe() {
    const { summary, analysis } = useBattleContext()
    apply = useLocalIdentity()!
    renders.push({
      merges: summary?.identityMerges?.length ?? 0,
      unidentified: Object.values(analysis?.entities ?? {}).filter((e) => e.charId === null && e.key === 'name:Hidden').length,
      stats: analysis?.stats.filter((s) => s.key === 'name:Hidden').length ?? 0,
      interactions: analysis?.interactions.filter((i) => i.from === 'name:Hidden').length ?? 0,
    })
    return null
  }
  const render = (summary: BattleSummary, analysis: Analysis) =>
    act(() => root.render(<BattleProvider static={{ summary, analysis }}><Probe /></BattleProvider>))
  render(withMerges(undefined), { ...unfolded, interactions: [{ t: 1, from: 'name:Hidden', to: 'char:4', kind: 'damage', amount: 70, weapon: null, quality: null, repairType: null, ewar: null, sources: [], corroborated: false }] })
  return { render, apply: (from: 'name:Hidden', to: 'char:2' | null) => { let undo!: () => void; act(() => { undo = apply(from, to) }); return undo }, renders, last: () => renders.at(-1)! }
}

describe('identity overlay', () => {
  it('applies a merge to everything the modules read in the same render (summary, entities, stats, interactions)', () => {
    const view = mount()
    expect(view.last()).toEqual({ merges: 0, unidentified: 1, stats: 1, interactions: 1 })
    const before = view.renders.length
    view.apply('name:Hidden', 'char:2')
    const after = view.renders.slice(before)
    expect(after.length).toBeGreaterThan(0)
    // Every render after the action shows the merge in all four places at once: no half-applied frame.
    for (const frame of after) expect(frame).toEqual({ merges: 1, unidentified: 0, stats: 0, interactions: 0 })
  })

  it('merge, undo before the echo, then the merge echo and the undo echo: never back to the merged value', () => {
    const view = mount()
    view.apply('name:Hidden', 'char:2')
    view.apply('name:Hidden', null)
    expect(view.last()).toMatchObject({ merges: 0, unidentified: 1 })
    const before = view.renders.length
    // Late echo of the merge: the server list has it, and the analysis is already folded.
    view.render(withMerges([merge]), folded)
    expect(view.last()).toMatchObject({ merges: 0, unidentified: 1, stats: 1, interactions: 1 })
    // Echo of the undo.
    view.render(withMerges([]), unfolded)
    expect(view.last()).toMatchObject({ merges: 0, unidentified: 1 })
    for (const frame of view.renders.slice(before)) expect(frame).toMatchObject({ merges: 0, unidentified: 1 })
  })

  it('a merge echo that matches ends the local op; the server state then rules', () => {
    const view = mount()
    view.apply('name:Hidden', 'char:2')
    view.render(withMerges([merge]), folded)
    expect(view.last()).toMatchObject({ merges: 1, unidentified: 0 })
    // Later the server removes it (another viewer): nothing local holds it any more.
    view.render(withMerges([]), unfolded)
    expect(view.last()).toMatchObject({ merges: 0, unidentified: 1 })
  })

  it('rolling a failed merge back restores the original frame', () => {
    const view = mount()
    const undo = view.apply('name:Hidden', 'char:2')
    act(() => undo())
    expect(view.last()).toMatchObject({ merges: 0, unidentified: 1, stats: 1 })
  })
})
