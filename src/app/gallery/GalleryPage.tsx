import { useEffect, useState, type ComponentType } from 'react'
import { defaultOursSide } from '../lib/sides'
import { AppShell } from '../shell/AppShell'
import { BattleProvider } from '../state/battle-store'
import { ViewProvider } from '../state/view-store'
import { Button } from '../ui/Button'
import { fetchGalleryFixture, GalleryFixtureContext } from './fixture-assets'
import type { UiFixtureSource } from './fixture-data'
import { TokensPage } from './TokensPage'

export interface GallerySection {
  title: string
  order: number
  Component: ComponentType
}

const sections = Object.entries(import.meta.glob<GallerySection>('./sections/*.tsx', { eager: true, import: 'default' }))
  .map(([path, section]) => ({ ...section, id: path.slice('./sections/'.length, -'.tsx'.length) }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

function GalleryExamples({ source }: { source: UiFixtureSource }) {
  const fixture = source.loadUiFixture()
  const { analysis, summary } = fixture
  const bucketCount = Math.max(0, ...Object.values(analysis.timeline.damageBySide).map((buckets) => buckets.length))
  const end = analysis.timeline.start + Math.max(0, bucketCount - 1) * 1000
  const ours = defaultOursSide(summary)
  return (
    <GalleryFixtureContext.Provider value={source}>
      <BattleProvider static={fixture}>
        {sections.map(({ id, title, Component }) => (
          <section className="app-gallery-section" key={id} id={id} aria-labelledby={`${id}-heading`}>
            <h2 id={`${id}-heading`}>{title}</h2>
            <ViewProvider initialTime={source.replayStart} endTime={end} defaultSide={ours} syncUrl={false}>
              <Component />
            </ViewProvider>
          </section>
        ))}
      </BattleProvider>
    </GalleryFixtureContext.Provider>
  )
}

export default function GalleryPage() {
  const [source, setSource] = useState<UiFixtureSource | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void fetchGalleryFixture(controller.signal).then(
      (fixture) => { if (!controller.signal.aborted) setSource(fixture) },
      () => { if (!controller.signal.aborted) setSource('error') },
    )
    return () => controller.abort()
  }, [attempt])

  return (
    <AppShell>
      <div className="app-gallery">
        {sections.length > 0 && (
          <nav className="app-gallery-nav" aria-label="组件画廊">
            <a href="#tokens">基础值</a>
            {sections.map(({ id, title }) => <a key={id} href={`#${id}`}>{title}</a>)}
          </nav>
        )}
        <TokensPage />
        {source === null && <p role="status">正在加载示例数据…</p>}
        {source === 'error' && <p role="alert">无法加载示例数据。 <Button onClick={() => {
          setSource(null)
          setAttempt((previous) => previous + 1)
        }}>重试</Button></p>}
        {source && source !== 'error' && <GalleryExamples source={source} />}
      </div>
    </AppShell>
  )
}
