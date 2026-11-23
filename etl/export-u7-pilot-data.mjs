// Called by node scripts/build-ui-fixture.ts after the full fight is analyzed.
export function exportPilotSeries({ entities, interactions, ewarSpans, timeline }) {
  const names = new Set(['Blanchard2213', 'MoQingXL moqing'])
  const pilots = new Set(Object.values(entities).filter(({ name }) => names.has(name)).map(({ key }) => key))
  const involvesPilot = ({ from, to }) => pilots.has(from) || pilots.has(to)
  const shapes = []
  const byShape = new Map()
  const events = interactions.filter(involvesPilot).map(({ t, from, to, kind, amount, weapon, quality, repairType, ewar }) => {
    const shape = [from, to, kind, weapon, quality, repairType, ewar]
    const key = JSON.stringify(shape)
    let index = byShape.get(key)
    if (index === undefined) {
      index = shapes.length
      byShape.set(key, index)
      shapes.push(shape)
    }
    return [t - timeline.start, index, amount]
  })
  return {
    source: 'Whole-fight J125990 interactions for the two person/fit board pilots. The event shapes share a dictionary and omit log source references.',
    shapes,
    events,
    ewarSpans: ewarSpans.filter(involvesPilot),
  }
}
