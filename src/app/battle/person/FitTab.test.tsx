// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { FitTab } from '../FitTab'

vi.mock('@/fit/client', () => ({ computeFitStats: vi.fn().mockResolvedValue({
  shipTypeName: 'Leshak', dps: { total: 834, turret: 834, missile: 0, drone: 0 },
  volley: 0, remoteRepair: {}, ehp: 0, maxVelocity: 0, ranges: {},
}) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const fixture = loadUiFixture()
const pilot = Object.values(fixture.analysis.entities).find(({ name }) => name === 'Blanchard2213')!
const loss = fixture.summary.meta.killmails.filter(({ victim }) => victim.charId === pilot.charId)
  .sort((a, b) => b.t - a.t || b.id - a.id)[0]!
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

it('imports EFT from a killmail for confirmation, shows the abyssal warning, then saves it', async () => {
  const eft = '[Leshak, Killmail preview]\nEntropic Disintegrator II'
  const get = vi.spyOn(api, 'getKillmailFit').mockResolvedValue({
    charId: pilot.charId, killmailId: loss.id, shipTypeId: loss.victim.shipTypeId!, eft,
  })
  const put = vi.spyOn(api, 'putFit').mockResolvedValue({ charId: pilot.charId!, eft, setAt: 1 })
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <FitTab />
  }
  await act(async () => root.render(
    <BattleProvider static={fixture}><ViewProvider syncUrl={false}><Harness /></ViewProvider></BattleProvider>,
  ))
  const button = (label: string) => [...host.querySelectorAll('button')].find((el) => el.textContent === label)!
  await act(async () => button('从击毁报告带入').click())
  expect(get).toHaveBeenCalledWith(loss.id, loss.hash)
  expect(host.querySelector('textarea')!.value).toBe(eft)
  expect(put).not.toHaveBeenCalled()
  expect(host.textContent).toContain('按基础属性计算，理论值会偏离实际')
  await act(async () => button('保存配装').click())
  expect(put).toHaveBeenCalledWith(fixture.summary.meta.brId, pilot.charId, eft)
  expect(host.textContent).toContain('834')
})
