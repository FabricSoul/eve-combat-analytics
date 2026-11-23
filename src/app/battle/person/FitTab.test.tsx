// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

function Harness() {
  const { select } = useView()
  useEffect(() => { select(pilot.key) }, [])
  return <FitTab />
}

async function renderFit() {
  await act(async () => root.render(
    <BattleProvider static={fixture}><ViewProvider syncUrl={false}><Harness /></ViewProvider></BattleProvider>,
  ))
}

const button = (label: string) => [...host.querySelectorAll('button')].find((el) => el.textContent === label)!
const eft = '[Leshak, Killmail ' + loss.id + ']\nEntropic Radiation Sink II'
const result = { charId: pilot.charId, killmailId: loss.id, shipTypeId: loss.victim.shipTypeId!, eft }
const warning = '按基础属性计算，理论值会偏离实际'

it.each([
  { label: 'absent', mutated: undefined },
  { label: 'empty', mutated: [] },
])('imports unchanged EFT without a warning when mutation metadata is $label', async ({ mutated }) => {
  const get = vi.spyOn(api, 'getKillmailFit').mockResolvedValue({ ...result, mutated })
  const put = vi.spyOn(api, 'putFit').mockResolvedValue({ charId: pilot.charId!, eft, setAt: 1 })
  await renderFit()
  await act(async () => button('从击毁报告带入').click())
  expect(get).toHaveBeenCalledWith(loss.id, loss.hash)
  expect(host.querySelector('textarea')!.value).toBe(eft)
  expect(put).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain(warning)
  await act(async () => button('保存配装').click())
  expect(put).toHaveBeenCalledWith(fixture.summary.meta.brId, pilot.charId, eft)
  expect(host.textContent).toContain('834')
})

it('names the mutated module returned by the killmail API', async () => {
  vi.spyOn(api, 'getKillmailFit').mockResolvedValue({ ...result, mutated: ['Entropic Radiation Sink II'] })
  await renderFit()
  await act(async () => button('从击毁报告带入').click())
  const hint = [...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))
  expect(hint?.textContent).toContain('Entropic Radiation Sink II')
  vi.spyOn(api, 'putFit').mockResolvedValue({ charId: pilot.charId!, eft, setAt: 1 })
  await act(async () => button('保存配装').click())
  expect([...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))?.textContent)
    .toContain('Entropic Radiation Sink II')
})

it('counts skipped item types while keeping the imported EFT available', async () => {
  vi.spyOn(api, 'getKillmailFit').mockResolvedValue({ ...result, skippedTypeIds: [900001, 900002] })
  await renderFit()
  await act(async () => button('从击毁报告带入').click())
  expect(host.textContent).toContain('2 个物品无法识别名称')
  expect(button('保存配装').disabled).toBe(false)
})

it('warns for an explicitly named Abyssal module in pasted EFT', async () => {
  await renderFit()
  const editor = host.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  function paste(text: string) {
    act(() => {
      setValue.call(editor, text)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  paste(eft)
  expect(host.textContent).not.toContain(warning)
  paste('[Leshak, Pasted]\nAbyssal Entropic Radiation Sink')
  expect(host.textContent).toContain(warning)
  expect([...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))?.textContent)
    .toContain('Abyssal Entropic Radiation Sink')
})
