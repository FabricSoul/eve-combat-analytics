import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { realBattleStateWithBr } from '../../../fixtures/real/j125990-20250622/load'
import { analyze } from './analyze'
import { ANALYZER_VERSION } from './version'

// Keep prior entries when bumping the analyzer version.
const fingerprints: Partial<Record<number, string>> = {
  1: '3a554302df5716a15d382ca3d2ef78de1e1f865f2f92af52572c75a0a6fe0031',
  // Version 2 refreshes persisted affiliation inputs. The battle-time fixture already has those inputs.
  2: '3a554302df5716a15d382ca3d2ef78de1e1f865f2f92af52572c75a0a6fe0031',
}

it('matches the J125990 analysis fingerprint for the declared analyzer version', () => {
  const analysis = analyze(realBattleStateWithBr())
  const digest = createHash('sha256').update(JSON.stringify(analysis)).digest('hex')
  expect(digest, 'Bump ANALYZER_VERSION and record the new fingerprint if this analysis change is intentional')
    .toBe(fingerprints[ANALYZER_VERSION])
  // The uploaders' side is index 1 in the owner-generated BR.
  expect(analysis.coverage.find(({ side }) => side === 1)?.known).toBe(41)
}, 60_000)
