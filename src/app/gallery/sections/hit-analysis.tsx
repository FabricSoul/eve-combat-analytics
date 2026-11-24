import { HitAnalysis } from '../../battle/HitAnalysis'
import { BattleProvider } from '../../state/battle-store'
import type { GallerySection } from '../GalleryPage'
import { useGalleryFixture } from '../fixture-assets'

function HitAnalysisGallery() {
  const battle = useGalleryFixture().loadUiFixture({ fullPilotEvents: true })
  return <BattleProvider static={battle}><HitAnalysis /></BattleProvider>
}

export default { title: '命中分析', order: 35, Component: HitAnalysisGallery } satisfies GallerySection
