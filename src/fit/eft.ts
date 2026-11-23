import type { ApiErrorCode } from '../core/contract'

export class EftFormatError extends Error {
  readonly code = 'bad_eft' satisfies ApiErrorCode

  constructor(message: string) {
    super(message)
    this.name = 'EftFormatError'
  }
}

export interface EftModule {
  name: string
  charge?: string
  offline: boolean
  mutated?: true
}

export interface EftStack {
  name: string
  count: number
  mutated?: true
}

export interface ParsedEft {
  ship: string
  name: string
  modules: EftModule[]
  /** EFT uses the same syntax for drones and cargo. Classify these with selectDroneStacks. */
  stacks: EftStack[][]
}

const header = /^\[([^,\[\]]+),(.+)\]$/
const emptySlot = /^\[Empty (?:low|med|mid|high|rig|subsystem|service) slot\]$/i
const itemName = /^[^,\[\]/]+$/u
const quantity = /^(.*?)\s+x(\d+)$/i
const offlineSuffix = /\s*\/offline$/i
const mutationSuffix = /\s*\[\d+\]$/
const mutationHeader = /^\[\d+\]\s*\S/

export function parseEft(text: string): ParsedEft {
  const lines = text.trim().split(/\r\n?|\n/)
  const match = header.exec(lines[0]?.trim() ?? '')
  const ship = match?.[1]?.trim()
  const name = match?.[2]?.trim()
  if (!ship || !name) throw new EftFormatError('The first line of an EFT fit must be [Ship, Name]')

  const modules: EftModule[] = []
  const stacks: EftStack[][] = []
  let stackSection: EftStack[] | undefined
  let inMutationDetails = false
  for (const [index, raw] of lines.entries()) {
    if (index === 0) continue
    const trimmed = raw.trim()
    if (!trimmed) {
      stackSection = undefined
      inMutationDetails = false
      continue
    }
    if (mutationHeader.test(trimmed)) {
      // pyfa exports the base name, mutaplasmid and rolled attributes in a separate block.
      stackSection = undefined
      inMutationDetails = true
    }
    if (inMutationDetails) continue
    if (emptySlot.test(trimmed)) {
      stackSection = undefined
      continue
    }

    const mutated = mutationSuffix.test(trimmed) ? { mutated: true as const } : {}
    const line = trimmed.replace(mutationSuffix, '').trimEnd()
    const invalid = () => new EftFormatError(`Invalid EFT item on line ${index + 1}`)
    const stack = quantity.exec(line)
    if (stack) {
      const stackName = stack[1]?.trim() ?? ''
      const count = Number(stack[2])
      if (!itemName.test(stackName) || !Number.isSafeInteger(count) || count < 1) throw invalid()
      if (!stackSection) {
        stackSection = []
        stacks.push(stackSection)
      }
      stackSection.push({ name: stackName, count, ...mutated })
      continue
    }

    stackSection = undefined
    const offline = offlineSuffix.test(line)
    const [moduleName, charge, extra] = line.replace(offlineSuffix, '').split(',').map((part) => part.trim())
    if (!moduleName || !itemName.test(moduleName) ||
        (charge !== undefined && !itemName.test(charge)) || extra !== undefined) throw invalid()
    modules.push({ name: moduleName, ...(charge === undefined ? {} : { charge }), offline, ...mutated })
  }
  return { ship, name, modules, stacks }
}

/** Match pyfa's drone-bay precedence for exports flattened into mixed sections. */
export function selectDroneStacks(stacks: ParsedEft['stacks'], isDrone: (name: string) => boolean): EftStack[] {
  const candidates = stacks.map((section) => section.filter(({ name }) => isDrone(name)))
  const bays = candidates.filter((section, index) => section.length === stacks[index]?.length)
  return (bays.length ? bays : candidates).flat()
}

export type EftItemKind = 'module' | 'charge' | 'drone' | 'other'

/** Keep recognized fitting rows and keep one skipped name per omitted line. */
export function resolveEftItems({ modules, stacks, ...fit }: ParsedEft, kinds: ReadonlyMap<string, EftItemKind>) {
  const skippedLines: string[] = []
  const fittedModules = modules.filter(({ name, charge }) => {
    if (kinds.get(name) !== 'module') skippedLines.push(name)
    else if (charge !== undefined && kinds.get(charge) !== 'charge') skippedLines.push(charge)
    else return true
    return false
  })
  const knownStacks = stacks.map((section) => section.filter(({ name }) => {
    if (kinds.has(name)) return true
    skippedLines.push(name)
    return false
  })).filter((section) => section.length > 0)
  const drones = selectDroneStacks(knownStacks, (name) => kinds.get(name) === 'drone')
  return { parsed: { ...fit, modules: fittedModules }, drones, skippedLines }
}
