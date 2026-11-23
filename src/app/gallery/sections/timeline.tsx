import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Timeline } from '@/app/battle/Timeline'
import { defaultOursSide } from '@/app/lib/sides'
import { BattleProvider } from '@/app/state/battle-store'
import { ViewProvider, useView, type LayerId, type TimeRange } from '@/app/state/view-store'
import { useGalleryFixture } from '../fixture-assets'
import type { GallerySection } from '../GalleryPage'

const cursor = Date.parse('2025-06-22T15:43:02Z')
const expandedLayers: LayerId[] = ['repOurs', 'point', 'killIcons']
const exampleRange: TimeRange = [Date.parse('2025-06-22T15:42:00Z'), Date.parse('2025-06-22T15:46:00Z')]

function ExpandedTimeline() {
  const { toggleLayer, setRange } = useView()
  const initialized = useRef(false)
  useLayoutEffect(() => {
    if (initialized.current) return
    initialized.current = true
    for (const layer of expandedLayers) toggleLayer(layer)
    setRange(exampleRange)
  }, [toggleLayer, setRange])
  return <Timeline />
}

function TimelineExample({ label, children, mobile }: { label: string; children: ReactNode; mobile?: boolean }) {
  const { summary } = useGalleryFixture().loadUiFixture()
  const side = defaultOursSide(summary)
  const end = Math.max(...summary.meta.killmails.map(({ t }) => t))
  return <div className={mobile ? 'max-w-[390px]' : undefined}>
    <h3 className="mb-app-1 text-app-small font-medium text-app-text-2">{label}</h3>
    <ViewProvider initialTime={cursor} endTime={end} defaultSide={side} syncUrl={false}>
      {children}
    </ViewProvider>
  </div>
}

function TimelineGallery() {
  const fixture = useGalleryFixture().loadUiFixture()
  const side = defaultOursSide(fixture.summary)
  // Synthetic example for the third-side design. The extra curve is based on a delayed
  // copy of J125990 damage; it does not represent a third side in that fight.
  const thirdSide = fixture.summary.meta.teams.length
  const example = {
    summary: { ...fixture.summary, meta: { ...fixture.summary.meta, teams: [...fixture.summary.meta.teams, []] } },
    analysis: {
      ...fixture.analysis,
      coverage: [...fixture.analysis.coverage, { side: thirdSide, known: 0, withLog: 0 }],
      timeline: {
        ...fixture.analysis.timeline,
        damageBySide: {
          ...fixture.analysis.timeline.damageBySide,
          [thirdSide]: (fixture.analysis.timeline.damageBySide[side] ?? []).map((_, i, samples) =>
            Math.round((samples[i - 18] ?? 0) * 0.6)),
        },
      },
    },
  }
  return <BattleProvider static={fixture}>
    <div className="grid min-w-0 gap-app-6">
      <TimelineExample label="默认图层"><Timeline /></TimelineExample>
      <TimelineExample label="维修、点人、舰船图标与选段"><ExpandedTimeline /></TimelineExample>
      <TimelineExample label="三方示例（第三方为模拟数据）">
        <BattleProvider static={example}><Timeline /></BattleProvider>
      </TimelineExample>
      <TimelineExample label="手机" mobile><Timeline compact /></TimelineExample>
    </div>
  </BattleProvider>
}

export default { title: '时间轴', order: 40, Component: TimelineGallery } satisfies GallerySection
