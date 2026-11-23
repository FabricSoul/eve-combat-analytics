import { expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({ killmail: vi.fn(), racks: vi.fn() }))
vi.mock('@/core/data/killmail-types.json', async (load) => {
  loaded.killmail()
  return load()
})
vi.mock('./fit-items.json', async (load) => {
  loaded.racks()
  return load()
})

it('imports fit dictionaries only when the tab requests them and reuses the lookup', async () => {
  const { loadFitCatalog } = await import('./fit-data')
  expect(loaded.killmail).not.toHaveBeenCalled()
  expect(loaded.racks).not.toHaveBeenCalled()

  const request = loadFitCatalog()
  expect(loadFitCatalog()).toBe(request)
  const catalog = await request

  expect(loaded.killmail).toHaveBeenCalledOnce()
  expect(loaded.racks).toHaveBeenCalledOnce()
  expect(catalog.itemId('Entropic Radiation Sink II')).not.toBeNull()
  expect(catalog.moduleSlot('Entropic Radiation Sink II')).toBe('低槽')
  expect(catalog.moduleSlot('')).toBe('其他模块')
})
