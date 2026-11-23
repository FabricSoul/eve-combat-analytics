// The event feed on the FULL real fight (17 logs, 52 killmails), not the clipped gallery snapshot.
import { beforeAll, describe, expect, it } from 'vitest'
import { analyze } from '@/core/analysis/analyze'
import type { Analysis, BattleSummary, Interaction } from '@/core/contract'
import { realBattleStateWithBr } from '../../../../fixtures/real/j125990-20250622/load'
import { buildFeed, windowMs } from './model'

let analysis: Analysis
let summary: BattleSummary
let dense: number
let late: number

beforeAll(() => {
  const state = realBattleStateWithBr()
  analysis = analyze(state)
  summary = { meta: state.meta, logs: [], fits: [], names: state.names, sideOverrides: [], analysisVersion: 1 }
  // Densest 10 s window by event count, found with a two-pointer sweep.
  const { interactions } = analysis
  let best = 0
  let lo = 0
  for (let hi = 0; hi < interactions.length; hi++) {
    while (interactions[lo]!.t <= interactions[hi]!.t - windowMs) lo++
    if (hi - lo > best) { best = hi - lo; dense = interactions[hi]!.t }
  }
  late = interactions.at(-1)!.t - 30_000
}, 120_000)

const mergeable = (i: Interaction) => i.kind !== 'miss'

describe('feed on the full real fight', () => {
  it('has the size the review measured', () => {
    expect(analysis.interactions.length).toBeGreaterThan(50_000)
  })

  it('merged mode in the densest window: counts and totals equal an independent grouping of the 10 s slice', () => {
    const slice = analysis.interactions.filter((i) => i.t <= dense && i.t > dense - windowMs && mergeable(i))
    expect(slice.length).toBeGreaterThan(200)
    const expected = new Map<string, { count: number; total: number; lastT: number }>()
    for (const i of slice) {
      const key = `${i.from}-${i.to}-${i.kind === 'nos' ? 'nos' : i.kind}`
      const group = expected.get(key) ?? { count: 0, total: 0, lastT: 0 }
      group.count++
      group.total += i.amount
      group.lastT = i.t
      expected.set(key, group)
    }
    const rows = buildFeed({ analysis, summary, mode: 'merged', t: dense, oursSide: 0 })
    expect(rows).toHaveLength(16)
    expect(expected.size).toBeGreaterThan(16)
    for (const row of rows) {
      expect(expected.get(row.id), row.id).toMatchObject({ count: row.count, total: row.total, lastT: row.lastT })
    }
    // newest first, and merged rows stand for more events than raw would show
    expect(rows.map((r) => r.lastT)).toEqual([...rows.map((r) => r.lastT)].sort((a, b) => b - a))
    expect(rows.reduce((n, r) => n + r.count, 0)).toBeGreaterThan(16)
    const [top] = [...expected.entries()].sort((a, b) => b[1].lastT - a[1].lastT || b[1].total - a[1].total)
    expect(rows[0]?.id).toBe(top![0])
  })

  it('key mode equals the unoptimised definition: kills, our switches and the top 1% of hits, newest 14', () => {
    const damages = analysis.interactions.filter((i) => i.kind === 'damage').map((i) => i.amount).sort((a, b) => b - a)
    const threshold = damages[Math.max(1, Math.ceil(damages.length * 0.01)) - 1]!
    for (const t of [dense, late, analysis.interactions.at(-1)!.t]) {
      const expected = [
        ...summary.meta.killmails.filter((k) => k.t <= t).map((k) => ({ id: `kill-${k.id}`, t: k.t })),
        ...analysis.primaries.filter((p) => p.bySide === 0 && p.start <= t).map((p) => ({ id: `primary-${p.start}-${p.target}`, t: p.start })),
        ...analysis.interactions.filter((i) => i.t <= t && i.kind === 'damage' && i.amount >= threshold).map((i) => ({ id: `big-${i.t}-${i.from}-${i.to}`, t: i.t })),
      ].sort((a, b) => b.t - a.t).slice(0, 14)
      const rows = buildFeed({ analysis, summary, mode: 'key', t, oursSide: 0 })
      expect(rows.map((r) => r.lastT)).toEqual(expected.map((e) => e.t))
    }
  })

  it('returns the same rows while the cursor stays inside the same event boundaries', () => {
    const { interactions } = analysis
    // A cursor where moving 1 ms changes neither end of the 10 s slice: no event at t+1 and none leaving the window.
    let k = interactions.findIndex((i) => i.t > dense)
    while (interactions[k + 1]!.t <= interactions[k]!.t + 1 || interactions.some((i) => i.t === interactions[k]!.t - windowMs + 1)) k++
    const at = interactions[k]!.t
    const a = buildFeed({ analysis, summary, mode: 'merged', t: at, oursSide: 0 })
    expect(buildFeed({ analysis, summary, mode: 'merged', t: at, oursSide: 0 })).toBe(a)
    expect(buildFeed({ analysis, summary, mode: 'merged', t: at + 1, oursSide: 0 })).toBe(a)
  })
})

function timed(run: (t: number) => unknown, from: number, steps = 100) {
  const samples: number[] = []
  for (let n = 0; n < steps; n++) {
    const start = performance.now()
    run(from + n * 100)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { median: samples[Math.floor(samples.length / 2)]!, p95: samples[Math.floor(samples.length * 0.95)]! }
}

describe.skipIf(!process.env.PERF)('feed timing on the full fight (PERF=1)', () => {
  for (const mode of ['key', 'merged', 'raw'] as const) {
    it(`${mode}: 100 consecutive animation-frame cursors near the end, p95 under 2 ms`, { retry: 2 }, () => {
      buildFeed({ analysis, summary, mode, t: late, oursSide: 0 }) // warm: first call builds the per-analysis index
      const { median, p95 } = timed((t) => buildFeed({ analysis, summary, mode, t, oursSide: 0 }), late)
      console.info(`feed ${mode}`, { median, p95 })
      expect(p95).toBeLessThan(2)
    })
  }
})
