import type { OfficialEffect, OfficialTrigger } from '../match/official-state'
import { OFFICIAL_RULES_VERSION } from '../match/official-state'
import { getRuleCapabilities } from '../match/official-rules'
import legacySources from './legacy-card-sources.json'

/** Source-traceable definitions under migration. This list is deliberately
 * incomplete and must not be treated as an initial release or a coverage gate. */
export interface InitialEffectDefinition {
  readonly cardId: string
  readonly legacyName: string
  readonly source: string
  readonly trigger: OfficialTrigger
  readonly timing?: 'immediate' | 'after-action'
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
    trigger: 'play', steps: [{ type: 'damage-unit', amount: 5, target: 'enemy' }],
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
    cardId: 'initial:sanmeizhenhuo', legacyName: '三昧真火',
    source: 'quote/临界·模块化·2D版.html:571 effect',
    trigger: 'play', steps: [{ type: 'lock-field', attr: '朱雀' }, { type: 'destroy-unit', target: 'enemy' }],
  },
  {
    cardId: 'initial:yanmie', legacyName: '湮灭',
    source: 'quote/临界·模块化·2D版.html:656 effect',
    trigger: 'play', steps: [{ type: 'lock-own-attacks' }, { type: 'destroy-unit', target: 'enemy' }],
  },
  {
    cardId: 'initial:jinwu', legacyName: '金乌',
    source: 'quote/临界·模块化·2D版.html:560 passive',
    trigger: 'attack-core', steps: [{ type: 'bonus-core-attack', amount: 2 }],
  },
  {
    cardId: 'initial:sanzujinwu', legacyName: '三足金乌',
    source: 'quote/临界·模块化·2D版.html:567 passive',
    trigger: 'attack-core', steps: [{ type: 'bonus-core-attack', amount: 2 }],
  },
  {
    cardId: 'initial:tianlang', legacyName: '天狼',
    source: 'quote/临界·模块化·2D版.html:607 passive',
    trigger: 'attack-core', steps: [{ type: 'bonus-core-attack', amount: 1 }],
  },
  {
    cardId: 'initial:liaoyuan', legacyName: '燎原',
    source: 'quote/临界·模块化·2D版.html:566 effect',
    trigger: 'play', steps: [{ type: 'lock-field', attr: '朱雀' }, { type: 'damage-all-enemies', amount: 3, pierce: false }],
  },
  {
    cardId: 'initial:zhurong', legacyName: '祝融',
    source: 'quote/临界·模块化·2D版.html:570 skill.effect',
    trigger: 'skill', steps: [{ type: 'lock-own-attacks' }, { type: 'damage-all-enemies', amount: 2, pierce: false }],
  },
  {
    cardId: 'initial:rushou', legacyName: '蓐收',
    source: 'quote/临界·模块化·2D版.html:615 skill.effect',
    trigger: 'skill', steps: [{ type: 'damage-all-enemies', amount: 2, pierce: false }],
  },
  {
    cardId: 'initial:baihong', legacyName: '白虹',
    source: 'quote/临界·模块化·2D版.html:620 effect',
    trigger: 'play', steps: [{ type: 'lock-field', attr: '白虎' }, { type: 'damage-all-enemies', amount: 4, pierce: true }],
  },
  {
    cardId: 'initial:huoya', legacyName: '火鸦',
    source: 'quote/临界·模块化·2D版.html:559 skill.effect',
    trigger: 'skill', steps: [{ type: 'register-death-attack-bonus', amount: 1 }],
  },
  {
    cardId: 'initial:zhenyue', legacyName: '镇岳',
    source: 'quote/临界·模块化·2D版.html:661 trap.effect',
    trigger: 'attack-core', steps: [{ type: 'cancel-attack' }],
  },
  {
    cardId: 'initial:fubing', legacyName: '伏兵',
    source: 'quote/临界·模块化·2D版.html:675 trap.effect',
    trigger: 'attack-core', steps: [{ type: 'draw', amount: 2 }],
  },
  {
    cardId: 'initial:cangfeng', legacyName: '藏锋',
    source: 'quote/临界·模块化·2D版.html:663 trap.effect',
    trigger: 'attack-unit', steps: [{ type: 'cancel-attack' }],
  },
  {
    cardId: 'initial:tanzhu', legacyName: '探珠',
    source: 'quote/临界·模块化·2D版.html:697 skill.effect',
    trigger: 'skill', steps: [{ type: 'ice-draw-pick', amount: 3 }],
  },
  {
    cardId: 'initial:zhuyan', legacyName: '朱厌',
    source: 'quote/临界·模块化·2D版.html:568 passive',
    trigger: 'attack-unit', steps: [{ type: 'pre-strike', amount: 1 }],
  },
  {
    cardId: 'initial:duanjin', legacyName: '断金',
    source: 'quote/临界·模块化·2D版.html:610 effect',
    trigger: 'play', steps: [{ type: 'damage-unit', target: 'enemy', amount: 8, pierce: true, requiresShield: true }],
  },
  {
    cardId: 'initial:ruoshui', legacyName: '弱水',
    source: 'quote/临界·模块化·2D版.html:590 effect',
    trigger: 'play', steps: [{ type: 'stun-unit', target: 'enemy' }],
  },
  {
    cardId: 'initial:fulongsuo', legacyName: '缚龙索',
    source: 'quote/临界·模块化·2D版.html:636 effect',
    trigger: 'play', steps: [{ type: 'stun-unit', target: 'enemy' }, { type: 'damage-unit', target: 'enemy', amount: 2 }],
  },
  {
    cardId: 'initial:ningshuang', legacyName: '凝霜',
    source: 'quote/临界·模块化·2D版.html:592 effect',
    trigger: 'play', steps: [{ type: 'shield-unit', amount: 5, target: 'own' }],
  },
  {
    cardId: 'initial:bingwei', legacyName: '冰尉',
    source: 'quote/临界·模块化·2D版.html:586 enter',
    trigger: 'enter', steps: [{ type: 'shield-all-own', amount: 1, excludeSource: true }],
  },
  {
    cardId: 'initial:xuanwuzhiming', legacyName: '玄武·执明',
    source: 'quote/临界·模块化·2D版.html:585 skill.effect',
    trigger: 'skill', steps: [{ type: 'shield-all-own', amount: 2, excludeSource: false }],
  },
  {
    cardId: 'initial:zhuyan', legacyName: '朱厌',
    source: 'quote/临界·模块化·2D版.html:568 passive',
    trigger: 'attack-core', steps: [{ type: 'pre-strike', amount: 1 }],
  },
  {
    cardId: 'initial:gonggong', legacyName: '共工',
    source: 'quote/临界·模块化·2D版.html:588 enter',
    trigger: 'enter', steps: [{ type: 'discard-hand', amount: 1 }],
  },
  {
    cardId: 'initial:yuantong', legacyName: '渊瞳',
    source: 'quote/临界·模块化·2D版.html:594 enter',
    trigger: 'enter', steps: [{ type: 'discard-hand', amount: 1 }, { type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:baize', legacyName: '白泽',
    source: 'quote/临界·模块化·2D版.html:659 skill.effect',
    trigger: 'skill', steps: [{ type: 'draw', amount: 1 }],
  },
  {
    cardId: 'initial:yanyu', legacyName: '焰羽',
    source: 'quote/临界·模块化·2D版.html:561 enter',
    trigger: 'enter', steps: [{ type: 'look-pick', top: 5, kind: 'unit' }],
  },
  {
    cardId: 'initial:xinghuo', legacyName: '星火',
    source: 'quote/临界·模块化·2D版.html:648 effect',
    trigger: 'play', steps: [{ type: 'look-pick', top: 3 }],
  },
  {
    cardId: 'initial:zhengbei', legacyName: '整备',
    source: 'quote/临界·模块化·2D版.html:650 effect',
    trigger: 'play', steps: [{ type: 'look-pick', top: 8, kind: 'unit' }],
  },
  {
    cardId: 'initial:lingguang', legacyName: '朱雀·陵光',
    source: 'quote/临界·模块化·2D版.html:569 enter',
    trigger: 'enter', steps: [{ type: 'search-deck', amount: 1, kind: 'spell', attr: '朱雀' }],
  },
  {
    cardId: 'initial:zhengzhao', legacyName: '征召',
    source: 'quote/临界·模块化·2D版.html:574 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '朱雀' }],
  },
  {
    cardId: 'initial:xuanwuzhiming', legacyName: '玄武·执明',
    source: 'quote/临界·模块化·2D版.html:585 enter',
    trigger: 'enter', steps: [{ type: 'search-deck', amount: 1, kind: 'spell', attr: '玄武' }],
  },
  {
    cardId: 'initial:xuanzhao', legacyName: '玄召',
    source: 'quote/临界·模块化·2D版.html:597 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '玄武' }],
  },
  {
    cardId: 'initial:jianbing', legacyName: '白虎·监兵',
    source: 'quote/临界·模块化·2D版.html:618 enter',
    trigger: 'enter', steps: [{ type: 'search-deck', amount: 1, kind: 'spell', attr: '白虎' }],
  },
  {
    cardId: 'initial:huben', legacyName: '虎贲',
    source: 'quote/临界·模块化·2D版.html:622 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '白虎' }],
  },
  {
    cardId: 'initial:mengzhang', legacyName: '青龙·孟章',
    source: 'quote/临界·模块化·2D版.html:632 enter',
    trigger: 'enter', steps: [{ type: 'search-deck', amount: 1, kind: 'spell', attr: '青龙' }],
  },
  {
    cardId: 'initial:qingdishi', legacyName: '青帝侍',
    source: 'quote/临界·模块化·2D版.html:641 enter',
    trigger: 'enter', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', names: ['青苗'] }],
  },
  {
    cardId: 'initial:yulu', legacyName: '雨露',
    source: 'quote/临界·模块化·2D版.html:642 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '青龙' }],
  },
  {
    cardId: 'initial:yinlu', legacyName: '引路',
    source: 'quote/临界·模块化·2D版.html:647 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'spell' }],
  },
  {
    cardId: 'initial:xunmiao', legacyName: '寻苗',
    source: 'quote/临界·模块化·2D版.html:665 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, evoStage: 1 }],
  },
  {
    cardId: 'initial:xunguo', legacyName: '寻果',
    source: 'quote/临界·模块化·2D版.html:666 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, evoStageMin: 2 }],
  },
  {
    cardId: 'initial:junling', legacyName: '军令',
    source: 'quote/临界·模块化·2D版.html:667 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, attackMin: 4 }],
  },
  {
    cardId: 'initial:tiebi', legacyName: '铁壁',
    source: 'quote/临界·模块化·2D版.html:668 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, healthMin: 6 }],
  },
  {
    cardId: 'initial:pojia', legacyName: '破甲',
    source: 'quote/临界·模块化·2D版.html:669 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', keyword: '穿透' }],
  },
  {
    cardId: 'initial:yijin', legacyName: '遗烬',
    source: 'quote/临界·模块化·2D版.html:670 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', keyword: '遗蜕' }],
  },
  {
    cardId: 'initial:bilei', legacyName: '壁垒',
    source: 'quote/临界·模块化·2D版.html:671 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, kind: 'unit', keyword: '守护' }],
  },
  {
    cardId: 'initial:guiyuan', legacyName: '归源',
    source: 'quote/临界·模块化·2D版.html:703 effect',
    trigger: 'play', steps: [{ type: 'search-deck', amount: 1, names: ['输川', '引流', '承波', '蓄塘'] }],
  },
  {
    cardId: 'initial:lingguang', legacyName: '朱雀·陵光',
    source: 'quote/临界·模块化·2D版.html:569 skill.effect',
    trigger: 'skill', steps: [{ type: 'damage-unit', amount: 5, target: 'enemy' }],
  },
  {
    cardId: 'initial:lienyanbenxi', legacyName: '烈焰奔袭',
    source: 'quote/临界·模块化·2D版.html:565 effect',
    trigger: 'play', steps: [{ type: 'buff-unit', target: 'own', attack: 1, health: 0, rush: true, attr: '朱雀' }],
  },
  {
    cardId: 'initial:mengzhang', legacyName: '青龙·孟章',
    source: 'quote/临界·模块化·2D版.html:632 skill.effect',
    trigger: 'skill', steps: [{ type: 'buff-unit', target: 'own', attack: 2, health: 2 }],
  },
  {
    cardId: 'initial:jumang', legacyName: '句芒',
    source: 'quote/临界·模块化·2D版.html:633 skill.effect',
    trigger: 'skill', steps: [{ type: 'lock-field', attr: '青龙' }, { type: 'buff-unit', target: 'own', attack: 2, health: 2 }],
  },
  {
    cardId: 'initial:mujia', legacyName: '木甲',
    source: 'quote/临界·模块化·2D版.html:635 effect',
    trigger: 'play', steps: [{ type: 'buff-unit', target: 'own', attack: 3, health: 3 }],
  },
  {
    cardId: 'initial:chunyu', legacyName: '春雨',
    source: 'quote/临界·模块化·2D版.html:637 effect',
    trigger: 'play', steps: [{ type: 'buff-unit', target: 'own', attack: 1, health: 1 }, { type: 'shield-unit', target: 'own', amount: 1 }],
  },
  {
    cardId: 'initial:qingcui', legacyName: '青翠',
    source: 'quote/临界·模块化·2D版.html:638 effect',
    trigger: 'play', steps: [{ type: 'buff-unit', target: 'own', attack: 2, health: 2 }],
  },
  {
    cardId: 'initial:zhuqueyu', legacyName: '朱雀羽',
    source: 'quote/临界·模块化·2D版.html:579 deathrattle',
    timing: 'after-action', trigger: 'death', steps: [{ type: 'hand-cost', amount: 1, canPass: true, onSelect: [{ type: 'draw', amount: 2 }] }],
  },
  {
    cardId: 'initial:xuelian', legacyName: '血涟',
    source: 'quote/临界·模块化·2D版.html:595 effect',
    trigger: 'play', steps: [{ type: 'pay-life', amount: 3 }, { type: 'shield-unit', target: 'own', amount: 3 },
      { type: 'look-pick', top: 8, kind: 'unit', attr: '玄武' }],
  },
  {
    cardId: 'initial:chongshi', legacyName: '重筮',
    source: 'quote/临界·模块化·2D版.html:677 effect',
    trigger: 'play', steps: [{ type: 'discard-all-hand' }, { type: 'draw', amount: 4 }],
  },
  {
    cardId: 'initial:boming', legacyName: '搏命',
    source: 'quote/临界·模块化·2D版.html:678 effect',
    trigger: 'play', steps: [{ type: 'pay-life', amount: 'half' }, { type: 'draw', amount: 5 }],
  },
  {
    cardId: 'initial:fenghuoling', legacyName: '烽火令',
    source: 'quote/临界·模块化·2D版.html:563 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 1, canPass: false,
      onSelect: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '朱雀' }] }],
  },
  {
    cardId: 'initial:hanyuan', legacyName: '寒渊',
    source: 'quote/临界·模块化·2D版.html:589 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 2, canPass: false,
      onSelect: [{ type: 'search-deck', amount: 2, kind: 'unit', attr: '玄武' }] }],
  },
  {
    cardId: 'initial:hufu', legacyName: '虎符',
    source: 'quote/临界·模块化·2D版.html:617 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 1, canPass: false,
      onSelect: [{ type: 'look-pick', top: 8, kind: 'unit', attr: '白虎' }] }],
  },
  {
    cardId: 'initial:yuanyin', legacyName: '渊引',
    source: 'quote/临界·模块化·2D版.html:596 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 2, canPass: false,
      onSelect: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '玄武' }] }],
  },
  {
    cardId: 'initial:yizai', legacyName: '移栽',
    source: 'quote/临界·模块化·2D版.html:639 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 1, canPass: false,
      onSelect: [{ type: 'search-deck', amount: 1, kind: 'unit', attr: '青龙' }] }],
  },
  {
    cardId: 'initial:xushi', legacyName: '蓄势',
    source: 'quote/临界·模块化·2D版.html:649 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 1, canPass: false,
      onSelect: [{ type: 'draw', amount: 2 }] }],
  },
  {
    cardId: 'initial:liuzhuan', legacyName: '流转',
    source: 'quote/临界·模块化·2D版.html:672 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 1, canPass: false,
      onSelect: [{ type: 'draw', amount: 1 }] }],
  },
  {
    cardId: 'initial:qingcang', legacyName: '清仓',
    source: 'quote/临界·模块化·2D版.html:673 effect',
    trigger: 'play', steps: [{ type: 'hand-cost', amount: 3, canPass: false,
      onSelect: [{ type: 'draw', amount: 2 }] }],
  },
  {
    cardId: 'initial:suyuan', legacyName: '溯源',
    source: 'quote/临界·模块化·2D版.html:657 effect',
    trigger: 'play', steps: [{ type: 'recover-discard', amount: 1 }],
  },
  {
    cardId: 'initial:duihuan', legacyName: '兑换',
    source: 'quote/临界·模块化·2D版.html:658 effect',
    trigger: 'play', steps: [{ type: 'recover-discard', amount: 1, kind: 'spell' }],
  },
  {
    cardId: 'initial:huiliu', legacyName: '回流',
    source: 'quote/临界·模块化·2D版.html:604 effect',
    trigger: 'play', steps: [{ type: 'lock-own-attacks' }, { type: 'hand-cost', amount: 2, canPass: false,
      onSelect: [{ type: 'recover-discard', amount: 1 }] }],
  },
  {
    cardId: 'initial:yanwen', legacyName: '炎纹',
    source: 'quote/临界·模块化·2D版.html:562 effect',
    trigger: 'play', steps: [{ type: 'damage-unit', amount: 3, target: 'enemy' }, { type: 'draw', amount: 1 }],
  },
]

/** Each legacy rules-bearing field needs an explicit reviewed mapping. A field
 * mapped to an effect names the corresponding trigger; core mappings name the
 * existing versioned rule. Audits remain empty until reviewed end to end. */
export interface EffectAudit {
  readonly legacyName: string
  readonly cardId: string
  readonly fields: Readonly<Record<string, { readonly kind: 'effect' | 'core'; readonly reference: string }>>
  /** Each legacy typed step maps to its own trigger:index[.childIndex...]:type in the new definition. */
  readonly steps: Readonly<Record<string, string>>
}
const effectAudits: readonly EffectAudit[] = []

/** Fail closed before a first release can consume this in-progress catalog.
 * The future release builder must call this before writing or packaging it. */
export function validateInitialEffectAudits(audits: readonly EffectAudit[]): void {
  const expected = new Map(legacySources.map(source => [source.name, source]))
  const capabilities = getRuleCapabilities(OFFICIAL_RULES_VERSION)
  if (!capabilities) throw new TypeError('Initial rules version is unavailable')
  const triggers = new Set<string>(capabilities.triggers)
  const effects = new Set<string>(capabilities.effects)
  const namesById = new Map<string, string>()
  const idsByName = new Map<string, string>()
  const registrations = new Set<string>()
  for (const definition of initialEffectDefinitions) {
    if (!expected.has(definition.legacyName)) throw new TypeError(`Unknown legacy card: ${definition.legacyName}`)
    const priorName = namesById.get(definition.cardId)
    const priorId = idsByName.get(definition.legacyName)
    if ((priorName && priorName !== definition.legacyName) || (priorId && priorId !== definition.cardId)) {
      throw new TypeError(`Conflicting stable ID: ${definition.cardId}`)
    }
    const registration = `${definition.cardId}|${definition.trigger}`
    if (registrations.has(registration)) throw new TypeError(`Duplicate effect registration: ${registration}`)
    registrations.add(registration)
    namesById.set(definition.cardId, definition.legacyName)
    idsByName.set(definition.legacyName, definition.cardId)
    if (!triggers.has(definition.trigger)) throw new TypeError(`Unknown trigger: ${definition.trigger}`)
    const verifyStep = (step: OfficialEffect): void => {
      if (!effects.has(step.type)) throw new TypeError(`Unimplemented effect: ${step.type}`)
      if (step.type === 'hand-cost') step.onSelect.forEach(verifyStep)
    }
    definition.steps.forEach(verifyStep)
  }
  const audited = new Set<string>()
  for (const audit of audits) {
    const source = expected.get(audit.legacyName)
    if (!source || audited.has(audit.legacyName) || !audit.cardId) throw new TypeError('Invalid initial effect audit coverage')
    const previousName = namesById.get(audit.cardId)
    const previousId = idsByName.get(audit.legacyName)
    if ((previousName && previousName !== audit.legacyName) || (previousId && previousId !== audit.cardId)) {
      throw new TypeError(`Conflicting stable ID: ${audit.cardId}`)
    }
    namesById.set(audit.cardId, audit.legacyName)
    idsByName.set(audit.legacyName, audit.cardId)
    const fields = Object.keys(audit.fields)
    if (fields.length !== source.ruleFields.length || source.ruleFields.some(field => !fields.includes(field))) {
      throw new TypeError(`Unreviewed rules field: ${audit.legacyName}`)
    }
    for (const mapping of Object.values(audit.fields)) {
      if (!mapping.reference) throw new TypeError(`Missing rule reference: ${audit.legacyName}`)
      if (mapping.kind === 'core') {
        // No core-field reference has yet completed the source-to-rule audit.
        throw new TypeError(`Unverified core rule: ${mapping.reference}`)
      }
      if (mapping.kind !== 'effect') throw new TypeError(`Unknown rule mapping: ${audit.legacyName}`)
      const [trigger, effectType] = mapping.reference.split(':')
      if (!trigger || !effectType || !initialEffectDefinitions.some(definition =>
        definition.cardId === audit.cardId && definition.trigger === trigger &&
        definition.steps.some(step => step.type === effectType))) {
        throw new TypeError(`Unimplemented effect mapping: ${audit.legacyName}`)
      }
    }
    const requiredSteps = source.sourceSteps.map(step => step.path)
    const mappedSteps = Object.keys(audit.steps)
    if (mappedSteps.length !== requiredSteps.length || requiredSteps.some(path => !mappedSteps.includes(path))) {
      throw new TypeError(`Unreviewed legacy step: ${audit.legacyName}`)
    }
    const usedSteps = new Set<string>()
    for (const [path, reference] of Object.entries(audit.steps)) {
      const [trigger, indexText, effectType, extra] = reference.split(':')
      const validPath = /^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(indexText ?? '')
      const indexes = validPath ? indexText.split('.').map(Number) : []
      const registration = initialEffectDefinitions.find(definition =>
        definition.cardId === audit.cardId && definition.trigger === trigger)
      let step = registration?.steps[indexes[0]]
      for (const index of indexes.slice(1)) step = step?.type === 'hand-cost' ? step.onSelect[index] : undefined
      if (!trigger || !effectType || extra !== undefined || !validPath || usedSteps.has(reference) || step?.type !== effectType) {
        throw new TypeError(`Unimplemented legacy step: ${audit.legacyName}.${path}`)
      }
      usedSteps.add(reference)
    }
    audited.add(audit.legacyName)
  }
  const incomplete = [...expected.keys()].filter(name => !audited.has(name))
  if (incomplete.length) throw new TypeError(`Initial effect migration incomplete: ${incomplete.length} cards`)
}

export function assertInitialEffectsReady(): void {
  validateInitialEffectAudits(effectAudits)
}
