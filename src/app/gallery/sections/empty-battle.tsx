import type { ReactNode } from 'react'
import { EmptyBattle } from '../../battle/EmptyBattle'
import { BattleProvider } from '../../state/battle-store'
import { useGalleryFixture } from '../fixture-assets'

function EmptyBattleSection(): ReactNode {
  const fixture = useGalleryFixture().loadUiFixture()
  return (
    <div style={{ position: 'relative', height: 520, border: '1px solid var(--color-hair)', overflow: 'hidden' }}>
      <BattleProvider static={{ ...fixture, summary: { ...fixture.summary, logs: [] } }}>
        <EmptyBattle onUpload={() => undefined} />
      </BattleProvider>
    </div>
  )
}

export default { title: '空战斗', order: 82, Component: EmptyBattleSection }
