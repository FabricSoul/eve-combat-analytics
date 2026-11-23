import { SidesPanel } from '../../battle/SidesPanel'
import { withExtraSides } from '../../battle/roster/example'
import { defaultOursSide } from '../../lib/sides'
import { BattleProvider } from '../../state/battle-store'
import { ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'

const fixture = loadUiFixture()
const ours = defaultOursSide(fixture.summary)

function SidesSection() {
  const extra = withExtraSides(fixture)
  const sideOverrides = Object.values(extra.analysis.entities).flatMap(({ charId, side }) =>
    charId !== null && side >= fixture.summary.meta.teams.length
      ? [{ subject: `char:${charId}` as const, side, source: 'manual' as const, setAt: fixture.summary.meta.fetchedAt }]
      : [])
  extra.summary = { ...extra.summary, sideOverrides }
  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <div>
        <p className="app-token-usage">真实数据：两方 + 未分边 + 新建一方。画廊没有后端，拖动或菜单会显示请求失败。</p>
        <div style={{ height: 560 }}><SidesPanel /></div>
      </div>
      <div>
        <p className="app-token-usage">三方、四方（示例数据，不是真实分边：见 roster/example.ts）。第 4 方起灰色，加字母 D。</p>
        <div style={{ height: 560 }}>
          <BattleProvider static={extra}>
            <ViewProvider syncUrl={false} defaultSide={ours}><SidesPanel /></ViewProvider>
          </BattleProvider>
        </div>
      </div>
    </div>
  )
}

export default { title: '排边', order: 11, Component: SidesSection }
