import { useEffect, useState } from 'react'

type Lookup = (name: string) => number | null

let loaded: Lookup | null = null
let loading: Promise<Lookup> | null = null

/** The item-types table is 438 KB, so it loads on first use and stays out of the main bundle. */
function load(): Promise<Lookup> {
  loading ??= import('@/core/data/item-types').then((module) => (loaded = module.itemTypeId))
  return loading
}

/** CCP type id of a module, charge or drone by name; null while the table loads or when the name is unknown (text is shown). */
export function useModuleTypeId(): (name: string | null) => number | null {
  const [lookup, setLookup] = useState<{ find: Lookup } | null>(loaded && { find: loaded })
  useEffect(() => {
    if (!lookup) void load().then((find) => setLookup({ find }))
  }, [lookup])
  return (name) => (lookup && name ? lookup.find(name) : null)
}
