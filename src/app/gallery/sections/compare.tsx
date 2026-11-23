import { useMemo, useState } from 'react'
import { BattleProvider, useBattleContext } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import { Button } from '../../ui/Button'
import { CompareTable } from '../../battle/CompareTable'
import type { GallerySection } from '../GalleryPage'
import { threeSideDemo } from './u7-three-side-demo'

function CompareGallery() {
  const { analysis, summary } = useBattleContext()
  const [demo, setDemo] = useState(false)
  const demoData = useMemo(() => analysis && summary && demo ? threeSideDemo({ analysis, summary }) : null, [analysis, summary, demo])
  const { range, setRange } = useView()
  const start = analysis?.timeline.start
  return <>
    <div className="mb-app-2 flex flex-wrap gap-app-2">
      {start !== undefined && <Button onClick={() => setRange(range ? null : [start, start + 60_000])}>
        {range ? '查看整场' : '查看回放片段的前 1 分钟'}
      </Button>}
      <Button aria-pressed={demo} onClick={() => setDemo(!demo)}>三方示例</Button>
    </div>
    {demoData ? <BattleProvider static={demoData}><CompareTable /></BattleProvider> : <CompareTable />}
  </>
}

export default { title: '飞行员对比', order: 30, Component: CompareGallery } satisfies GallerySection
