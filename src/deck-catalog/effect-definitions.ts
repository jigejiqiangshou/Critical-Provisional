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
    cardId: 'initial:yanwen', legacyName: '炎纹',
    source: 'quote/临界·模块化·2D版.html:562 effect',
    trigger: 'play', steps: [{ type: 'damage-unit', amount: 3, target: 'enemy' }, { type: 'draw', amount: 1 }],
  },
]

/** Each legacy rules-bearing field needs an explicit reviewed mapping. A field
 * mapped to an effect names the corresponding trigger; core mappings name the
 * existing versioned rule. Audits remain empty until reviewed end to end. */
interface EffectAudit {
  readonly legacyName: string
  readonly cardId: string
  readonly fields: Readonly<Record<string, { readonly kind: 'effect' | 'core'; readonly reference: string }>>
}
const effectAudits: readonly EffectAudit[] = []

/** Fail closed before a first release can consume this in-progress catalog.
 * The future release builder must call this before writing or packaging it. */
export function assertInitialEffectsReady(): void {
  const expected = new Map(legacySources.map(source => [source.name, source]))
  const capabilities = getRuleCapabilities(OFFICIAL_RULES_VERSION)
  if (!capabilities) throw new TypeError('Initial rules version is unavailable')
  const triggers = new Set<string>(capabilities.triggers)
  const effects = new Set<string>(capabilities.effects)
  const namesById = new Map<string, string>()
  const idsByName = new Map<string, string>()
  for (const definition of initialEffectDefinitions) {
    if (!expected.has(definition.legacyName)) throw new TypeError(`Unknown legacy card: ${definition.legacyName}`)
    const priorName = namesById.get(definition.cardId)
    const priorId = idsByName.get(definition.legacyName)
    if ((priorName && priorName !== definition.legacyName) || (priorId && priorId !== definition.cardId)) {
      throw new TypeError(`Conflicting stable ID: ${definition.cardId}`)
    }
    namesById.set(definition.cardId, definition.legacyName)
    idsByName.set(definition.legacyName, definition.cardId)
    if (!triggers.has(definition.trigger)) throw new TypeError(`Unknown trigger: ${definition.trigger}`)
    for (const step of definition.steps) {
      if (!effects.has(step.type)) throw new TypeError(`Unimplemented effect: ${step.type}`)
    }
  }
  const audited = new Set<string>()
  for (const audit of effectAudits) {
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
      if (mapping.kind === 'effect' && !initialEffectDefinitions.some(definition =>
        definition.cardId === audit.cardId && definition.trigger === mapping.reference && definition.steps.length > 0)) {
        throw new TypeError(`Unimplemented effect mapping: ${audit.legacyName}`)
      }
    }
    audited.add(audit.legacyName)
  }
  const incomplete = [...expected.keys()].filter(name => !audited.has(name))
  if (incomplete.length) throw new TypeError(`Initial effect migration incomplete: ${incomplete.length} cards`)
}
