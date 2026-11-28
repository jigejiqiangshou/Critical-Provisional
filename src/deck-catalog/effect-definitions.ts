import type { OfficialEffect, OfficialTrigger } from '../match/official-state'

/** Source-traceable definitions under migration. This list is deliberately
 * incomplete and must not be treated as an initial release or a coverage gate. */
export interface InitialEffectDefinition {
  readonly cardId: string
  readonly legacyName: string
  readonly source: string
  readonly trigger: OfficialTrigger
  readonly steps: readonly OfficialEffect[]
}

export const initialEffectDefinitions: readonly InitialEffectDefinition[] = [
  {
    cardId: 'initial:bifang', legacyName: '毕方',
    source: 'quote/临界·模块化·2D版.html:558 deathrattle',
    trigger: 'death', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:bingyi', legacyName: '冰夷',
    source: 'quote/临界·模块化·2D版.html:582 deathrattle',
    trigger: 'death', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:qingmiao', legacyName: '青苗',
    source: 'quote/临界·模块化·2D版.html:627 deathrattle',
    trigger: 'death', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:lihuo', legacyName: '离火',
    source: 'quote/临界·模块化·2D版.html:564 effect',
    trigger: 'play', steps: [{ type: 'damage-unit', amount: 5, target: 'any' }],
  },
  {
    cardId: 'initial:qingluan', legacyName: '青鸾',
    source: 'quote/临界·模块化·2D版.html:625 enter',
    trigger: 'enter', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:chuanxun', legacyName: '传讯',
    source: 'quote/临界·模块化·2D版.html:646 effect',
    trigger: 'play', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:dongcha', legacyName: '洞察',
    source: 'quote/临界·模块化·2D版.html:645 effect',
    trigger: 'play', steps: [{ type: 'draw', amount: 2 }],
  },
  {
    cardId: 'initial:chunfeng', legacyName: '春风',
    source: 'quote/临界·模块化·2D版.html:634 effect',
    trigger: 'play', steps: [{ type: 'heal-core', amount: 5 }],
  },
  {
    cardId: 'initial:fusu', legacyName: '复苏',
    source: 'quote/临界·模块化·2D版.html:654 effect',
    trigger: 'play', steps: [{ type: 'heal-core', amount: 8 }],
  },
  {
    cardId: 'initial:huitian', legacyName: '回天',
    source: 'quote/临界·模块化·2D版.html:655 effect',
    trigger: 'play', steps: [{ type: 'heal-core', amount: 12 }],
  },
  {
    cardId: 'initial:qilin', legacyName: '麒麟',
    source: 'quote/临界·模块化·2D版.html:660 enter',
    trigger: 'enter', steps: [{ type: 'heal-core', amount: 3 }],
  },
  {
    cardId: 'initial:guixi', legacyName: '龟息',
    source: 'quote/临界·模块化·2D版.html:593 effect',
    trigger: 'play', steps: [{ type: 'heal-core', amount: 6 }, { type: 'shield-core', amount: 3 }],
  },
  {
    cardId: 'initial:yanwen', legacyName: '炎纹',
    source: 'quote/临界·模块化·2D版.html:562 effect',
    trigger: 'play', steps: [{ type: 'damage-unit', amount: 3, target: 'any' }, { type: 'draw', amount: 1 }],
  },
]
