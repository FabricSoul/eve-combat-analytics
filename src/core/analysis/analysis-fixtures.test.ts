import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { battle, hit, log, other } from '../../../fixtures/states/analysis'
import type { BattleState } from '../contract'
import { analyze } from './analyze'

const fixtureName = 'real-20250622'
const fixtureRoot = ['fixtures/local', '../revive/fixtures/local'].find(
  (root) => existsSync(join(root, `${fixtureName}.state.json`)),
)

function report(state: BattleState, input: string) {
  const start = performance.now()
  const { interactions, stats } = analyze(state)
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
  const unresolvedShare = unresolved / events
  console.info('Local PvP analysis', {
    input, events, unresolved, unresolvedShare, interactions: interactions.length, corroborated,
    logistics: logistics.length, withReaction, analysisMs,
  })
  expect(unresolvedShare).toBeGreaterThanOrEqual(0)
  expect(unresolvedShare).toBeLessThanOrEqual(1)
  expect(corroborated).toBeGreaterThanOrEqual(0)
  expect(withReaction).toBeLessThanOrEqual(logistics.length)
}

it.skipIf(!fixtureRoot)('reports identity coverage on the local PvP fixture', async () => {
  const root = fixtureRoot!
  const state = JSON.parse(readFileSync(join(root, `${fixtureName}.state.json`), 'utf8')) as BattleState
  report(state, 'stored state')

  // Opt in to raw reparsing to compare parser revisions outside the unit-test timing gate.
  if (process.env.EVE_REPARSE_REAL_LOGS !== '1') return
  const rawPaths = state.logs.map(({ id }) => join(root, fixtureName, id))
  if (!rawPaths.every(existsSync)) return
  const { parseGamelog } = await import('../log/parse')
  const logs = state.logs.map((log, i) => {
    const parsed = parseGamelog(readFileSync(rawPaths[i]!, 'utf8'))
    const events = parsed.events.filter(({ t }) => state.meta.windows.some(({ start, end }) => t >= start && t <= end))
    return { ...log, parsed: { ...parsed, events } }
  })
  report({ ...state, logs }, 'reparsed with current parser')
}, 30_000)

it('analyzes 90,000 events in under 500 ms', () => {
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
