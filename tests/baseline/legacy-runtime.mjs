import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const pages = {
  '2d': 'quote/临界·模块化·2D版.html',
  '3d': 'quote/临界·模块化·3D版.html',
}

const sourceCache = new Map()

function sourceFor(edition) {
  if (sourceCache.has(edition)) return sourceCache.get(edition)
  const path = pages[edition]
  if (!path) throw new Error('Unknown legacy edition: ' + edition)
  const bytes = readFileSync(new URL('../../' + path, import.meta.url))
  const html = bytes.toString('utf8')
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1])
  const rules = scripts.find(script => script.includes('function startGame(playerDeck, aiDeck)'))
  const shared = scripts.find(script => script.includes('function drawCard(p)'))
  const surrender = html.match(/<button id="btn-surrender"[^>]* onclick="([^"]+)"/)?.[1]
  if (!rules || !shared || !surrender) throw new Error('Legacy rules, shared logic or surrender entry missing')
  const source = { path, sha256: createHash('sha256').update(bytes).digest('hex'), rules, shared, surrender }
  sourceCache.set(edition, source)
  return source
}

function makeDom() {
  const elements = new Map()
  let checkedResponse = null

  function createElement() {
    return {
      textContent: '',
      innerHTML: '',
      addEventListener() {},
      remove() {},
      style: { setProperty() {} },
      classList: { add() {}, remove() {} },
      childNodes: [],
      appendChild(child) { this.childNodes.push(child) },
      removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1) },
    }
  }

  return {
    setResponse(value) { checkedResponse = value },
    document: {
      createElement,
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement())
        return elements.get(id)
      },
      querySelector() { return checkedResponse === null ? null : { value: checkedResponse } },
      querySelectorAll(selector) {
        return selector === '#resp-groups input[type=radio]:checked' && checkedResponse !== null
          ? [{ value: checkedResponse }]
          : []
      },
    },
  }
}

// Instrument only adapters and selected observation points. Both game script blocks run
// unchanged. Sort interception replaces only the legacy random comparator with a fixed
// deck permutation; the ice-pool Fisher–Yates loop executes with explicit samples.
const setup = `
  let fixtureRandom = []
  let fixtureShuffles = []
  let observedRandom = []
  let trace = []
  let attackReplay = null
  let cardIds = new WeakMap()
  let nextCardId = 0

  const nativeSort = Array.prototype.sort
  Array.prototype.sort = function(compare) {
    if (typeof compare !== 'function' || !/^\\(\\)=>Math\\.random\\(\\)-0\\.5$/.test(compare.toString())) {
      return nativeSort.call(this, compare)
    }
    if (this.length === 0) return this
    const drawOrder = fixtureShuffles.shift()
    if (!drawOrder) throw Error('Undeclared legacy shuffle')
    const boxes = new Map()
    for (const card of this) {
      if (!boxes.has(card.name)) boxes.set(card.name, [])
      boxes.get(card.name).push(card)
    }
    if (drawOrder.length !== this.length) throw Error('Wrong shuffle input length')
    const planned = drawOrder.slice().reverse().map(name => {
      const card = boxes.get(name)?.shift()
      if (!card) throw Error('Wrong shuffle input card: ' + name)
      return card
    })
    this.splice(0, this.length, ...planned)
    observedRandom.push({ kind: 'deck-shuffle', drawOrder })
    return this
  }
  Math.random = () => {
    if (!fixtureRandom.length) throw Error('Undeclared legacy random draw')
    const value = fixtureRandom.shift()
    observedRandom.push({ kind: 'random', value })
    return value
  }

  render = () => {}
  renderSelect = () => {}
  renderGuide = () => {}
  sleep = async () => {}

  const originalLog = log
  log = message => {
    trace.push({ event: 'log', message })
    originalLog(message)
  }
  function seatOf(player) { return player === G.player ? 'A' : 'B' }
  function observe(name, args, project) {
    const original = window[name]
    window[name] = function (...input) {
      const event = { event: name, ...args(...input) }
      trace.push(event)
      const result = original.apply(this, input)
      if (project) Object.assign(event, project(result, ...input))
      return result
    }
  }
  observe('drawCard', p => ({
    seat: seatOf(p), handBefore: p.hand.length, lastGrave: p.grave.at(-1)?.name ?? null,
    boardAttackBefore: p.board.map(unit => ({ card: unit.card.name, atk: unitAtk(p, unit) })),
  }),
    (card, p) => ({ card: card?.name ?? null, handAfter: p.hand.length }))
  observe('damageUnit', (p, u, amount) => ({
    seat: seatOf(p), target: u.card.name, amount, hpBefore: u.hp,
    opposingGrave: (p === G.player ? G.ai : G.player).grave.at(-1)?.name ?? null,
  }),
    (_, p, u) => ({ hpAfter: u.hp }))
  observe('damageCore', (p, amount) => ({ seat: seatOf(p), amount, hpBefore: p.hp }),
    (_, p) => ({ hpAfter: p.hp }))
  observe('killUnit', (p, u) => ({ seat: seatOf(p), card: u.card.name, graveBefore: p.grave.length }),
    (_, p) => ({ graveAfter: p.grave.length }))
  observe('startTurn', p => ({ seat: seatOf(p), turnBefore: G.turn }),
    (_, p) => ({ turnAfter: G.turn, apAfter: p.ap }))
  observe('checkFinale', p => ({ seat: seatOf(p), graveTotal: graveTotal() }))
  observe('redrawFinale', (p, count) => ({ seat: seatOf(p), count }))
  observe('bcShuffleIce', p => ({ seat: seatOf(p), before: p.ice.map(c => c.name) }),
    (_, p) => ({ after: p.ice.map(c => c.name) }))
  observe('bcCanPlayNow', (p, card) => ({
    seat: seatOf(p), card: card.name, grave: p.grave.map(c => c.name),
  }), playable => ({ playable }))
  observe('endGame', (title, reason) => ({ title, reason }))

  function ref(card) {
    if (!cardIds.has(card)) cardIds.set(card, 'legacy-card-' + (++nextCardId))
    return { name: card.name, instanceId: cardIds.get(card) }
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function fixtureCard(name) {
    if (!Object.hasOwn(C, name)) throw Error('Unknown legacy card: ' + name)
    return { ...C[name] }
  }
  function playerState(input, template, seat) {
    const player = newPlayerFromDeck({name: template[seat], list: []})
    const {deck = [], hand = [], board = [], grave = [], facedown = [], ice = [], ...flags} = input
    return Object.assign(player, flags, {
      deck: deck.slice().reverse().map(fixtureCard), hand: hand.map(fixtureCard),
      board: board.map(({name, ...values}) => Object.assign(newUnit(fixtureCard(name)), values)),
      grave: grave.map(fixtureCard),
      facedown: facedown.map(name => ({card: fixtureCard(name)})),
      ice: ice.map(fixtureCard),
    })
  }
  function reset(input) {
    uidCounter = 0
    RP.rec = null
    trace = []
    observedRandom = []
    cardIds = new WeakMap()
    nextCardId = 0
    RESP.active = false
    RESP.decision = null
    RESP.groups = []
    RESP.resolve = null
    RESP.hitCore = null
    document.getElementById('resp-window').style.display = 'none'
    document.getElementById('hint').textContent = ''
    if (input.mode === 'before-start') { G = null; return }
    G = {
      player: playerState(input.seats.A, input.template, 'A'),
      ai: playerState(input.seats.B, input.template, 'B'),
      turn: input.turn,
      phase: input.phase,
      finale: null,
      winner: null,
      selecting: null,
      battleMode: input.battleMode ?? false,
      drQ: [],
    }
    RP.begin()
  }
  function seatState(player) {
    const { deck, hand, board, grave, facedown, ice, ...flags } = player
    return clone({
      ...flags,
      deck: deck.slice().reverse().map(ref),
      hand: hand.map(ref),
      board: board.map(unit => {
        const {card, ...fields} = unit
        return { ...ref(card), ...fields, atk: unitAtk(player, unit) }
      }),
      grave: grave.map(ref),
      facedown: facedown.map(f => ref(f.card)),
      ice: ice.map(ref),
    })
  }
  function snapshot() {
    if (!G) return null
    const seats = { A: seatState(G.player), B: seatState(G.ai) }
    const pending = RESP.active ? {
      kind: 'response',
      owner: 'A',
      groups: RESP.groups.map(group => ({ trigger: group.trigger, cards: group.cards.map(f => ref(f.card)) })),
      visibleTo: ['A'],
    } : G.bcPanel ? {
      kind: G.bcPanel.kind,
      owner: 'A',
      candidates: G.bcPanel.cands.map(ref),
      need: G.bcPanel.need,
      picked: G.bcPanel.picked,
      visibleTo: ['A'],
    } : null
    return clone({
      phase: G.phase,
      turn: G.turn,
      activeSeat: G.phase === 'ai-main' ? 'B' : 'A',
      finale: G.finale,
      winner: G.winner ? ({ player: 'A', ai: 'B', draw: 'draw' })[G.winner] : null,
      battleMode: G.battleMode,
      pending,
      selecting: G.selecting,
      effect: G.fx ? { card: G.fx.card.name, index: G.fx.idx, steps: G.fx.steps } : null,
      seats,
      replay: {
        actions: RP.rec?.actions.map(({ sig, ...action }) => action) ?? [],
        result: RP.rec?.result ?? null,
        archivedActions: RP._all().at(-1)?.actions.map(action => action.t) ?? [],
      },
    })
  }
  async function act(action) {
    trace = []
    observedRandom = []
    fixtureRandom = action.randomValues?.slice() ?? []
    fixtureShuffles = action.shuffleDrawOrders?.slice() ?? []
    const args = action.args ?? []
    switch (action.name) {
      case 'startGame': startGame(...args); break
      case 'mulligan': mulligan(); break
      case 'advanceOpeningWindow':
        // Move across the specified boundary without running any unscripted V6 actions.
        endTurn()
        startTurn(G.ai, G.player)
        break
      case 'playCard': playCard(...args); break
      case 'chooseUnit': handleSelect(null, ...args); break
      case 'startAttack': startAttack(...args); break
      case 'chooseCore':
        if (G.selecting?.type === 'attack') doAttack(G.selecting.unitIdx, {type:'core'})
        break
      case 'useSkill': useSkill(...args); break
      case 'killUnit': killUnit(G.player, G.player.board[args[0]]); break
      case 'endTurn': endTurn(); break
      case 'startAiTurn': startTurn(G.ai, G.player); break
      case 'aiAttackCore': {
        const attack = {aidx:args[0], tgt:{type:'core'}}
        attackReplay = aiReplayAnimated({seq:[attack]}, a => _v6ApplyAtk(G, a), G)
        if (!RESP.active) await attackReplay
        break
      }
      case 'confirmResponse':
        setResponse(args[0])
        confirmResponse()
        await attackReplay
        setResponse(null)
        break
      case 'chooseIce':
        bcPickToggle(args[0])
        confirmBcPanel()
        break
      case 'surrender':
        surrenderButton()
        break
      default: throw Error('Unknown legacy action: ' + action.name)
    }
    if (fixtureRandom.length || fixtureShuffles.length) throw Error('Unused declared legacy random input')
    return clone({ state: snapshot(), trace, random: observedRandom, hint: document.getElementById('hint').textContent })
  }
`

function makeRuntime(edition, archive = new Map()) {
  const source = sourceFor(edition)
  const dom = makeDom()
  const runtime = createContext({
    console,
    document: dom.document,
    setResponse: dom.setResponse,
    IMG: {},
    Image: class {},
    setTimeout() {},
    localStorage: {
      getItem: key => archive.get(key) ?? null,
      setItem: (key, value) => archive.set(key, value),
    },
  })
  runtime.window = runtime
  runInContext(source.rules, runtime, { filename: source.path + ':rules' })
  runInContext(source.shared, runtime, { filename: source.path + ':shared' })
  runInContext('const surrenderButton = () => { ' + source.surrender + ' };' + setup, runtime)
  return (code, input) => {
    runtime.serializedInput = JSON.stringify(input)
    runInContext('globalThis.input = serializedInput === undefined ? undefined : JSON.parse(serializedInput)', runtime)
    return runInContext(code, runtime)
  }
}

export function legacySourceMetadata(edition) {
  const { path, sha256 } = sourceFor(edition)
  return { path, sha256 }
}

export function legacyDefinitions(edition) {
  const runtime = makeRuntime(edition)
  const metadata = runtime('clone({ cardDefinitions: C, presets: { A: DECKS["燎原"], B: DECKS["玄冥"] } })')
  return structuredClone(metadata)
}

export async function captureLegacyScenario(edition, scenario) {
  const archive = new Map()
  let runtime = makeRuntime(edition, archive)
  runtime('reset(input)', scenario.initial)
  const initial = structuredClone(runtime('snapshot()'))
  const steps = []
  for (const { action } of scenario.steps) {
    if (action.name === 'restart') {
      runtime = makeRuntime(edition, archive)
      steps.push({
        state: structuredClone(runtime('snapshot()')),
        trace: [{ event: 'page-reload', archivedMatches: runtime('RP._all().length') }],
        random: [],
        hint: '',
      })
    } else {
      steps.push(structuredClone(await runtime('act(input)', action)))
    }
  }
  return { initial, steps }
}
