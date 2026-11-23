import { beforeAll, describe, expect, it } from 'vitest'
import { realBattleStateWithBr } from '../../../../fixtures/real/j125990-20250622/load'
import { analyze } from '@/core/analysis/analyze'
import { sideOrder } from '@/app/lib/sides'
import { buildScene, makeLayout } from './scene'
import { makePresence, recentEngagement } from './presence'

const ours = 1
const times = ['15:43:02', '15:54:00', '16:15:00']
const at = (time: string) => Date.parse(`2025-06-22T${time}Z`)
let scene: ReturnType<typeof buildScene>
let order: number[]

beforeAll(() => {
  const state = realBattleStateWithBr()
  const analysis = analyze(state)
  order = sideOrder(analysis, ours)
  scene = buildScene(analysis, state.meta.killmails, order)
})

describe('replay presence in the complete J125990 fight', () => {
  it('shows 30–60 ships at 15:43:02 UTC', () => {
    const counts = times.map((time) => [time, scene.visibleAt(at(time), null).size])
    console.log('Full replay visible ships (UTC):', JSON.stringify(counts))
    const visible = scene.visibleAt(at(times[0]!), null)
    expect(visible.size).toBeGreaterThanOrEqual(30)
    expect(visible.size).toBeLessThanOrEqual(60)
  })

  it('shows an opposing ship from five seconds before its first interaction until sixty seconds after its last', () => {
    const pilot = scene.pilots.find(({ entity, deaths }) =>
      entity.side >= 0 && entity.side !== ours && deaths.length === 0
      && scene.edges.some(({ from, to }) => from === entity.key || to === entity.key))!
    const { key } = pilot.entity
    const events = scene.edges.filter(({ from, to }) => from === key || to === key)
    const entry = events[0]!.t - 5000
    const exit = events.at(-1)!.t + 60_000
    expect(scene.visibleAt(entry - 1, null).has(key)).toBe(false)
    expect(scene.visibleAt(entry, null).has(key)).toBe(true)
    expect(scene.visibleAt(exit, null).has(key)).toBe(true)
    expect(scene.visibleAt(exit + 1, null).has(key)).toBe(false)
    expect(scene.visibleAt(exit + 1, key).has(key)).toBe(true)
  })

  it('retains a living friendly uploader and keeps a killed pilot for thirty seconds', () => {
    const uploader = scene.pilots.find(({ entity, deaths }) => entity.side === ours && entity.hasLog && !deaths.length)!
    expect(scene.visibleAt(scene.edges.at(-1)!.t + 60_001, null).has(uploader.entity.key)).toBe(true)
    const victim = scene.pilots.find(({ entity, deaths }) => entity.side !== ours && deaths.length === 1)!
    const kill = victim.deaths[0]!.t
    expect(scene.visibleAt(kill, null).has(victim.entity.key)).toBe(true)
    expect(scene.visibleAt(kill + 29_999, null).has(victim.entity.key)).toBe(true)
    expect(scene.visibleAt(kill + 30_000, null).has(victim.entity.key)).toBe(false)
    expect(scene.visibleAt(kill + 30_000, victim.entity.key).has(victim.entity.key)).toBe(true)
  })

  it('keeps the positions of ships that persist through a membership change', () => {
    const layout = makeLayout(scene.pilots, order, 660, 580)
    const first = scene.visibleAt(at('15:43:02'), null)
    const later = scene.visibleAt(at('15:44:02'), null)
    const persistent = [...first].find((key) => later.has(key) && layout.byKey.get(key)?.entity.side !== -1)!
    const node = layout.byKey.get(persistent)!
    layout.setVisible(first)
    layout.tick(75)
    const position = { x: node.x, y: node.y }
    expect(layout.setVisible(later)).toBe(true)
    expect({ x: node.x, y: node.y }).toEqual(position)
    expect(layout.setVisible(later)).toBe(false)
  })
})

it('includes every endpoint of the full fight’s last ten seconds in the replay frame', () => {
  const t = at('15:43:02')
  const visible = scene.visibleAt(t, null)
  const endpoints = new Set(scene.edges
    .filter((edge) => t - 10_000 <= edge.t && edge.t <= t)
    .flatMap(({ from, to }) => [from, to]))
  expect(endpoints.size).toBeGreaterThan(0)
  const missing = [...endpoints].filter((key) => !visible.has(key))
    .map((key) => {
      const pilot = scene.pilots.find(({ entity }) => entity.key === key)
      return { key, name: pilot?.entity.name, deaths: pilot?.deaths.map(({ t }) => new Date(t).toISOString()) }
    })
  expect(missing).toEqual([])
})


it('gives names to opponents engaged at the real cursor time', () => {
  const active = scene.recentOpponents(recentEngagement(scene.edges, at('15:43:02')))
  const names = scene.pilots.filter(({ entity }) => active.has(entity.key)).map(({ entity }) => entity.name)
  expect(names).toEqual(expect.arrayContaining(['Beatris Dallocort', 'Peter Moonlight', 'Andrei Deat', 'Kohera Hakomairos']))
})

it('keeps an observed endpoint after an older loss without retaining the expired loss by itself', () => {
  const victim = scene.pilots.find(({ deaths }) => deaths.length === 1)!
  const event = { ...scene.edges[0]!, to: victim.entity.key, t: victim.deaths[0]!.t + 31_000 }
  const visibleAt = makePresence([victim], [event], ours)
  expect(visibleAt(event.t - 1, null).has(victim.entity.key)).toBe(false)
  expect(visibleAt(event.t, null).has(victim.entity.key)).toBe(true)
  expect(visibleAt(event.t + 10_001, null).has(victim.entity.key)).toBe(false)
})
