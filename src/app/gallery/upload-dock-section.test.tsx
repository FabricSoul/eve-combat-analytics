// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadUiFixture, uiReplayStart } from '../test/ui-fixture'
import { GalleryFixtureContext } from './fixture-assets'
import section from './sections/upload-dock'

let root: Root | undefined
let host: HTMLElement
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const Component = section.Component
  act(() => root!.render(
    <GalleryFixtureContext.Provider value={{ replayStart: uiReplayStart, loadUiFixture }}>
      <Component />
    </GalleryFixtureContext.Provider>,
  ))
}

describe('upload gallery section (R2a-14)', () => {
  it('shows the real byte size of the real log it uses', () => {
    mount()
    const log = loadUiFixture().summary.logs[0]!
    const bytes = gunzipSync(readFileSync(resolve(`fixtures/real/j125990-20250622/logs/${log.id}.gz`))).length
    const first = host.querySelector('.upload-row[data-status="done"]')!
    expect(first.textContent).toContain(bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`)
    expect(first.textContent).not.toContain('示例')
  })

  it('marks every simulated state as an example', () => {
    mount()
    const rows = Array.from(host.querySelectorAll('.upload-row'))
    const simulated = rows.filter((row) => row.getAttribute('data-status') !== 'done')
    expect(simulated.length).toBeGreaterThan(5)
    for (const row of simulated) expect(row.textContent).toContain('示例')
  })

  it('has a generic network failure row, and Remove acts on the demo state', () => {
    mount()
    const failed = host.querySelector('.upload-row[data-status="failed"]')!
    expect(failed.textContent).toContain('无法连接到服务器')
    const before = host.querySelectorAll('.upload-row').length
    act(() => failed.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.querySelectorAll('.upload-row')).toHaveLength(before - 1)
    expect(host.querySelector('.upload-row[data-status="failed"]')).toBeNull()
  })
})
