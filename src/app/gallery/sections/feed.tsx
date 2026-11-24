import { useEffect, type ReactNode } from 'react'
import { EventFeed } from '../../battle/EventFeed'
import { defaultOursSide } from '../../lib/sides'
import { ViewProvider, useView, type FeedMode } from '../../state/view-store'
import { useGalleryFixture } from '../fixture-assets'

function Mode({ mode }: { mode: FeedMode }) {
  const { setFeedMode } = useView()
  useEffect(() => setFeedMode(mode), [])
  return null
}

function Box({ label, width, mode, compact }: { label: ReactNode; width: number; mode: FeedMode; compact?: boolean }) {
  const { loadUiFixture, replayStart } = useGalleryFixture()
  const ours = defaultOursSide(loadUiFixture().summary)
  // The board shows the 10 seconds ending at 15:43:02 in J125990.
  const at = replayStart + 92_999
  return (
    <div>
      <p className="app-token-usage">{label}</p>
      <div style={{ width, height: 560, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-hair)' }}>
        <ViewProvider syncUrl={false} initialTime={at} endTime={at + 60_000} defaultSide={ours}>
          <Mode mode={mode} />
          <EventFeed compact={compact} />
        </ViewProvider>
      </div>
    </div>
  )
}

function FeedSection() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'start' }}>
      <Box label="逐条（默认）" width={460} mode="raw" />
      <Box label="合并同类（最后时间 · 总量 ×次数）" width={460} mode="merged" />
      <Box label="只看关键" width={460} mode="key" />
      <Box label="窄栏（≤ 400）：时间分隔行代替时间列" width={300} mode="raw" />
    </div>
  )
}

export default { title: '事件流', order: 12, Component: FeedSection }
