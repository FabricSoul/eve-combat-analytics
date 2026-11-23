// node src/app/gallery/sections/export-u7-pilot-data.mjs
import { writeFileSync } from 'node:fs'
import { runnerImport } from 'vite'

const { module: { realBattleStateWithBr } } = await runnerImport('fixtures/real/j125990-20250622/load.ts', { configFile: false })
const { module: { analyze } } = await runnerImport('src/core/analysis/analyze.ts', { configFile: false })
const { entities, interactions, ewarSpans } = analyze(realBattleStateWithBr())
const names = new Set(['Blanchard2213', 'MoQingXL moqing'])
const pilots = new Set(Object.values(entities).filter(({ name }) => names.has(name)).map(({ key }) => key))
const involvesPilot = ({ from, to }) => pilots.has(from) || pilots.has(to)
const from = interactions[0].t
const events = interactions.filter(involvesPilot).map(({ t, from: actor, to, kind, amount, weapon, quality, repairType, ewar }) =>
  [t - from, actor, to, kind, amount, weapon, quality, repairType, ewar],
)
const source = 'Real J125990 full-battle analysis from fixtures/real/j125990-20250622/load.ts, limited to the two gallery pilots named on c5-p-a and c7-f-a. Event source references are omitted from this display fixture.'
writeFileSync(new URL('./u7-pilot-events.json', import.meta.url),
  JSON.stringify({ source, from, events, ewars: ewarSpans.filter(involvesPilot) }) + '\n',
)
