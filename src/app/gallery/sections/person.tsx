import { useEffect } from 'react'
import { PersonDrawer } from '../../battle/PersonDrawer'
import { BattleProvider } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import { Button } from '../../ui/Button'
import './u7-gallery.css'
import type { GallerySection } from '../GalleryPage'
import { loadUiFixture } from '../../test/ui-fixture'

const data = loadUiFixture({ fullPilotEvents: true })

function PersonGallery() {
  const { select, selected } = useView()
  const pilot = Object.values(data.analysis.entities).find(({ name }) => name === 'MoQingXL moqing')
  useEffect(() => { if (pilot) select(pilot.key) }, [pilot])
  return <div className="u7-gallery-drawer"><BattleProvider static={data}>
    {selected ? <PersonDrawer /> : <Button onClick={() => { if (pilot) select(pilot.key) }}>打开个人详情</Button>}
  </BattleProvider></div>
}

export default { title: '个人抽屉', order: 50, Component: PersonGallery } satisfies GallerySection
