import { useEffect } from 'react'
import { FitTab } from '../../battle/FitTab'
import { FitServices } from '../../battle/person/fit-data'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { Button } from '../../ui/Button'
import type { GallerySection } from '../GalleryPage'
import fixture from './u7-fit-data.json'
import { loadUiFixture } from '../../test/ui-fixture'

const pilotData = loadUiFixture({ fullPilotEvents: true })

const demoName = 'Blanchard2213'

function FitPreview({ saved, name = demoName }: { saved: boolean; name?: string }) {
  const { summary, analysis } = pilotData
  const { select, selected } = useView()
  const pilot = Object.values(analysis?.entities ?? {}).find((entity) => entity.name === name)
  const charId = pilot?.charId
  useEffect(() => { if (pilot) select(pilot.key) }, [pilot])
  if (!pilot || charId == null) return null
  const { eft, setAt, killmailId, shipTypeId, stats } = fixture
  const fit = { eft, setAt, charId }
  const services = {
    load: async (id: number) => {
      if (id !== killmailId) throw new Error('Gallery killmail is unavailable')
      return { eft, killmailId, charId, shipTypeId }
    },
    save: async (_brId: string, id: number, text: string) => ({ eft: text, charId: id, setAt: Date.now() }),
    compute: async (text: string) => {
      if (text === eft) {
        if (saved) await new Promise((resolve) => setTimeout(resolve, 3000))
        return stats
      }
      const { computeFitStats } = await import('@/fit/client')
      return computeFitStats(text)
    },
  }
  const data = saved ? { analysis, summary: { ...summary, fits: [fit] } } : pilotData
  return <BattleProvider static={data}><FitServices.Provider value={services}>
    {selected ? <FitTab /> : <Button onClick={() => select(pilot.key)}>{name}</Button>}
  </FitServices.Provider></BattleProvider>
}

function FitGallery() {
  return <div className="grid gap-app-4">
    <section aria-label="已保存的配装" className="max-w-[520px]"><ViewProvider syncUrl={false}><FitPreview saved /></ViewProvider></section>
    <section aria-label="添加配装" className="max-w-[520px]"><ViewProvider syncUrl={false}><FitPreview saved={false} /></ViewProvider></section>
    <details>
      <summary>无击毁记录 · MoQingXL moqing</summary>
      <div className="max-w-[520px]"><ViewProvider syncUrl={false}><FitPreview saved={false} name="MoQingXL moqing" /></ViewProvider></div>
    </details>
  </div>
}

export default { title: '配装', order: 70, Component: FitGallery } satisfies GallerySection
