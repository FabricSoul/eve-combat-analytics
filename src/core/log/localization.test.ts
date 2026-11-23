import { describe, expect, it } from 'vitest'
import { parseGamelog } from './parse'

function parseLine(line: string, language: 'en' | 'zh') {
  const header = language === 'en'
    ? ['Gamelog', 'Listener: Lunar Finch', 'Session Started: 2025.06.22 15:38:00']
    : ['游戏记录', '收听者: Lunar Finch', '进程开始: 2025.06.22 15:38:00']
  return parseGamelog([...header, '[ 2025.06.22 15:57:39 ] ' + line].join('\n'))
}

const capsule = "Capsule - Genolution 'Auroral' 197-variant"
const zhCapsule = '太空舱 - 格鲁汀 曙光 197-衍生型*'
const smartbomb = 'Federation Navy Large Plasma Smartbomb'

describe('localized combat names', () => {
  it('keeps the capsule skin separate from the weapon on the real Chinese smartbomb hit', () => {
    const zh = parseLine(
      `(combat) <color=0xff00ffff><b>195</b> <color=0x77ffffff><font size=10>对</font> <b><color=0xffffffff>Tallanvor[NVACA](<localized hint="${capsule}">${zhCapsule})</b><font size=10><color=0x77ffffff> - <localized hint="${smartbomb}">联邦海军大型等离子立体炸弹*</localized> - 命中`,
      'zh',
    )
    expect(zh.unparsed).toEqual([])
    expect(zh.events).toMatchObject([{
      kind: 'damage', amount: 195, quality: 'Hits', weapon: smartbomb,
      other: { raw: `Tallanvor[NVACA](${zhCapsule})`, name: 'Tallanvor', corpTicker: 'NVACA', shipType: capsule, shipTypeId: 33328 },
    }])
  })

  it('produces the same weapon and capsule type for equivalent English and Chinese hits', () => {
    const en = parseLine(`(combat) 195 to Lunar Vale[RAY](${capsule}) - ${smartbomb} - Hits`, 'en')
    const zh = parseLine(`(combat) 195 对 Lunar Vale[RAY](<localized hint="${capsule}">${zhCapsule}</localized>) - <localized hint="${smartbomb}">联邦海军大型等离子立体炸弹*</localized> - 命中`, 'zh')
    expect(en.unparsed).toEqual([])
    expect(zh.unparsed).toEqual([])
    const expected = {
      kind: 'damage', weapon: smartbomb, other: { name: 'Lunar Vale', corpTicker: 'RAY', shipType: capsule, shipTypeId: 33328 },
    }
    expect(en.events).toMatchObject([expected])
    expect(zh.events).toMatchObject([expected])
  })

  it('protects brackets, a closed localized module with a dash, and a fused ship alias', () => {
    const en = parseLine('(combat) 300 remote armor repaired to Leshak [Lunar - Vale] - Large Remote Armor Repairer II', 'en')
    const zh = parseLine('(combat) 300远程装甲维修量至Lunar Vale<localized hint="Leshak">实验舰名*</b> - <localized hint="Proof - Repair Unit"><b>试验 - 维修装置</b></localized>', 'zh')
    expect(en.unparsed).toEqual([])
    expect(en.events).toMatchObject([{
      kind: 'repair', module: 'Large Remote Armor Repairer II',
      other: { name: 'Lunar - Vale', shipType: 'Leshak', shipTypeId: 47271 },
    }])
    expect(zh.unparsed).toEqual([])
    expect(zh.events).toMatchObject([{
      kind: 'repair', module: 'Proof - Repair Unit',
      other: { name: 'Lunar Vale', raw: 'Lunar Vale实验舰名*', shipType: 'Leshak', shipTypeId: 47271 },
    }])
  })

  it('uses hints for NPCs and an implicitly closed localized weapon before the miss wording', () => {
    const result = parseLine('(combat) 你的<localized hint="Proof - Gun">试验 - 炮*完全没有打中<localized hint="Coreli Guardian Initiate">天蛇测试哨兵* - <localized hint="Proof - Gun">试验 - 炮*</localized>', 'zh')
    expect(result.unparsed).toEqual([])
    expect(result.events).toMatchObject([{
      kind: 'miss', weapon: 'Proof - Gun', other: { raw: '天蛇测试哨兵*', name: 'Coreli Guardian Initiate' },
    }])
  })

  it('preserves a complete localized NPC name that starts with a dictionary hull', () => {
    const result = parseLine('(combat) 195来自<localized hint="Bhaalgorn Officer">实验 - 哨兵*</localized> - 命中', 'zh')
    expect(result.unparsed).toEqual([])
    expect(result.events).toMatchObject([{
      kind: 'damage', weapon: null,
      other: { raw: '实验 - 哨兵*', name: 'Bhaalgorn Officer', shipType: null, shipTypeId: null },
    }])
  })
})
