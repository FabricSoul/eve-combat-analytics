// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { FitTab } from '../FitTab'
import { BattleUndo, useBattleUndo } from '../undo'
import { computeFitStats } from '@/fit/client'
import type { BattleSummary, FitEntry } from '@/core/contract'

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
let beginOtherEdit: ReturnType<typeof useBattleUndo>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers() })

function Harness() {
  const { select } = useView()
  beginOtherEdit = useBattleUndo()
  useEffect(() => { select(pilot.key) }, [])
  return <FitTab />
}

async function renderFit(data = fixture, analyzedSummary = data.summary, showFit = true) {
  await act(async () => root.render(
    <BattleProvider static={data}><ViewProvider syncUrl={false}>
      <BattleUndo analyzedSummary={analyzedSummary} publishedVersion={data.summary.analysisVersion}>
        {showFit && <Harness />}
      </BattleUndo>
    </ViewProvider></BattleProvider>,
  ))
}

const button = (label: string) => [...host.querySelectorAll('button')].find((el) => el.textContent === label)!
const eft = '[Leshak, Killmail ' + loss.id + ']\nEntropic Radiation Sink II'
const result = { charId: pilot.charId, killmailId: loss.id, shipTypeId: loss.victim.shipTypeId!, eft }
const warning = '按基础属性计算，理论值会偏离实际'
const mutatedModules = ['Entropic Radiation Sink II']
const importedFit = { charId: pilot.charId!, eft, setAt: 1, mutated: mutatedModules }
const firstFit = { charId: pilot.charId!, eft: '[Leshak, First save]', setAt: 10_000 }
const firstTag = '"first-save"'
const firstReceipt = { ...firstFit, etag: firstTag }
const newerFit = { charId: pilot.charId!, eft: '[Leshak, Other viewer]', setAt: 10_300 }
const overwritten = '已被他人的新配装覆盖，无法撤销'
const toast = () => host.querySelector('[data-battle-toast]')

function withFits(...fits: FitEntry[]): BattleSummary {
  return { ...fixture.summary, fits }
}

async function submitFit(fit: FitEntry) {
  if (!host.querySelector('textarea')) await act(() => button('粘贴 EFT').click())
  const editor = host.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(editor, fit.eft)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('保存配装').click())
}

it('settles an overtaken PUT even when analysis only publishes the other viewer’s fit', async () => {
  vi.useFakeTimers()
  let settle!: (fit: typeof firstReceipt) => void
  const pending = new Promise<typeof firstReceipt>((resolve) => { settle = resolve })
  const put = vi.spyOn(api, 'putFit').mockReturnValue(pending)
  const before = withFits()
  await renderFit({ ...fixture, summary: before })
  await submitFit(firstFit)
  expect(toast()?.textContent).toBe('正在应用…')

  await act(async () => vi.advanceTimersByTimeAsync(300))
  const coalesced = { ...withFits(newerFit), analysisVersion: before.analysisVersion + 1 }
  await renderFit({ ...fixture, summary: coalesced }, before)
  await act(async () => settle(firstReceipt))
  await renderFit({ ...fixture, summary: coalesced })
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(toast()?.textContent).toBe(overwritten)
  expect(toast()?.querySelector('button')).toBeNull()
  expect(put).toHaveBeenCalledTimes(1)
})

it('offers undo on the PUT response alone and can remove a first fit', async () => {
  vi.spyOn(api, 'putFit').mockResolvedValue(firstReceipt)
  const remove = vi.spyOn(api, 'deleteFit').mockResolvedValue({ removed: firstFit.charId })
  await renderFit({ ...fixture, summary: withFits() })
  await submitFit(firstFit)
  expect(toast()?.textContent).toBe('已保存配装撤销')
  expect(toast()?.querySelector('[role=timer]')?.getAttribute('aria-label')).toBe('撤销剩余时间 10 秒')
  await act(async () => button('撤销').click())
  expect(remove).toHaveBeenCalledWith(fixture.summary.meta.brId, firstFit.charId, firstTag)
  expect(toast()?.textContent).toBe('已撤销')
})

it('undo restores the prior EFT and mutation metadata', async () => {
  const put = vi.spyOn(api, 'putFit').mockResolvedValueOnce(firstReceipt)
    .mockResolvedValueOnce({ ...importedFit, setAt: 10_400 })
  await renderFit({ ...fixture, summary: withFits(importedFit) })
  await submitFit(firstFit)
  await act(async () => button('撤销').click())
  expect(put).toHaveBeenNthCalledWith(2, fixture.summary.meta.brId, firstFit.charId, eft, mutatedModules, firstTag)
  expect(toast()?.textContent).toBe('已撤销')
  expect(host.textContent).toContain(`${warning}。 Entropic Radiation Sink II`)
})

it('withdraws undo for a newer save with identical EFT even after the drawer closes', async () => {
  vi.spyOn(api, 'putFit').mockResolvedValue(firstReceipt)
  const initial = withFits()
  await renderFit({ ...fixture, summary: initial })
  await submitFit(firstFit)
  expect(toast()?.textContent).toBe('已保存配装撤销')

  await renderFit({ ...fixture, summary: withFits(firstFit) }, initial, false)
  await renderFit({ ...fixture, summary: withFits({ ...firstFit, setAt: newerFit.setAt }) }, initial, false)
  expect(toast()?.textContent).toBe(overwritten)
})

it('shows the overwrite reason even when the fit notice was in the undo overflow', async () => {
  vi.spyOn(api, 'putFit').mockResolvedValue(firstReceipt)
  const initial = withFits()
  await renderFit({ ...fixture, summary: initial })
  await submitFit(firstFit)
  await act(() => {
    for (const label of ['已合并身份', '已恢复报告阵营', '已改为所选阵营']) {
      beginOtherEdit({ label, revert: async () => {} })
    }
  })
  expect((toast() as HTMLElement).hidden).toBe(true)

  await renderFit({ ...fixture, summary: withFits(newerFit) }, initial)
  const visibleToasts = [...host.querySelectorAll('[data-battle-toast]:not([hidden])')]
  expect(visibleToasts.map(({ textContent }) => textContent)).toContain(overwritten)
})

it('leaves a newer fit intact when the live frame has not reached the viewer at undo time', async () => {
  const fetchFit = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json(firstFit, { headers: { ETag: firstTag } }))
    .mockResolvedValueOnce(Response.json({ error: 'bad_request', message: 'The fit changed' }, { status: 412 }))
  await renderFit({ ...fixture, summary: withFits(importedFit) })
  await submitFit(firstFit)
  await act(async () => button('撤销').click())
  expect(toast()?.textContent).toBe(overwritten)
  expect(fetchFit).toHaveBeenCalledTimes(2)
  expect(fetchFit.mock.calls.map(([, init]) => ({
    method: init?.method, match: new Headers(init?.headers).get('If-Match'), body: init?.body,
  }))).toEqual([
    { method: 'PUT', match: null, body: firstFit.eft },
    { method: 'PUT', match: firstTag, body: JSON.stringify({ eft, mutated: mutatedModules }) },
  ])
})

it('shows the named abyssal warning from a saved fit on a fresh mount', async () => {
  await renderFit({ ...fixture, summary: { ...fixture.summary, fits: [importedFit] } })
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.textContent).toContain(`${warning}。 Entropic Radiation Sink II`)
})

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
  vi.spyOn(api, 'getKillmailFit').mockResolvedValue({ ...result, mutated: mutatedModules })
  const put = vi.spyOn(api, 'putFit').mockResolvedValue(importedFit)
  await renderFit()
  await act(async () => button('从击毁报告带入').click())
  const hint = [...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))
  expect(hint?.textContent).toContain('Entropic Radiation Sink II')
  await act(async () => button('保存配装').click())
  expect(put).toHaveBeenCalledWith(fixture.summary.meta.brId, pilot.charId, eft, mutatedModules)
  expect([...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))?.textContent)
    .toContain('Entropic Radiation Sink II')
})

it('clears substitution metadata when a user hand edits imported EFT', async () => {
  vi.spyOn(api, 'getKillmailFit').mockResolvedValue({ ...result, mutated: mutatedModules })
  const edited = `${eft}\nDamage Control II`
  const put = vi.spyOn(api, 'putFit').mockResolvedValue({ charId: pilot.charId!, eft: edited, setAt: 2 })
  await renderFit()
  await act(async () => button('从击毁报告带入').click())
  expect(host.textContent).toContain(warning)

  const editor = host.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(editor, edited)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(host.textContent).not.toContain(warning)
  await act(async () => button('保存配装').click())
  expect(put).toHaveBeenCalledWith(fixture.summary.meta.brId, pilot.charId, edited)
  expect(host.textContent).not.toContain(warning)
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

it('renders skipped pasted item names alongside computed theory and the mutation warning', async () => {
  const eft = `[Leshak, Paste]
Damage Control II [1]
Unknown Module

[1] Damage Control II
  Gravid Damage Control Mutaplasmid
  structureEmDamageResonance 0.62`
  const computed = {
    shipTypeName: 'Leshak', dps: { total: 422, turret: 422, missile: 0, drone: 0 },
    volley: 1715, remoteRepair: { armor: 85 }, ehp: 0, maxVelocity: 0, ranges: {},
    skippedLines: ['Unknown Module'],
  }
  vi.mocked(computeFitStats).mockResolvedValueOnce(computed)
  await renderFit({ ...fixture, summary: { ...fixture.summary, fits: [{ charId: pilot.charId!, eft, setAt: 1 }] } })
  expect(host.textContent).toContain('有 1 行无法识别，已跳过：Unknown Module')
  expect(host.textContent).toContain('422')
  expect(host.textContent).toContain('1,715')
  expect(host.textContent).not.toContain('无法计算理论值')
  const hint = [...host.querySelectorAll('.u7-fit-hint')].find((el) => el.textContent.includes(warning))
  expect(hint?.textContent).toContain('Damage Control II')
})
