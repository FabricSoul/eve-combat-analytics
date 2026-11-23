import { useEffect, type ReactNode } from 'react'
import type { EntityKey } from '@/core/contract'
import { Roster } from '../../battle/Roster'
import { onlyPilot, withExtraSides } from '../../battle/roster/example'
import { defaultOursSide } from '../../lib/sides'
import { BattleProvider } from '../../state/battle-store'
import { ViewProvider, useView } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'

const fixture = loadUiFixture()
const ours = defaultOursSide(fixture.summary)
const entities = Object.values(fixture.analysis.entities)
const pilots = entities.filter((e) => e.charId !== null)
const deadIds = new Set(fixture.summary.meta.killmails.map((k) => k.victim.charId))
const pick = (test: (e: (typeof pilots)[number]) => boolean) => pilots.find((e) => e.side === ours && test(e)) ?? pilots[0]!

function Select({ keyOf }: { keyOf: EntityKey }) {
  const { select } = useView()
  useEffect(() => select(keyOf), [])
  return null
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="app-token-usage">{label}</span>
      <div style={{ width: 280, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-hair)' }}>{children}</div>
    </>
  )
}

function State({ label, keyOf, patch, selected, manual }: {
  label: string; keyOf: EntityKey; patch?: Parameters<typeof onlyPilot>[2]; selected?: boolean; manual?: boolean
}) {
  const data = onlyPilot(fixture, keyOf, patch)
  const charId = data.analysis.entities[keyOf]?.charId
  const summary = manual && charId != null
    ? { ...data.summary, sideOverrides: [{ subject: `char:${charId}` as const, side: ours, source: 'manual' as const, setAt: Date.UTC(2025, 5, 22, 16, 5) }] }
    : data.summary
  return (
    <Box label={label}>
      <BattleProvider static={{ ...data, summary }}>
        <ViewProvider syncUrl={false} defaultSide={ours}>
          {selected && <Select keyOf={keyOf} />}
          <Roster />
        </ViewProvider>
      </BattleProvider>
    </Box>
  )
}

function RosterSection() {
  const logged = pick((e) => e.hasLog && e.sideSource === 'br')
  const unlogged = pick((e) => !e.hasLog && e.sideSource === 'br' && !deadIds.has(e.charId))
  const dead = pick((e) => !e.hasLog && e.charId !== null && deadIds.has(e.charId))
  const corrected = pick((e) => e.sideSource === 'log')
  const three = withExtraSides(fixture)
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 'var(--space-2) var(--space-4)', alignItems: 'start' }}>
        <State label="默认（有日志）" keyOf={logged.key} />
        <State label="悬停：把鼠标移到任意一行，会显示 ⋯" keyOf={unlogged.key} />
        <State label="选中（金色左线 + 浅底）" keyOf={logged.key} selected />
        <State label="没上传日志（空心圈）" keyOf={unlogged.key} />
        <State label="已被击毁（划线、图标变暗）" keyOf={dead.key} />
        <State label="阵营据日志修正（悬停看依据）" keyOf={corrected.key} />
        <State label="阵营被手动修改（示例：这场没有人手动改过）" keyOf={unlogged.key} patch={{ sideSource: 'manual' }} manual />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: 'var(--space-4)', justifyContent: 'start' }}>
        <div>
          <p className="app-token-usage">完整名单 · J125990（我方有日志的在前，未分边在最后）</p>
          <div style={{ width: 280, height: 520, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-hair)' }}>
            <Roster />
          </div>
        </div>
        <div>
          <p className="app-token-usage">三方及以上（示例数据，不是真实分边：见 roster/example.ts）</p>
          <div style={{ width: 280, height: 520, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-hair)' }}>
            <BattleProvider static={three}>
              <ViewProvider syncUrl={false} defaultSide={ours}><Roster /></ViewProvider>
            </BattleProvider>
          </div>
        </div>
      </div>
    </div>
  )
}

export default { title: '名单', order: 10, Component: RosterSection }
