// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { UploadedLogSummary } from '@/core/contract'
import { portraitUrl } from '@/app/lib/images'
import { UploadTray } from './UploadTray'
import { initialQueue, queueReducer } from './queue'

it('uses the filename portrait while queued and after completion, and the server portrait for a renamed log', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Simulate a filename whose character ID differs from the returned log owner.
  const fileCharId = 2121605780
  const log: UploadedLogSummary = {
    id: 'log-id', charId: 2117427381, charName: 'Lucinda HIly', side: 0, events: 0, uploadedAt: 0,
  }
  const queued = queueReducer(initialQueue, { type: 'add', files: [
    { name: `20250622_134516_${fileCharId}.txt`, size: 100 },
    { name: 'renamed.txt', size: 100 },
  ] })
  const portraits = () => [...host.querySelectorAll('.upload-row')]
    .map((row) => row.querySelector('img.app-portrait')?.getAttribute('src'))
  try {
    act(() => root.render(<UploadTray items={queued.items} />))
    expect.soft(portraits()).toEqual([portraitUrl(fileCharId, 16), undefined])

    const finished = queued.items.reduce((state, { id }) => queueReducer(
      queueReducer(state, { type: 'start', id }), { type: 'done', id, log },
    ), queued)
    act(() => root.render(<UploadTray items={finished.items} />))
    expect(portraits()).toEqual([portraitUrl(fileCharId, 16), portraitUrl(log.charId, 16)])
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
