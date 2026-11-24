// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { loadUiFixture, uiReplayStart } from '../test/ui-fixture'
import { fetchGalleryFixture } from './fixture-assets'
import GalleryPage from './GalleryPage'

vi.mock('./fixture-assets', { spy: true })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('lists the production hit module with real ranks, insufficient samples and weapon classes', async () => {
  const load = vi.fn(loadUiFixture)
  vi.mocked(fetchGalleryFixture).mockResolvedValue({ loadUiFixture: load, replayStart: uiReplayStart })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<GalleryPage />) })
    const navigation = host.querySelector('.app-gallery-nav')!
    expect(navigation.firstElementChild?.getAttribute('href')).toBe('#tokens')
    expect(navigation.querySelector('a[href="#hit-analysis"]')?.textContent).toBe('命中分析')
    const hits = host.querySelector('#hit-analysis .hit-analysis')!
    expect(load).toHaveBeenCalledWith({ fullPilotEvents: true })
    const ranked = [...hits.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes('Blanchard2213'))
    expect(ranked?.textContent).toContain('1,854 发')

    const insufficient = hits.querySelector<HTMLDetailsElement>('details.hit-insufficient')!
    act(() => insufficient.querySelector('summary')!.click())
    expect(insufficient.open).toBe(true)
    expect(insufficient.querySelector('li[data-pilot-key]')).not.toBeNull()

    const classes = [...hits.querySelectorAll('.hit-card .hit-classes > div')]
    for (const label of ['炮台', '导弹', '无人机 / 铁骑舰载机']) {
      expect(classes.some((row) => row.querySelector('dt')?.textContent === label
        && row.querySelector('dd')?.textContent?.match(/^[1-9][\d,]* 发/)), label).toBe(true)
    }
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
