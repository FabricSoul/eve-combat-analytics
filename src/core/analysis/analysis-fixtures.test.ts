import { realBattleState, realBattleStateWithBr } from '../../../fixtures/real/j125990-20250622/load'
import { expect, it } from 'vitest'
import { battle, hit, log, other } from '../../../fixtures/states/analysis'
import type { BattleState } from '../contract'
import { itemTypeId } from '../data/item-types'
import shipTypes from '../data/ship-types.json'
import { analyze } from './analyze'
import { statsForRange } from './range'

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
  const logistics = stats.filter(({ key, repairOut }) => entities[key]?.hasLog && repairOut > 0)
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

it('corrects only Lucinda HIly in the owner-generated J125990 battle report', () => {
  const state = realBattleStateWithBr()
  const result = analyze(state)
  const lucinda = 2117427381
  expect(state.logs.find(({ charId }) => charId === lucinda)?.side).toBe(0)
  expect(result.entities[`char:${lucinda}`]).toMatchObject({ side: 1, sideSource: 'log' })
  expect(result.sideOverrides).toEqual([
    expect.objectContaining({ subject: `char:${lucinda}`, side: 1, source: 'log' }),
  ])
  const otherUploaders = state.logs.filter(({ charId }) => charId !== lucinda)
  for (const { charId, side } of otherUploaders) expect(result.entities[`char:${charId}`]?.side).toBe(side)
  expect([...new Set(otherUploaders.filter(({ side }) => side >= 0).map(({ side }) => side))]).toEqual([1])
  console.info('J125990 log side corrections', result.sideOverrides)
}, 60_000)

it('reports observed SH4RK B4IT stats and preserves the uploader baseline in J125990', () => {
  const state = realBattleStateWithBr()
  const { start, end } = state.meta.windows[0]!
  const analysis = analyze(state)
  const observed = analysis.stats.find(({ key }) => key === 'char:1450582275')
  expect(observed?.source).toBe('observed')
  expect(observed!.damageOut).toBeGreaterThanOrEqual(2_090)
  expect(observed!.damageIn).toBeGreaterThan(0)
  const stats = statsForRange(analysis, state.meta.killmails, start, end)
  expect(stats.find(({ key }) => key === 'char:1450582275')).toEqual(observed)
  expect(stats.find(({ key }) => key === 'char:2121605780')).toEqual({
    // Blanchard2213 measured at af8475d, before adding observed stats.
    key: 'char:2121605780', source: 'own', activeRatio: 0.3595505617977528,
    damageOut: 442358, damageIn: 226211, repairOut: 179005, repairIn: 158662,
    neutOut: 0, neutIn: 27671, primaryShare: 0.6207641774309496, switchDelayMedian: 6,
    switchAfterKillMedian: 9, repReactionMedian: 6.5, firstShotDelay: 97, misses: 184,
    hitQuality: { Hits: 1175, 'Glances Off': 225, Grazes: 183, Penetrates: 444, Wrecks: 23, Smashes: 346 },
    pointSeconds: 42, killmailDamage: 278129, killmailCount: 24,
  })
}, 60_000)

it('keeps equipment out of entity ship types and does not resolve the rocket to a real pilot in J125990', () => {
  const state = realBattleStateWithBr()
  expect(state.names.Rocket?.charId).toBe(245637611)
  const analysis = analyze(state)
  const shipIds = new Set(shipTypes.map(({ id }) => id))
  const equipment = [...new Set(Object.values(analysis.entities).flatMap(({ shipTypes }) => shipTypes))].filter((name) => {
    const id = itemTypeId(name)
    return id !== null && !shipIds.has(id)
  })
  expect(equipment).toEqual([])
  expect(analysis.entities['char:245637611']).toBeUndefined()
  expect(analysis.interactions).toEqual(expect.arrayContaining([
    expect.objectContaining({ to: 'name:Rocket[NVACA](Caldari Navy Mjolnir Rocket)', weapon: 'Dread Guristas Large Graviton Smartbomb' }),
  ]))
}, 60_000)

it('rechecks equipment hulls in stored parsed logs before assigning a character', () => {
  const raw = 'Rocket[NVACA](Caldari Navy Mjolnir Rocket)'
  const state = battle([log(1, 'Ace', 0, [hit(0, other('Rocket', 'Caldari Navy Mjolnir Rocket', raw), 90)])])
  state.names = { ...state.names, Rocket: { charId: 245637611, side: 1 } }
  const analysis = analyze(state)
  expect(analysis.entities['char:245637611']).toBeUndefined()
  expect(analysis.entities[`name:${raw}`]).toMatchObject({ charId: null, shipTypes: [] })
})

it.skipIf(!process.env.PERF)('analyzes 90,000 events in under 500 ms (PERF=1)', { retry: 3 }, () => {
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
