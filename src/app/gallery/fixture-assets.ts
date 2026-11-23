import { createContext, useContext } from 'react'
import type { BattleSummary } from '@/core/contract'
import summaryUrl from '../../../fixtures/real/j125990-20250622/ui/summary.json?url'
import analysisUrl from '../../../fixtures/real/j125990-20250622/ui/analysis.json?url'
import { createUiFixture, type RecordedUiAnalysis, type UiFixtureSource } from './fixture-data'

export const GalleryFixtureContext = createContext<UiFixtureSource | null>(null)

export function useGalleryFixture(): UiFixtureSource {
  const fixture = useContext(GalleryFixtureContext)
  if (!fixture) throw new Error('Gallery examples require a fixture')
  return fixture
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Gallery fixture request failed (${response.status})`)
  return response.json() as Promise<T>
}

export async function fetchGalleryFixture(signal: AbortSignal): Promise<UiFixtureSource> {
  const [summary, analysis] = await Promise.all([
    readJson<BattleSummary>(summaryUrl, signal),
    readJson<RecordedUiAnalysis>(analysisUrl, signal),
  ])
  return createUiFixture(summary, analysis)
}
