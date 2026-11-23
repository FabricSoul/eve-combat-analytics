import type { ComponentType } from 'react'
import { defaultOursSide } from '../lib/sides'
import { AppShell } from '../shell/AppShell'
import { BattleProvider } from '../state/battle-store'
import { ViewProvider } from '../state/view-store'
import { loadUiFixture, uiReplayStart } from '../test/ui-fixture'
import { TokensPage } from './TokensPage'

export interface GallerySection {
  title: string
  order: number
  Component: ComponentType
}

const sections = Object.entries(import.meta.glob<GallerySection>('./sections/*.tsx', { eager: true, import: 'default' }))
  .map(([path, section]) => ({ ...section, id: path.slice('./sections/'.length, -'.tsx'.length) }))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export default function GalleryPage() {
  const fixture = loadUiFixture()
  const { analysis, summary } = fixture
  const time = uiReplayStart
  const bucketCount = Math.max(0, ...Object.values(analysis.timeline.damageBySide).map((buckets) => buckets.length))
  const end = analysis.timeline.start + Math.max(0, bucketCount - 1) * 1000

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
        <BattleProvider static={fixture}>
          {sections.map(({ id, title, Component }) => (
            <section className="app-gallery-section" key={id} id={id} aria-labelledby={`${id}-heading`}>
              <h2 id={`${id}-heading`}>{title}</h2>
              <ViewProvider initialTime={time} endTime={end} defaultSide={defaultOursSide(summary)} syncUrl={false}>
                <Component />
              </ViewProvider>
            </section>
          ))}
        </BattleProvider>
      </div>
    </AppShell>
  )
}
