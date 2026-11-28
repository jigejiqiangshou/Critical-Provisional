import { describe, expect, it, vi } from 'vitest'
import { ModelService } from '../../src/ai-decision/model'
import { prepareAiPlayer } from '../../src/clients/ai-player'

const model = { id: 'fixture-ai', version: '1.2.0' }
const settings = { difficulty: 2 }
const observation = {
  public: { turn: 3, board: ['public-card'] },
  own: { hand: ['authorized-card'] },
}

function view(sequence: number, basis: string, overrides: {
  sessionId?: string
  seatId?: string
  decisionId?: string
  status?: 'waiting' | 'eligible' | 'finished'
} = {}) {
  return {
    sessionId: 'match-1',
    seatId: 'seat-a',
    sequence,
    basis,
    status: 'eligible' as const,
    observation,
    ...overrides,
  }
}

function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const attack = { type: 'attack', attackerId: 'attacker-1', targetId: 'target-2' } as const
const endTurn = { type: 'end-turn' } as const

function choose(decisionId: string, ...targetIds: string[]) {
  return { type: 'respond', decisionId, choice: { type: 'select', targetIds } } as const
}

type Action = typeof attack | typeof endTurn | ReturnType<typeof choose>
type FixtureService = ModelService<typeof observation, Action, typeof settings>

function projectAction(input: unknown): Action | undefined {
  if (!input || typeof input !== 'object' || !('type' in input)) return
  if (input.type === 'end-turn') return endTurn
  if (input.type === 'attack' && 'attackerId' in input && 'targetId' in input &&
    input.attackerId === attack.attackerId && input.targetId === attack.targetId) {
    return { ...attack }
  }
  if (input.type === 'respond' && 'decisionId' in input && typeof input.decisionId === 'string' &&
    'choice' in input && input.choice && typeof input.choice === 'object' &&
    'targetIds' in input.choice && Array.isArray(input.choice.targetIds) &&
    input.choice.targetIds.every(id => typeof id === 'string')) {
    return choose(input.decisionId, ...input.choice.targetIds)
  }
}

function deferredModel() {
  const jobs: Array<{ request: unknown; signal: AbortSignal; resolve: (value: Action) => void }> = []
  const dispose = vi.fn()
  const prepare = vi.fn(() => ({
    generate(request: unknown, signal: AbortSignal) {
      const pending = gate<Action>()
      jobs.push({ request, signal, resolve: pending.resolve })
      return pending.promise
    },
    dispose,
  }))
  const project = vi.fn(projectAction)
  const service = new ModelService<typeof observation, Action, typeof settings>([{ identity: model, prepare }], project)
  return { service, jobs, dispose, prepare, project }
}

async function adapterFor(service: FixtureService, seatId = 'seat-a') {
  const prepared = await prepareAiPlayer(service, { model, seatId, config: settings })
  if (!prepared.ready) throw new Error('Fixture model did not prepare')
  return prepared.adapter
}

function transport() {
  const receipt = { status: 'accepted' as const, result: { applied: true } }
  const submit = vi.fn(async (_command: unknown) => receipt)
  return { submit, receipt }
}

describe('AI decision boundary and player adapter', () => {
  it('discovers a model by identity and version, then reports preparation failures with the seat', async () => {
    const working = deferredModel()
    const broken = { id: 'broken', version: '1.0.0' }
    const offline = { id: 'offline', version: '1.0.0' }
    const service = new ModelService<typeof observation, Action, typeof settings>([
      { identity: model, prepare: working.prepare },
      { identity: broken, prepare() { throw new Error('missing-model-data') } },
      { identity: offline, availability: () => 'model-files-unavailable', prepare: working.prepare },
    ], projectAction)
    await expect(service.query({ id: model.id })).resolves.toMatchObject({ available: true, model })
    await expect(service.query(model)).resolves.toMatchObject({ available: true, model })
    await expect(service.query({ ...model, version: '3.0.0' })).resolves.toMatchObject({ available: false })
    await expect(service.query(offline)).resolves.toMatchObject({
      available: false, reason: 'model-files-unavailable',
    })
    expect(working.prepare).not.toHaveBeenCalled()

    expect(await prepareAiPlayer(service, { model: broken, seatId: 'seat-a', config: settings }))
      .toMatchObject({ ready: false, seatId: 'seat-a' })

    const adapter = await adapterFor(service, 'seat-b')
    expect(working.prepare).toHaveBeenCalledExactlyOnceWith({ seatId: 'seat-b', config: settings })
    expect(working.jobs).toHaveLength(0)
    adapter.dispose()
    expect(working.dispose).toHaveBeenCalledTimes(1)
  })

  it('accepts an A02 job for the prepared seat and yields an A03 result correlated to the original request', async () => {
    const fixture = deferredModel()
    const prepared = await fixture.service.prepare({ model, seatId: 'seat-a', config: settings })
    if (!prepared.ready) throw new Error('Fixture model did not prepare')

    const request = {
      requestId: 'request-1',
      basis: { sessionId: 'match-1', seatId: 'seat-a', viewBasis: 'view-a4', decisionId: 'decision-7' },
      observation,
    }
    const foreign = { ...request, basis: { ...request.basis, seatId: 'seat-b' } }
    expect(prepared.seat.request(foreign)).toMatchObject({ accepted: false })
    expect(fixture.jobs).toHaveLength(0)

    const accepted = prepared.seat.request(request)
    if (!accepted.accepted) throw new Error('Expected acceptance before model completion')
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))
    expect(fixture.jobs[0].request).toEqual(request)
    const result = choose('decision-7', 'option-1')
    const unprojected = {
      ...result,
      resolverState: { enemyHand: ['never-send'] },
      choice: { ...result.choice, hiddenOrder: ['never-send'] },
    }
    fixture.jobs[0].resolve(unprojected)
    await expect(accepted.completion).resolves.toEqual({
      status: 'generated',
      job: { requestId: request.requestId, basis: request.basis, result },
    })
    expect(fixture.project).toHaveBeenCalledExactlyOnceWith(unprojected)
    prepared.seat.dispose()
  })

  it('sends one M02 for an eligible bound view without handing the model transport or other data', async () => {
    const fixture = deferredModel()
    const adapter = await adapterFor(fixture.service)
    const boundTransport = transport()
    const connection = adapter.bind('match-1', boundTransport)
    expect(connection.observe(view(1, 'not-eligible', { status: 'waiting' }))).toBeUndefined()
    expect(connection.observe(view(2, 'foreign-seat', { seatId: 'seat-b' }))).toBeUndefined()
    expect(connection.observe(view(2, 'foreign-session', { sessionId: 'match-2' }))).toBeUndefined()
    expect(fixture.jobs).toHaveLength(0)

    const eligible = { ...view(2, 'own-eligible'), hidden: { enemyHand: ['never-forward'] } }
    const result = connection.observe(eligible)
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))
    expect(boundTransport.submit).not.toHaveBeenCalled()
    expect(connection.observe(eligible)).toBeUndefined()
    expect(connection.observe({ ...eligible, sequence: 3 })).toBeUndefined()

    const { requestId } = fixture.jobs[0].request as { requestId: string }
    expect(requestId).toEqual(expect.any(String))
    expect(fixture.jobs[0].request).toEqual({
      requestId, basis: { sessionId: 'match-1', seatId: 'seat-a', viewBasis: 'own-eligible' }, observation,
    })
    const action = attack
    fixture.jobs[0].resolve(action)
    await expect(result).resolves.toMatchObject({ status: 'submitted', receipt: boundTransport.receipt })
    expect(boundTransport.submit).toHaveBeenCalledExactlyOnceWith({
      type: 'request', interaction: 'M02', requestId: expect.any(String), commandId: expect.any(String),
      sessionId: 'match-1', seatId: 'seat-a', basis: 'own-eligible', action,
    })
    expect(connection.observe({ ...eligible, sequence: 4 })).toBeUndefined()
    expect(fixture.jobs).toHaveLength(1)
    adapter.dispose()
  })

  it('discards an old result even if its generator ignores cancellation, then submits only the current decision', async () => {
    const fixture = deferredModel()
    const adapter = await adapterFor(fixture.service)
    const boundTransport = transport()
    const connection = adapter.bind('match-1', boundTransport)
    const oldView = view(1, 'basis-1', { decisionId: 'decision-1' })
    const oldResult = connection.observe(oldView)
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))

    const currentView = view(2, 'basis-2', { decisionId: 'decision-2' })
    const currentResult = connection.observe(currentView)
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(2))
    expect(fixture.jobs[0].signal.aborted).toBe(true)
    expect(fixture.jobs[1].signal.aborted).toBe(false)
    expect(connection.observe(oldView)).toBeUndefined()
    expect(fixture.jobs[0].request).not.toMatchObject({ requestId: (fixture.jobs[1].request as { requestId: string }).requestId })

    fixture.jobs[0].resolve(choose('decision-1', 'option-1'))
    await expect(oldResult).resolves.toMatchObject({ status: 'discarded' })
    expect(boundTransport.submit).not.toHaveBeenCalled()

    const action = choose('decision-2', 'option-2')
    fixture.jobs[1].resolve(action)
    await expect(currentResult).resolves.toMatchObject({ status: 'submitted' })
    expect(boundTransport.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sessionId: 'match-1', seatId: 'seat-a', basis: 'basis-2', action,
    }))
    adapter.dispose()
  })

  it('does not emit a playable action when the generated value fails boundary projection', async () => {
    const fixture = deferredModel()
    const adapter = await adapterFor(fixture.service)
    const boundTransport = transport()
    const connection = adapter.bind('match-1', boundTransport)
    const result = connection.observe(view(1, 'basis-now'))
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))
    const malformed = { type: 'attack', attackerId: attack.attackerId }
    fixture.jobs[0].resolve(malformed as Action)
    await expect(result).resolves.toEqual({ status: 'model-failed' })
    expect(fixture.project).toHaveBeenCalledExactlyOnceWith(malformed)
    expect(boundTransport.submit).not.toHaveBeenCalled()
    adapter.dispose()
  })

  it('rejects a generated response for a different decision without calling M02', async () => {
    const fixture = deferredModel()
    const adapter = await adapterFor(fixture.service)
    const boundTransport = transport()
    const connection = adapter.bind('match-1', boundTransport)
    const result = connection.observe(view(1, 'basis-now', { decisionId: 'decision-current' }))
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))
    fixture.jobs[0].resolve(choose('decision-stale', 'option-1'))
    await expect(result).resolves.toMatchObject({ status: 'discarded' })
    expect(boundTransport.submit).not.toHaveBeenCalled()
    adapter.dispose()
  })

  it('cancels prior bindings and closes generation on terminal observation', async () => {
    const fixture = deferredModel()
    const adapter = await adapterFor(fixture.service)
    const oldTransport = transport()
    const oldConnection = adapter.bind('match-1', oldTransport)
    const old = oldConnection.observe(view(1, 'old'))
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))

    const newTransport = transport()
    const newConnection = adapter.bind('match-2', newTransport)
    expect(fixture.jobs[0].signal.aborted).toBe(true)
    expect(oldConnection.observe(view(2, 'closed'))).toBeUndefined()
    const newView = view(1, 'new', { sessionId: 'match-2' })
    const active = newConnection.observe(newView)
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(2))
    expect(newConnection.observe(view(2, 'terminal', { sessionId: 'match-2', status: 'finished' }))).toBeUndefined()
    expect(fixture.jobs[1].signal.aborted).toBe(true)
    expect(newConnection.observe({ ...newView, sequence: 3 })).toBeUndefined()

    fixture.jobs[0].resolve(attack)
    fixture.jobs[1].resolve(attack)
    await expect(old).resolves.toMatchObject({ status: 'discarded' })
    await expect(active).resolves.toMatchObject({ status: 'discarded' })
    expect(oldTransport.submit).not.toHaveBeenCalled()
    expect(newTransport.submit).not.toHaveBeenCalled()
    adapter.dispose()
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps two independently prepared AI seats on their respective M02 transports', async () => {
    const fixture = deferredModel()
    const seatA = await adapterFor(fixture.service)
    const seatB = await adapterFor(fixture.service, 'seat-b')
    const transportA = transport()
    const transportB = transport()
    const adapterA = seatA.bind('match-1', transportA)
    const adapterB = seatB.bind('match-1', transportB)
    const resultA = adapterA.observe(view(1, 'basis-a'))
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(1))
    const resultB = adapterB.observe(view(1, 'basis-b', { seatId: 'seat-b' }))
    await vi.waitFor(() => expect(fixture.jobs).toHaveLength(2))

    fixture.jobs[1].resolve(endTurn)
    await expect(resultB).resolves.toMatchObject({ status: 'submitted' })
    expect(transportB.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      seatId: 'seat-b', basis: 'basis-b', action: endTurn,
    }))
    expect(transportA.submit).not.toHaveBeenCalled()

    fixture.jobs[0].resolve(attack)
    await expect(resultA).resolves.toMatchObject({ status: 'submitted' })
    expect(transportA.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      seatId: 'seat-a', basis: 'basis-a', action: attack,
    }))
    seatA.dispose()
    seatB.dispose()
    expect(fixture.dispose).toHaveBeenCalledTimes(2)
  })
})
