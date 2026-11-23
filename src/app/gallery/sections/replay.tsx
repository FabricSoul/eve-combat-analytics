import { useMemo, useState } from 'react'
import type { Analysis } from '@/core/contract'
import { ReplayCanvas } from '@/app/battle/ReplayCanvas'
import { fmtHms } from '@/app/lib/format'
import { defaultOursSide } from '@/app/lib/sides'
import { BattleProvider } from '@/app/state/battle-store'
import { usePlayback, useView, ViewProvider } from '@/app/state/view-store'
import { loadUiFixture, uiReplayStart } from '@/app/test/ui-fixture'
import { Button } from '@/app/ui/Button'
import type { GallerySection } from '../GalleryPage'

const fixture = loadUiFixture()
const { analysis, summary } = fixture
const start = uiReplayStart
// The board opens at 92 s and animates its opening tracers. Pause partway through them here.
const boardTime = start + 92_420
const end = analysis.interactions.at(-1)?.t ?? start
const oursSide = defaultOursSide(summary)

function extraSides(sideCount: number): Analysis {
  // Gallery example only: split real opponent entities into extra sides.
  // The pilots, combat timings and amounts still come from the real fixture.
  if (sideCount === 2) return analysis
  const originalOpponent = analysis.coverage.find(({ side }) => side !== oursSide)?.side
  let index = 0
  const entities = { ...analysis.entities }
  const opponents = Object.values(entities).filter(({ side }) => side === originalOpponent)
  const active = new Set(analysis.interactions.flatMap(({ from, to }) => [from, to]))
  const counts = new Map<number, number>()
  for (const entity of opponents.sort((a, b) => Number(active.has(b.key)) - Number(active.has(a.key)))) {
    const bucket = index++ % (sideCount - 1)
    const side = bucket === 0 ? entity.side : bucket + 1
    counts.set(side, (counts.get(side) ?? 0) + 1)
    entities[entity.key] = { ...entity, side }
  }
  const coverage = [
    ...analysis.coverage.filter(({ side }) => side !== originalOpponent),
    ...Array.from(counts, ([side, known]) => ({ side, known, withLog: 0 })),
  ]
  return { ...analysis, entities, coverage }
}

const samples = [
  { label: '交火', t: boardTime, offset: 0 },
  { label: '伤害', t: analysis.interactions.find(({ t, kind }) => t >= boardTime && kind === 'damage')?.t, offset: 460 },
  { label: '维修', t: analysis.interactions.find(({ t, kind }) => t >= boardTime && kind === 'repair')?.t, offset: 460 },
  { label: '点人 / 扰频', t: analysis.ewarSpans.find(({ ewar }) => ewar === 'warp_disrupt' || ewar === 'warp_scramble')?.start, offset: 100 },
  { label: '能量中和', t: analysis.interactions.find(({ kind }) => kind === 'neut')?.t, offset: 460 },
  { label: '击毁', t: summary.meta.killmails.find(({ t, victim }) => (
    t >= start && t <= end && victim.charId !== null && analysis.interactions.some(({ from, to }) => (
      from === `char:${victim.charId}` || to === `char:${victim.charId}`
    ))
  ))?.t, offset: 100 },
]

function ReplaySamples() {
  const [sideCount, setSideCount] = useState(2)
  const [compact, setCompact] = useState(false)
  const { play, pause, seek, setSpeed, speed, selected, focusOnly, setFocusOnly } = useView()
  const { t, playing } = usePlayback('coarse')
  const data = useMemo(() => ({ summary, analysis: extraSides(sideCount) }), [sideCount])
  return (
    <>
      <div className="replay-gallery-controls">
        <Button variant="primary" onClick={playing ? pause : play}>{playing ? '暂停' : '播放'}</Button>
        <Button onClick={() => setSpeed(speed === 4 ? 1 : 4)}>{speed}×</Button>
        <time className="replay-number">{fmtHms(t)}</time>
        <select className="app-select" aria-label="跳到交互示例" value=""
          onChange={(event) => { pause(); seek(Number(event.target.value)) }}>
          <option value="" disabled>交互示例</option>
          {samples.map(({ label, t: sampleTime, offset }) => sampleTime !== undefined && (
            <option key={label} value={sampleTime + offset}>{label}</option>
          ))}
        </select>
        <select className="app-select" aria-label="阵营示例" value={sideCount}
          onChange={(event) => setSideCount(Number(event.target.value))}>
          <option value={2}>两方</option>
          <option value={3}>三方（示例）</option>
          <option value={4}>四方（示例）</option>
        </select>
        <Button aria-pressed={compact} onClick={() => setCompact(!compact)}>紧凑画布</Button>
        {selected && <Button aria-pressed={focusOnly} onClick={() => setFocusOnly(!focusOnly)}>只看选中人员</Button>}
      </div>
      <div className="replay-gallery-preview" data-compact={compact}>
        <BattleProvider static={data}><ReplayCanvas /></BattleProvider>
      </div>
    </>
  )
}

function ReplayGallery() {
  return (
    <ViewProvider initialTime={boardTime} endTime={end} defaultSide={oursSide} syncUrl={false}>
      <ReplaySamples />
    </ViewProvider>
  )
}

export default { title: '回放画布', order: 40, Component: ReplayGallery } satisfies GallerySection
