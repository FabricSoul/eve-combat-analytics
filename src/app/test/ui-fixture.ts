import type { Analysis, BattleSummary } from '@/core/contract'
import summary from '../../../fixtures/real/j125990-20250622/ui/summary.json'
import analysis from '../../../fixtures/real/j125990-20250622/ui/analysis.json'

export function loadUiFixture(): { summary: BattleSummary; analysis: Analysis } {
  // The checked-in data is serialized by scripts/build-ui-fixture.ts from the shared contract.
  return { summary: summary as BattleSummary, analysis: analysis as Analysis }
}
