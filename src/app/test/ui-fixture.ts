import type { BattleSummary } from '@/core/contract'
import summary from '../../../fixtures/real/j125990-20250622/ui/summary.json'
import recorded from '../../../fixtures/real/j125990-20250622/ui/analysis.json'
import { createUiFixture, type RecordedUiAnalysis } from '../gallery/fixture-data'

const fixture = createUiFixture(summary as BattleSummary, recorded as unknown as RecordedUiAnalysis)

export const uiReplayStart = fixture.replayStart
export const loadUiFixture = fixture.loadUiFixture
