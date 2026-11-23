import { describe, expect, it } from 'vitest'
import { loadUiFixture } from '../../test/ui-fixture'
import { defaultOursSide } from '../../lib/sides'
import { rosterSamples } from './example'
import { buildRoster } from './model'

describe('rosterSamples (gallery states)', () => {
  const fixture = loadUiFixture()
  const ours = defaultOursSide(fixture.summary)

  it('finds a pilot for every state, each really in that state', () => {
    const samples = rosterSamples(fixture, ours)
    expect(samples.logged.hasLog).toBe(true)
    expect(samples.logged.dead).toBe(false)
    expect(samples.unlogged.hasLog).toBe(false)
    expect(samples.corrected.tag?.kind).toBe('log')
  })

  it('shows the dead sample dead at its kill time and alive before it', () => {
    const { dead, deadAt } = rosterSamples(fixture, ours)
    const at = (t: number) => buildRoster(fixture.summary, fixture.analysis, ours, t).flatMap((g) => g.rows).find((r) => r.key === dead.key)!
    expect(at(deadAt).dead).toBe(true)
    expect(at(fixture.analysis.timeline.start).dead).toBe(false)
  })

  it('fails loudly instead of falling back to another pilot when a state has no sample', () => {
    const none = { summary: fixture.summary, analysis: { ...fixture.analysis, entities: {}, sideOverrides: [] } }
    expect(() => rosterSamples(none, ours)).toThrow(/no .* sample/)
  })
})
