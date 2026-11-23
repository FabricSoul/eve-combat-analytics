import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRecent, recordRecent, type RecentBattle } from './recent'

const entry = (n: number): RecentBattle => ({ brId: `br${n}`, title: `T${n}`, start: n, end: n + 1, kills: n, logs: 0, openedAt: n })

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    data,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('recent battles', () => {
  it('keeps newest first, de-duplicated, at most 20', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    for (let n = 1; n <= 25; n++) recordRecent(entry(n))
    recordRecent({ ...entry(10), openedAt: 99 })
    const list = readRecent()
    expect(list).toHaveLength(20)
    expect(list[0]).toMatchObject({ brId: 'br10', openedAt: 99 })
    expect(list.filter(({ brId }) => brId === 'br10')).toHaveLength(1)
    expect(list.at(-1)!.brId).toBe('br6')
  })

  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
    vi.stubGlobal('localStorage', broken)
    expect(readRecent()).toEqual([])
    expect(() => recordRecent(entry(1))).not.toThrow()
  })

  it('survives a missing localStorage object', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readRecent()).toEqual([])
    expect(() => recordRecent(entry(1))).not.toThrow()
  })

  it('ignores corrupt or malformed stored data', () => {
    for (const raw of ['{not json', '{"a":1}', '[1,"x",{"brId":5}]']) {
      vi.stubGlobal('localStorage', memoryStorage({ 'eve-combat-analytics:recent': raw }))
      expect(readRecent()).toEqual([])
    }
    vi.stubGlobal('localStorage', memoryStorage({ 'eve-combat-analytics:recent': JSON.stringify([entry(1), { brId: 3 }, entry(2)]) }))
    expect(readRecent().map(({ brId }) => brId)).toEqual(['br1', 'br2'])
  })
})
