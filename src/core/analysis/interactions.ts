import type { BattleState, Counterparty, Entity, EntityKey, EwarSpan, Interaction, LogEvent } from '../contract'
import { addShip, charKey } from './entities'

interface Observation {
  interaction: Interaction
  outgoing: boolean
  hasPeerLog: boolean
}

function resolveCounterparty(
  other: Counterparty,
  state: BattleState,
  entities: Map<EntityKey, Entity>,
  byDisplayName: Map<string, Entity>,
): EntityKey {
  const displayName = other.name ?? other.raw
  let entity = byDisplayName.get(displayName)
  if (!entity) {
    const resolved = Object.hasOwn(state.names, displayName) ? state.names[displayName] : null
    const key = resolved ? charKey(resolved.charId) : `name:${displayName}` as const
    entity = entities.get(key) ?? {
      key,
      name: resolved ? state.meta.names[resolved.charId]?.name ?? displayName : displayName,
      charId: resolved?.charId ?? null,
      side: resolved?.side ?? -1,
      shipTypes: [],
      hasLog: false,
    }
    byDisplayName.set(displayName, entity)
    entities.set(key, entity)
  }
  addShip(entity, other.shipType)
  return entity.key
}

function fromEvent(event: LogEvent, logId: string, from: EntityKey, to: EntityKey): Interaction {
  return {
    t: event.t,
    from,
    to,
    kind: event.kind,
    amount: 'amount' in event ? event.amount : 0,
    weapon: 'weapon' in event ? event.weapon : 'module' in event ? event.module : null,
    quality: event.kind === 'damage' ? event.quality : null,
    repairType: event.kind === 'repair' ? event.repairType : null,
    ewar: event.kind === 'ewar' ? event.ewar : null,
    sources: [{ logId, line: event.line }],
    corroborated: false,
  }
}

interface Queue {
  entries: Interaction[]
  head: number
}

interface Pending {
  all: Queue
  byWeapon: Map<Interaction['weapon'], Queue>
}

const queue = (): Queue => ({ entries: [], head: 0 })
const pending = (): Pending => ({ all: queue(), byWeapon: new Map() })

function oldest(reports: Queue | undefined, t: number): Interaction | undefined {
  if (!reports) return
  while (reports.head < reports.entries.length) {
    const report = reports.entries[reports.head]!
    if (!report.corroborated && t - report.t <= 1000) return report
    reports.head++
  }
}

function match(otherLog: Pending, report: Interaction): Interaction | undefined {
  if (report.weapon === null) return oldest(otherLog.all, report.t)
  const unlabelled = oldest(otherLog.byWeapon.get(null), report.t)
  const labelled = oldest(otherLog.byWeapon.get(report.weapon), report.t)
  if (!unlabelled) return labelled
  if (!labelled) return unlabelled

  // Reports in these two queues come from the same log. Line order breaks timestamp ties.
  return unlabelled.t < labelled.t || (unlabelled.t === labelled.t && unlabelled.sources[0]!.line < labelled.sources[0]!.line)
    ? unlabelled
    : labelled
}

function enqueue(log: Pending, report: Interaction): void {
  log.all.entries.push(report)
  let weaponQueue = log.byWeapon.get(report.weapon)
  if (!weaponQueue) {
    weaponQueue = queue()
    log.byWeapon.set(report.weapon, weaponQueue)
  }
  weaponQueue.entries.push(report)
}

function dedupe(observations: Observation[]): Interaction[] {
  const interactions: Interaction[] = []
  const pendingByHit = new Map<string, { outgoing: Pending; incoming: Pending }>()
  for (const { interaction, outgoing, hasPeerLog } of observations) {
    if (hasPeerLog) {
      const { from, to, kind, amount } = interaction
      const key = `${from}/${to}/${kind}/${amount}`
      let bothLogs = pendingByHit.get(key)
      if (!bothLogs) {
        bothLogs = { outgoing: pending(), incoming: pending() }
        pendingByHit.set(key, bothLogs)
      }
      const earlier = match(outgoing ? bothLogs.incoming : bothLogs.outgoing, interaction)
      if (earlier) {
        earlier.sources.push(interaction.sources[0]!)
        earlier.corroborated = true
        earlier.weapon ??= interaction.weapon
        if (earlier.quality === 'none') earlier.quality = interaction.quality
        continue
      }
      enqueue(outgoing ? bothLogs.outgoing : bothLogs.incoming, interaction)
    }
    interactions.push(interaction)
  }
  return interactions
}

export function collectInteractions(state: BattleState, entities: Map<EntityKey, Entity>): Interaction[] {
  const logs = [...state.logs].sort((a, b) => a.charId - b.charId)
  const logIds = new Map<EntityKey, string>()
  const byDisplayName = new Map<string, Entity>()
  const observations: Observation[] = []
  for (const log of logs) {
    const key = charKey(log.charId)
    entities.set(key, { key, name: log.charName, charId: log.charId, side: log.side, shipTypes: [], hasLog: true })
    logIds.set(key, log.id)
  }
  for (const log of logs) {
    const listener = charKey(log.charId)
    for (const event of log.parsed.events) {
      const other = resolveCounterparty(event.other, state, entities, byDisplayName)
      const outgoing = event.dir === 'out'
      const from = outgoing ? listener : other
      const to = outgoing ? other : listener
      const peerLogId = logIds.get(other)
      observations.push({
        interaction: fromEvent(event, log.id, from, to),
        outgoing,
        hasPeerLog: peerLogId !== undefined && peerLogId !== log.id,
      })
    }
  }

  // The sort is stable. Equal timestamps follow character ID, then parser line order.
  observations.sort((a, b) => a.interaction.t - b.interaction.t)
  return dedupe(observations)
}

export function collectEwarSpans(interactions: Interaction[]): EwarSpan[] {
  const spans: EwarSpan[] = []
  const lastByEffect = new Map<string, EwarSpan>()
  for (const { ewar, from, to, t } of interactions) {
    if (ewar === null) continue
    const key = JSON.stringify([from, to, ewar])
    const previous = lastByEffect.get(key)
    if (previous && t - (previous.end - 5000) < 15_000) {
      previous.end = t + 5000
    } else {
      const span = { from, to, ewar, start: t, end: t + 5000 }
      spans.push(span)
      lastByEffect.set(key, span)
    }
  }
  return spans
}
