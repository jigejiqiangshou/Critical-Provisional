import { MatchCore } from '../../../src/match/core'
import type { Match } from '../../../src/match/core'
import { PlayerInterface } from '../../../src/match/player-interface'
import type { ConfirmedMatch, PlayerCore } from '../../../src/match/player-interface'
import { PLAYER_PROTOCOL_V1 } from '../../../src/match/player-protocol'
import type { CommandRequest, PlayerAction, ServerMessage } from '../../../src/match/player-protocol'
import { openRecoveryStore } from '../../../src/match/recovery-store'
import type { Ruleset } from '../../../src/match/rules'

const sessionId = 'persistent-session'
const seatId = 'first'
const metadata = { seatId, modelId: 'model-1' }

type State = { value: string }
type Continuation = { selectedFrom: number }
type History = { randomInputs: readonly number[] }
type Snapshot = Match<State, Continuation>

const rules: Ruleset<State, PlayerAction, Continuation, never> = {
  version: 'recovery-test-v1',
  artifact: 'recovery-test-rules',
  resolveAction({ state, seat, action, random }) {
    if (action.type === 'play-card') {
      return {
        kind: 'waiting', state, events: [],
        decision: {
          owner: seat,
          choices: {
            candidates: [{ id: 'second' }, { id: 'first' }], min: 1, max: 1,
            ordered: true, canPass: false, visibility: 'owner',
          },
          continuation: { selectedFrom: random() },
        },
      }
    }
    if (action.type === 'concede') {
      return { kind: 'ended', state, events: [], outcome: { winner: 'second', reason: 'conceded' } }
    }
    return { kind: 'rejected', reason: 'unexpected-action' }
  },
  resumeDecision({ decision, answer }) {
    return {
      kind: 'active', activeSeat: decision.owner, events: [],
      state: { value: answer.kind === 'select' ? answer.candidateIds.join(',') : '' },
    }
  },
}
const snapshot = { id: 'recovery-release-v1', rulesVersion: rules.version, content: [] }
type Store = Awaited<ReturnType<typeof openStore>>
let store: Store | undefined

function openStore() {
  return openRecoveryStore<Snapshot, History, typeof metadata>()
}

async function connect(opened: Store, core: Awaited<ReturnType<typeof newMatch>>, failurePayload?: string) {
  let confirmations = 0
  let pending: ReturnType<typeof core.propose> | undefined
  const adapter: PlayerCore<Snapshot, History> = {
    project: ({ state }) => ({ value: state.state.value, progress: state.progress.kind }),
    adjudicate({ seatId: seat, action, expectedRevision }) {
      const candidate = action.type === 'respond'
        ? core.propose({
          kind: 'decision', seat, expectedRevision, decisionId: action.decisionId,
          answer: action.choice.type === 'pass' ? { kind: 'pass' } : {
            kind: 'select', candidateIds: action.choice.targetIds,
          },
        })
        : core.propose({ kind: 'action', seat, expectedRevision, action })
      if (candidate.kind === 'rejected') return { status: 'rejected', reason: candidate.reason }
      pending = candidate
      return {
        status: 'accepted',
        next: confirmation(candidate.match),
        result: { marker: failurePayload ?? candidate.match.progress.kind },
        events: [{ visibility: { type: 'public' }, event: { type: 'action', payload: candidate.match.progress.kind } }],
        history: { randomInputs: candidate.randomInputs },
      }
    },
    confirm() {
      if (pending?.kind !== 'accepted') throw new Error('No proposed settlement')
      core.confirm(pending)
      confirmations++
    },
  }
  const service = new PlayerInterface({ sessionId, confirmed: confirmation(core.read()), core: adapter, store: opened })
  const messages: ServerMessage[] = []
  const client = service.connect('recovery-probe', { send: message => messages.push(message), close() {} })
  await client.receive({ type: 'hello', versions: PLAYER_PROTOCOL_V1 })
  if (!service.authorize(client, { type: 'seat', seatId })) throw new Error('Unable to authorize seat')

  async function basis() {
    await client.receive({ type: 'request', interaction: 'M03', requestId: 'view', sessionId })
    const response = messages.at(-1)
    if (response?.type !== 'response' || response.interaction !== 'M03' || response.result.status !== 'ok') {
      throw new Error('Unable to read confirmed view')
    }
    return response.result.view.basis
  }

  async function submit(commandId: string, action: PlayerAction, previousBasis?: string) {
    const request: CommandRequest = {
      type: 'request', interaction: 'M02', requestId: commandId, sessionId, seatId, commandId,
      basis: previousBasis ?? await basis(), action,
    }
    const start = messages.length
    await client.receive(request)
    return messages.slice(start)
  }

  return { basis, submit, confirmations: () => confirmations }
}

function newMatch() {
  return MatchCore.create({
    rules, snapshot, state: { value: 'initial' }, activeSeat: seatId,
    random: { kind: 'recorded', inputs: [0.625, 0.875], consumed: 0 },
  })
}

function confirmation(state: Snapshot): ConfirmedMatch<Snapshot> {
  return {
    revision: state.revision, versionHash: state.versionHash, state,
    ...(state.progress.kind === 'ended' ? { terminal: true, outcome: state.progress.outcome } : {}),
  }
}

const startDecision = { type: 'play-card', cardId: 'recovery-card' } as const
const response = (id: string) => ({
  type: 'respond', decisionId: 'decision-1', choice: { type: 'select', targetIds: [id] },
}) as const
const commandKey = (commandId: string) => ({ sessionId, seatId, commandId })
const rejectedLargeKey = 'reject-while-full-' + 'x'.repeat(256 * 1024)

async function setup() {
  const opened = store = await openStore()
  const core = await newMatch()
  await opened.initialize({ sessionId, confirmed: confirmation(core.read()), metadata })
  return { opened, core }
}

async function reopen() {
  const opened = store = await openStore()
  const latest = await opened.loadLatest(sessionId)
  if (!latest) throw new Error('Initial checkpoint missing')
  return { opened, latest, core: await MatchCore.restore({ rules, snapshot, match: latest.confirmed.state }) }
}

async function captureError(operation: () => unknown) {
  try {
    await operation()
    return null
  } catch (error) {
    return { message: String(error), code: (error as { code?: string })?.code }
  }
}

export const probe = {
  async writeAndPause() {
    const { opened, core } = await setup()
    const initial = await opened.listSessions()
    const client = await connect(opened, core)
    const oldBasis = await client.basis()
    const opening = await client.submit('opening', startDecision)
    const rejectionBasis = await client.basis()
    const rejected = await client.submit('bad-choice', response('absent'), rejectionBasis)
    return { initial, oldBasis, rejectionBasis, opening, rejected, latest: await opened.loadLatest(sessionId) }
  },
  async restoreAndFinish(bases: { opening: string; rejection: string }) {
    const { opened, latest, core } = await reopen()
    const client = await connect(opened, core)
    const retry = await client.submit('opening', startDecision, bases.opening)
    const accepted = await client.submit('good-choice', response('first'))
    const oldRejection = await client.submit('bad-choice', response('absent'), bases.rejection)
    const conflict = await client.submit('bad-choice', response('second'), bases.rejection)
    const ending = await client.submit('terminal', { type: 'concede' })
    return {
      latest, retry, accepted, oldRejection, conflict, ending, confirmations: client.confirmations(),
      history: await opened.readHistory(sessionId), outcome: await opened.readOutcome(sessionId),
      sessions: await opened.listSessions(),
    }
  },
  async readEnding() {
    const { opened, latest } = await reopen()
    return {
      latest, outcome: await opened.readOutcome(sessionId), terminal: await opened.lookup(commandKey('terminal')),
    }
  },
  async contend() {
    return captureError(async () => { store = await openStore() })
  },
  async setupAtomicFailure() {
    const { opened, core } = await setup()
    const directory = await navigator.storage.getDirectory()
    return { versionHash: core.read().versionHash, opfsEntries: (await Array.fromAsync(
      (directory as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys(),
    )).sort(), sessions: await opened.listSessions() }
  },
  async writeUnderQuota() {
    if (!store) throw new Error('Open store first')
    const core = await newMatch()
    const client = await connect(store, core, 'x'.repeat(1024 * 1024))
    const rejected = await client.submit(rejectedLargeKey, { type: 'end-turn' })
    const failed = await client.submit('confirm-while-full', startDecision)
    return { rejected: rejected.map(message => message.type === 'response' ? message.result : message), failed, confirmations: client.confirmations(), revision: core.read().revision }
  },
  async inspectAfterFailure() {
    if (!store) throw new Error('Open store first')
    return {
      latest: await store.loadLatest(sessionId), history: await store.readHistory(sessionId),
      failed: await store.lookup(commandKey('confirm-while-full')),
      rejected: await store.lookup(commandKey(rejectedLargeKey)),
    }
  },
}

Object.assign(window, { recoveryProbe: probe })
