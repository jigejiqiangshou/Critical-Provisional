import { describe, expect, it } from 'vitest'
import { PlayerInterface } from '../../src/match/player-interface'
import type { CoreAdjudication } from '../../src/match/player-interface'
import type { CommandReceipt, CommandRequestSummary, JsonValue } from '../../src/match/player-protocol'

const sessionId = 'match-1'
const originalVersion = { major: 1, minMinor: 0, maxMinor: 0 }
const compatibleVersion = { major: 1, minMinor: 0, maxMinor: 1 }
const alice = { type: 'seat' as const, seatId: 'A' }
const bob = { type: 'seat' as const, seatId: 'B' }
const spectator = { type: 'spectator' as const }
const digest = 'a'.repeat(64)

type TestScope = typeof alice | typeof spectator
type Versions = typeof originalVersion

type WireEvent = {
  readonly type: 'event'
  readonly interaction: 'M04'
  readonly sessionId: string
  readonly sequence: number
  readonly basis: string
  readonly event: { readonly type: string; readonly payload: unknown }
  readonly commandId?: string
}

type WireResponse = {
  readonly type: 'response'
  readonly interaction: 'M02' | 'M03'
  readonly requestId: string
  readonly result: {
    readonly status: string
    readonly reason?: string
    readonly receipt?: { readonly commandId: string; readonly result: unknown }
    readonly view?: {
      readonly scope: TestScope
      readonly basis: string
      readonly sequence: number
      readonly snapshot: unknown
    }
  }
}

type WireMessage = WireEvent | WireResponse | {
  readonly type: 'welcome' | 'handshake-rejected' | 'protocol-error'
  readonly [key: string]: unknown
}

interface TurnState {
  readonly turn: number
  readonly accountingUnits?: number
  readonly aliceCard?: string
}

type Player = PlayerInterface<TurnState>

function clientFor(
  player: Player,
  name: string,
  timeline: Array<{ client: string; message: WireMessage | 'close' }> = [],
  onSend?: (message: WireMessage) => void,
) {
  const messages: WireMessage[] = []
  let closes = 0
  const connection = player.connect(name, {
    send(message) {
      const wire = structuredClone(message) as WireMessage
      messages.push(wire)
      timeline.push({ client: name, message: wire })
      onSend?.(wire)
    },
    close() {
      closes++
      timeline.push({ client: name, message: 'close' })
    },
  })

  return {
    connection,
    messages,
    get closes() { return closes },
    events() {
      return messages.filter((message): message is WireEvent => message.type === 'event')
    },
    response(requestId: string): WireResponse['result'] {
      const response = messages.find(
        (message): message is WireResponse => message.type === 'response' && message.requestId === requestId,
      )
      if (!response) throw new Error(`No response for ${requestId}`)
      return response.result
    },
  }
}

type Client = ReturnType<typeof clientFor>

async function hello(client: Client, versions = originalVersion) {
  await client.connection.receive({ type: 'hello', versions })
}

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.addEventListener('message', (event) => resolve(event.data), { once: true })
    port.start()
  })
}

async function join(player: Player, client: Client, scope: TestScope, versions = originalVersion) {
  await hello(client, versions)
  player.authorize(client.connection, scope)
}

async function snapshot(client: Client, id: string, extension = {}) {
  await client.connection.receive({ type: 'request', interaction: 'M03', requestId: id, sessionId, ...extension })
  const result = client.response(id)
  expect(result.status).toBe('ok')
  expect(result.view).toBeDefined()
  return result.view!
}

function command(
  requestId: string,
  commandId: string,
  basis: string,
  action: unknown = { type: 'end-turn' },
  options: { seatId?: string; sessionId?: string; extension?: Record<string, unknown> } = {},
) {
  return {
    type: 'request',
    interaction: 'M02',
    requestId,
    commandId,
    sessionId: options.sessionId ?? sessionId,
    seatId: options.seatId ?? alice.seatId,
    basis,
    action,
    ...options.extension,
  }
}

function latch() {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  return { held, release }
}

// The wire clients are fixtures with independently defined messages. These small core and
// store fixtures drive the protocol and expose whether rejected commands reached either port.
function fixture(options: { coreUpdated?: boolean; holdConfirm?: ReturnType<typeof latch>; session?: string } = {}) {
  const saved = new Map<string, CommandRequestSummary | CommandReceipt>()
  let lookups = 0
  let adjudications = 0
  let confirmations = 0
  let summaries = 0
  const confirmationStarted = latch()
  const player = new PlayerInterface<TurnState>({
    sessionId: options.session ?? sessionId,
    versions: options.coreUpdated ? compatibleVersion : originalVersion,
    confirmed: { revision: 0, versionHash: digest, state: { turn: 1 } },
    core: {
      project(confirmed, scope): JsonValue {
        const { turn, aliceCard } = confirmed.state
        if (scope.type === 'spectator') return { turn }
        const card = scope.seatId === alice.seatId ? aliceCard ?? 'private-A' : 'private-B'
        return { turn, hand: [card] }
      },
      adjudicate({ current, seatId, action }): CoreAdjudication<TurnState> {
        adjudications++
        if (action.type === 'respond') {
          return { status: 'rejected', reason: current.state.turn === 1 ? 'illegal-choice' : 'decision-expired' }
        }
        const next = { ...current, revision: current.revision + 1 }
        if (action.type === 'mulligan') {
          const selection = action.cardIds[0]
          return {
            status: 'accepted',
            next: { ...next, state: { ...current.state, aliceCard: 'replacement-' + selection } },
            result: { selection },
            events: [{ visibility: { type: 'seat', seatId }, event: { type: 'action', payload: { selection } } }],
          }
        }
        const terminal = action.type === 'concede'
        const turn = current.state.turn + (terminal ? 0 : 1)
        const state = { ...current.state, turn, ...(options.coreUpdated ? { accountingUnits: 2 } : {}) }
        return {
          status: 'accepted',
          next: { ...next, state, ...(terminal ? { terminal: true } : {}) },
          result: { turn },
          events: [{ visibility: { type: 'public' }, event: { type: terminal ? 'terminal' : 'action', payload: { turn } } }],
        }
      },
    },
    store: {
      lookup(key) {
        lookups++
        return saved.get(JSON.stringify(key))
      },
      recordRejection(record) {
        summaries++
        saved.set(JSON.stringify(record.key), record)
      },
      async confirm(confirmation) {
        confirmations++
        confirmationStarted.release()
        await options.holdConfirm?.held
        saved.set(JSON.stringify(confirmation.receipt.key), confirmation.receipt)
      },
    },
  })
  return {
    player,
    confirmationStarted,
    get lookups() { return lookups },
    get adjudications() { return adjudications },
    get confirmations() { return confirmations },
    get summaries() { return summaries },
  }
}

describe('player protocol at the client boundary', () => {
  it.each([
    { title: 'an original client and original core', clientUpdated: false, coreUpdated: false },
    { title: 'only the client upgrades', clientUpdated: true, coreUpdated: false },
    { title: 'only the core upgrades', clientUpdated: false, coreUpdated: true },
  ])('preserves M02, M03 and M04 semantics when $title', async ({ clientUpdated, coreUpdated }) => {
    const harness = fixture({ coreUpdated })
    const client = clientFor(harness.player, 'alice')
    const observer = clientFor(harness.player, 'observer')
    const clientVersions = clientUpdated ? compatibleVersion : originalVersion
    const additiveFields = clientUpdated ? { clientDiagnostics: { layout: 'new' } } : {}
    await join(harness.player, client, alice, clientVersions)
    await join(harness.player, observer, spectator)
    expect(client.messages[0]).toMatchObject({ type: 'welcome', version: { major: 1, minor: 0 } })

    const before = await snapshot(client, 'before', additiveFields)
    const publicBefore = await snapshot(observer, 'public-before')
    expect(before).toMatchObject({ scope: alice, snapshot: { turn: 1, hand: ['private-A'] } })
    expect(publicBefore).toMatchObject({ scope: spectator, snapshot: { turn: 1 } })
    expect(publicBefore.snapshot).not.toHaveProperty('hand')
    expect(before).not.toHaveProperty('revision')
    expect(client.events()).toHaveLength(0)
    expect(harness.adjudications).toBe(0)

    await client.connection.receive(command('submitted', 'action-1', before.basis, undefined, { extension: additiveFields }))
    expect(client.response('submitted')).toMatchObject({
      status: 'accepted',
      receipt: { commandId: 'action-1', result: { turn: 2 } },
    })
    expect(client.events()).toEqual([
      expect.objectContaining({
        interaction: 'M04',
        sessionId,
        sequence: before.sequence + 1,
        event: { type: 'action', payload: { turn: 2 } },
      }),
    ])
    expect(observer.events()).toEqual([
      expect.objectContaining({
        interaction: 'M04',
        sessionId,
        sequence: publicBefore.sequence + 1,
        event: { type: 'action', payload: { turn: 2 } },
      }),
    ])

    const after = await snapshot(client, 'after')
    expect(after).toMatchObject({ sequence: client.events()[0].sequence, basis: client.events()[0].basis })
    expect(after.snapshot).toEqual({ turn: 2, hand: ['private-A'] })
    expect(after.basis).not.toEqual(before.basis)
    expect(harness.confirmations).toBe(1)
  })

  it.each([
    { versions: { major: 2, minMinor: 0, maxMinor: 0 }, reason: 'major-version-mismatch' },
    { versions: { major: 1, minMinor: 1, maxMinor: 2 }, reason: 'no-common-minor-version' },
  ])('reports $reason with both ranges and closes', async ({ versions, reason }) => {
    const { player } = fixture()
    const timeline: Array<{ client: string; message: WireMessage | 'close' }> = []
    const client = clientFor(player, 'incompatible', timeline)
    await hello(client, versions)
    expect(timeline).toEqual([
      {
        client: 'incompatible',
        message: expect.objectContaining({
          type: 'handshake-rejected',
          reason,
          host: originalVersion,
          client: versions,
        }),
      },
      { client: 'incompatible', message: 'close' },
    ])
    expect(client.closes).toBe(1)
    await client.connection.receive({ type: 'request', interaction: 'M03', requestId: 'late', sessionId })
    expect(client.messages).toHaveLength(1)
  })

  it('selects the highest common minor when both peers support an added revision', async () => {
    const { player } = fixture({ coreUpdated: true })
    const client = clientFor(player, 'alice')
    await hello(client, { major: 1, minMinor: 0, maxMinor: 2 })
    expect(client.messages[0]).toMatchObject({ type: 'welcome', version: { major: 1, minor: 1 } })
  })

  it('does no business work before negotiation and host authorisation', async () => {
    const harness = fixture()
    const client = clientFor(harness.player, 'alice')
    const attempt = command('premature-command', 'one', 'unissued-basis')
    await client.connection.receive(attempt)
    expect(client.messages).not.toContainEqual(expect.objectContaining({ result: expect.objectContaining({ status: 'accepted' }) }))
    expect(client.events()).toHaveLength(0)
    expect(harness.lookups).toBe(0)
    expect(harness.adjudications).toBe(0)

    const negotiated = clientFor(harness.player, 'without-capability')
    await hello(negotiated)
    await negotiated.connection.receive({ ...attempt, requestId: 'without-capability' })
    expect(negotiated.response('without-capability')).toMatchObject({ status: 'rejected' })
    expect(harness.lookups).toBe(0)
    expect(harness.adjudications).toBe(0)
  })

  it('binds one running frontend instance to each real MessagePort', async () => {
    const { player } = fixture()
    const channel = new MessageChannel()
    try {
      const original = player.connectPort('alice', channel.port1)
      const welcome = nextMessage(channel.port2)
      channel.port2.postMessage({ type: 'hello', versions: originalVersion })
      expect(await welcome).toEqual({ type: 'welcome', version: { major: 1, minor: 0 } })
      expect(player.authorize(original, alice)).toBe(true)

      expect(() => player.connectPort('another-frontend', channel.port1)).toThrow()
      const otherSession = fixture({ session: 'match-2' }).player
      expect(() => otherSession.connectPort('other-match-frontend', channel.port1)).toThrow()
      expect(original.capability).toMatchObject({ instanceId: 'alice', sessionId, scope: alice })
      const queried = nextMessage(channel.port2)
      channel.port2.postMessage({ type: 'request', interaction: 'M03', requestId: 'view', sessionId })
      expect(await queried).toMatchObject({
        type: 'response', interaction: 'M03', requestId: 'view',
        result: { status: 'ok', view: { scope: alice, snapshot: { turn: 1, hand: ['private-A'] } } },
      })
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })

  it('does not consult stored receipts for an unauthorised session or seat', async () => {
    const harness = fixture()
    const client = clientFor(harness.player, 'alice')
    const watching = clientFor(harness.player, 'observer')
    await join(harness.player, client, alice)
    await join(harness.player, watching, spectator)
    const original = await snapshot(client, 'original')
    await client.connection.receive(command('confirm', 'prior-command', original.basis))
    expect(client.response('confirm').status).toBe('accepted')
    const lookups = harness.lookups

    await client.connection.receive(command('wrong-seat', 'prior-command', original.basis, undefined, { seatId: bob.seatId }))
    await client.connection.receive(command('wrong-match', 'prior-command', original.basis, undefined, { sessionId: 'other-match' }))
    await watching.connection.receive(command('no-action-right', 'prior-command', original.basis))
    for (const [clientToCheck, id] of [[client, 'wrong-seat'], [client, 'wrong-match'], [watching, 'no-action-right']] as const) {
      expect(clientToCheck.response(id)).toMatchObject({ status: 'rejected' })
      expect(clientToCheck.response(id)).not.toHaveProperty('receipt')
    }
    expect(harness.lookups).toBe(lookups)
    expect(harness.adjudications).toBe(1)
    expect(harness.confirmations).toBe(1)
  })

  it('serializes confirmation, returns the same receipt for identical concurrent commands and rejects a competitor', async () => {
    const holdConfirm = latch()
    const harness = fixture({ holdConfirm })
    const client = clientFor(harness.player, 'alice')
    await join(harness.player, client, alice)
    const before = await snapshot(client, 'before')
    const first = client.connection.receive(command('first', 'one', before.basis))
    const reachedConfirmation = await Promise.race([
      harness.confirmationStarted.held.then(() => true),
      first.then(() => false),
    ])
    expect(reachedConfirmation).toBe(true)
    const retry = client.connection.receive(command('retry', 'one', before.basis))
    const competitor = client.connection.receive(command('competitor', 'two', before.basis))
    try {
      expect(harness.adjudications).toBe(1)
      expect(client.events()).toHaveLength(0)
      expect(client.messages).toHaveLength(2)
    } finally {
      holdConfirm.release()
    }
    await Promise.all([first, retry, competitor])
    expect(client.response('retry')).toEqual(client.response('first'))
    expect(client.response('first').status).toBe('accepted')
    expect(client.response('competitor')).toMatchObject({ status: 'rejected' })
    expect(client.events()).toHaveLength(1)
    expect(harness.confirmations).toBe(1)
  })

  it('returns the original receipt only to the reauthorised seat and preserves the deduplication key', async () => {
    const harness = fixture()
    const original = clientFor(harness.player, 'alice-original')
    await join(harness.player, original, alice)
    const before = await snapshot(original, 'before')
    await original.connection.receive(command('first', 'one', before.basis))
    const originalReceipt = original.response('first')
    expect(originalReceipt.status).toBe('accepted')
    original.connection.close()

    const reconnected = clientFor(harness.player, 'alice-reconnected')
    await join(harness.player, reconnected, alice)
    const reconnectedView = await snapshot(reconnected, 'reconnected')
    expect(reconnectedView.snapshot).toMatchObject({ turn: 2 })
    expect(reconnectedView.basis).not.toBe(before.basis)
    await reconnected.connection.receive(command('same', 'one', before.basis))
    expect(reconnected.response('same')).toEqual(originalReceipt)
    await reconnected.connection.receive(command('changed', 'one', before.basis, { type: 'concede' }))
    expect(reconnected.response('changed')).toMatchObject({ status: 'rejected' })
    expect(reconnected.events()).toHaveLength(0)
    expect(harness.adjudications).toBe(1)
    expect(harness.confirmations).toBe(1)
  })

  it('records only a rejected request summary and recalculates its reason when that seat reconnects', async () => {
    const harness = fixture()
    const original = clientFor(harness.player, 'alice')
    await join(harness.player, original, alice)
    const before = await snapshot(original, 'before')
    const attempt = command('invalid-choice', 'decision-request', before.basis, {
      type: 'respond', decisionId: 'decision-1', choice: { type: 'select', targetIds: ['unavailable'] },
    })
    await original.connection.receive(attempt)
    expect(original.response('invalid-choice')).toEqual({ status: 'rejected', reason: 'illegal-choice' })
    expect(harness.summaries).toBe(1)
    expect(harness.confirmations).toBe(0)
    expect(await snapshot(original, 'after-rejection')).toEqual(before)
    expect(original.events()).toHaveLength(0)
    await original.connection.receive(command('progress', 'progress-command', before.basis))
    expect(original.response('progress').status).toBe('accepted')
    original.connection.close()

    const reconnected = clientFor(harness.player, 'alice-reconnected')
    await join(harness.player, reconnected, alice)
    await reconnected.connection.receive({ ...attempt, requestId: 'repeat' })
    expect(reconnected.response('repeat')).toEqual({ status: 'rejected', reason: 'decision-expired' })
    expect(harness.adjudications).toBe(3)
    expect(harness.summaries).toBe(1)
    expect(harness.confirmations).toBe(1)
    expect(reconnected.events()).toHaveLength(0)
  })

  it('keeps the other seat and observer sequence and basis stable across a private event', async () => {
    const { player } = fixture()
    const origin = clientFor(player, 'alice')
    const otherSeat = clientFor(player, 'bob')
    const watching = clientFor(player, 'observer')
    await join(player, origin, alice)
    await join(player, otherSeat, bob)
    await join(player, watching, spectator)
    const before = await snapshot(origin, 'alice-before')
    const otherBefore = await snapshot(otherSeat, 'bob-before')
    const observerBefore = await snapshot(watching, 'observer-before')
    await origin.connection.receive(command('private-action', 'mulligan-1', before.basis, {
      type: 'mulligan', cardIds: ['private-A'],
    }))
    expect(origin.response('private-action').status).toBe('accepted')
    expect(origin.events()).toHaveLength(1)
    expect((await snapshot(origin, 'alice-after')).snapshot).toMatchObject({ hand: ['replacement-private-A'] })
    expect(await snapshot(otherSeat, 'bob-after')).toEqual(otherBefore)
    expect(await snapshot(watching, 'observer-after')).toEqual(observerBefore)
    expect(otherSeat.events()).toHaveLength(0)
    expect(watching.events()).toHaveLength(0)
  })

  it('gives a connection authorised during a receipt callback only the current snapshot', async () => {
    const { player } = fixture()
    const newcomer = clientFor(player, 'late-observer')
    await hello(newcomer)
    let joinedDuringReceipt = false
    const origin = clientFor(player, 'alice', [], (message) => {
      if (message.type === 'response' && message.interaction === 'M02') {
        joinedDuringReceipt = player.authorize(newcomer.connection, spectator)
      }
    })
    await join(player, origin, alice)
    const before = await snapshot(origin, 'before')
    await origin.connection.receive(command('confirm', 'one', before.basis))
    expect(origin.response('confirm').status).toBe('accepted')
    expect(joinedDuringReceipt).toBe(true)
    expect(newcomer.events()).toHaveLength(0)
    expect(await snapshot(newcomer, 'joined')).toMatchObject({ scope: spectator, sequence: 0, snapshot: { turn: 2 } })
  })

  it('delivers a terminal receipt only to the origin, publishes terminal updates and then closes active streams', async () => {
    const { player } = fixture()
    const timeline: Array<{ client: string; message: WireMessage | 'close' }> = []
    const origin = clientFor(player, 'alice', timeline)
    const otherSeat = clientFor(player, 'bob', timeline)
    const watching = clientFor(player, 'observer', timeline)
    await join(player, origin, alice)
    await join(player, otherSeat, bob)
    await join(player, watching, spectator)
    const before = await snapshot(origin, 'before')
    const startingAt = timeline.length
    await origin.connection.receive(command('terminal-request', 'private-terminal-command', before.basis, { type: 'concede' }))

    expect(origin.response('terminal-request')).toMatchObject({
      status: 'accepted',
      receipt: { commandId: 'private-terminal-command' },
    })
    for (const client of [origin, otherSeat, watching]) {
      expect(client.events()).toEqual([expect.objectContaining({ event: expect.objectContaining({ type: 'terminal' }) })])
      expect(client.closes).toBe(1)
    }
    for (const client of [otherSeat, watching]) {
      expect(client.events()[0]).not.toHaveProperty('commandId')
      expect(client.messages.filter((message) => message.type === 'response')).toHaveLength(0)
    }
    expect(origin.events()[0].event.payload).toEqual({ turn: 1, hand: ['private-A'] })
    expect(otherSeat.events()[0].event.payload).toEqual({ turn: 1, hand: ['private-B'] })
    expect(watching.events()[0].event.payload).toEqual({ turn: 1 })
    const order = timeline.slice(startingAt).map(({ message }) => typeof message === 'string' ? message : message.type)
    expect(order).toEqual(['response', 'event', 'event', 'event', 'close', 'close', 'close'])
    const sent = timeline.length
    await origin.connection.receive(command('after-terminal', 'private-terminal-command', before.basis, { type: 'concede' }))
    expect(timeline).toHaveLength(sent)
  })
})
