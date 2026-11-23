import { realBattleState } from '../../../fixtures/real/j125990-20250622/load'
import { expect, it } from 'vitest'
import { battle, hit, log, other } from '../../../fixtures/states/analysis'
import type { BattleState } from '../contract'
import { analyze } from './analyze'

function report(state: BattleState, input: string) {
  const start = performance.now()
  const { entities, interactions, stats } = analyze(state)
  const analysisMs = Math.round(performance.now() - start)
  let events = 0
  let unresolved = 0
  let corroborated = 0
  for (const { from, to, sources, corroborated: confirmed } of interactions) {
    events += sources.length
    if (!from.startsWith('char:') || !to.startsWith('char:')) unresolved += sources.length
    if (confirmed) corroborated++
  }
  const logistics = stats.filter(({ repairOut }) => repairOut > 0)
  const withReaction = logistics.filter(({ repReactionMedian }) => repReactionMedian !== null).length
  const loggedPilots = stats.filter(({ key }) => entities[key]?.hasLog)
  const withSwitchAfterKill = loggedPilots.filter(({ switchAfterKillMedian }) => switchAfterKillMedian !== null).length
  const unresolvedShare = unresolved / events
  console.info('Real PvP analysis', {
    input, events, unresolved, unresolvedShare, interactions: interactions.length, corroborated,
    logistics: logistics.length, withReaction, loggedPilots: loggedPilots.length, withSwitchAfterKill, analysisMs,
  })
  expect(unresolvedShare).toBeGreaterThanOrEqual(0)
  expect(unresolvedShare).toBeLessThanOrEqual(1)
  expect(corroborated).toBeGreaterThanOrEqual(0)
  expect(withReaction).toBeLessThanOrEqual(logistics.length)
  return { unresolvedShare, corroborated, withReaction, logistics: logistics.length, loggedPilots: loggedPilots.length, withSwitchAfterKill }
}

it('identity coverage on the real J125990 fight (fixtures/real/j125990-20250622)', () => {
  const r = report(realBattleState(), 'committed real fixture')
  // Measured 2026-11-22 after F2 + F3: 6.20% unresolved, 6,659 corroborated, 13 of 13 logistics with reaction times.
  expect(r.unresolvedShare).toBeLessThan(0.07)
  expect(r.corroborated).toBeGreaterThanOrEqual(6_500)
  expect(r.withReaction).toBe(r.logistics)
  expect(r.loggedPilots).toBe(17)
  expect(r.withSwitchAfterKill).toBeGreaterThanOrEqual(12)
}, 60_000)

it('analyzes 90,000 events in under 500 ms', { retry: 3 }, () => {
  const state = battle([])
  state.names = {}
  for (let i = 0; i < 30; i++) {
    const charId = 100 + i
    const name = `Pilot ${i}`
    state.names[name] = { charId, side: i % 2 }
    const opponentType = 1_000 + (i ^ 1)
    const opponent = other(`Pilot ${i ^ 1}`, 'Cruiser', undefined, opponentType)
    const anonymousOpponent = other(null, 'Cruiser', 'Cruiser', opponentType)
    const thirdPilot = (i + 3) % 30
    const thirdParty = other(`Pilot ${thirdPilot}`, 'Frigate', undefined, 1_000 + thirdPilot)
    const events = Array.from({ length: 3_000 }, (_, line) => {
      const t = Math.floor(line / 4)
      const dir = line % 2 === 0 ? 'out' : 'in'
      const target = line % 4 < 2 ? (t % 2 === 0 ? opponent : anonymousOpponent) : thirdParty
      return hit(t, target, 100 + (line % 4 < 2 ? t % 8 : i), { dir, weapon: line % 3 ? 'Laser' : null })
    })
    state.logs.push(log(charId, name, i % 2, events))
  }
  const start = performance.now()
  const analysis = analyze(state)
  const elapsed = performance.now() - start
  console.info(`Analysis of 90,000 events: ${elapsed.toFixed(1)} ms`)
  expect(analysis.interactions).toHaveLength(67_500)
  expect(elapsed).toBeLessThan(500)
})
