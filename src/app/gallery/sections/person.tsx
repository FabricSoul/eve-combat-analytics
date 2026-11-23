import { useEffect, useMemo } from 'react'
import { PersonDrawer } from '../../battle/PersonDrawer'
import { BattleProvider, useBattleContext } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import { Button } from '../../ui/Button'
import './u7-gallery.css'
import type { GallerySection } from '../GalleryPage'
import { fullPilotGalleryData } from './u7-pilot-data'

function PersonGallery() {
  const { analysis, summary } = useBattleContext()
  const data = useMemo(() => analysis && summary ? fullPilotGalleryData({ analysis, summary }) : null, [analysis, summary])
  const { select, selected } = useView()
  const pilot = Object.values(analysis?.entities ?? {}).find(({ name }) => name === 'MoQingXL moqing')
  useEffect(() => { if (pilot) select(pilot.key) }, [pilot])
  if (!data) return null
  return <div className="u7-gallery-drawer"><BattleProvider static={data}>
    {selected ? <PersonDrawer /> : <Button onClick={() => { if (pilot) select(pilot.key) }}>打开个人详情</Button>}
  </BattleProvider></div>
}

export default { title: '个人抽屉', order: 50, Component: PersonGallery } satisfies GallerySection
