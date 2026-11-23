import { useEffect, useState } from 'react'

type Lookup = (name: string) => number | null
type Importer = () => Promise<{ itemTypeId: Lookup }>

const defaultImporter: Importer = () => import('@/core/data/item-types')
let importer: Importer = defaultImporter
let loaded: Lookup | null = null
let loading: Promise<Lookup> | null = null

/** Test hooks. */
export function setItemTypesImporter(next: Importer): void { importer = next }
export function resetItemTypes(): void { importer = defaultImporter; loaded = null; loading = null }

/**
 * The item-types table is 438 KB, so it loads on first use and stays out of the main bundle. A failed download is not
 * cached: the next call tries again.
 */
export function loadItemTypes(): Promise<Lookup> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= importer().then(
    (module) => (loaded = module.itemTypeId),
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}

/** CCP type id of a module, charge or drone by name; null while the table loads, when it failed to load, or when the name is unknown (text is shown). */
export function useModuleTypeId(): (name: string | null) => number | null {
  const [lookup, setLookup] = useState<{ find: Lookup } | null>(loaded && { find: loaded })
  useEffect(() => {
    if (lookup) return
    let active = true
    loadItemTypes().then((find) => { if (active) setLookup({ find }) }, () => { /* keep the text fallback; the next mount retries */ })
    return () => { active = false }
  }, [lookup])
  return (name) => (lookup && name ? lookup.find(name) : null)
}
