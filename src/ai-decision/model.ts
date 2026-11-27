type Awaitable<Value> = Value | Promise<Value>

export interface ModelIdentity {
  readonly id: string
  readonly version: string
}

export interface ModelSelection {
  readonly id: string
  readonly version?: string
}

export interface ModelBasis {
  readonly sessionId: string
  readonly seatId: string
  readonly viewBasis: string
  readonly decisionId?: string
}

export interface ModelRequest<Observation> {
  readonly requestId: string
  readonly basis: ModelBasis
  readonly observation: Observation
}

export interface ModelJob<Action> {
  readonly requestId: string
  readonly basis: ModelBasis
  readonly result: Action
}

export interface ModelRunner<Observation, Action> {
  generate(request: ModelRequest<Observation>, signal: AbortSignal): Awaitable<Action>
  dispose?(): void
}

/** Host-owned boundary. Use the player protocol's parser to validate and reconstruct the public action. */
export type ModelActionProjector<Action> = (result: unknown) => Action | undefined

export interface ModelProvider<Observation, Action, Config = unknown> {
  readonly identity: ModelIdentity
  availability?(): Awaitable<true | string>
  prepare(seat: { readonly seatId: string; readonly config: Config }): Awaitable<ModelRunner<Observation, Action>>
}

export type ModelAvailability =
  | { readonly available: true; readonly model: ModelIdentity }
  | { readonly available: false; readonly reason: string }

export interface ModelSeatRequest<Config> {
  readonly model: ModelSelection
  readonly seatId: string
  readonly config: Config
}

export type ModelCompletion<Action> =
  | { readonly status: 'generated'; readonly job: ModelJob<Action> }
  | { readonly status: 'cancelled' | 'generation-failed' }

export type ModelAcceptance<Action> =
  | { readonly accepted: true; readonly completion: Promise<ModelCompletion<Action>> }
  | { readonly accepted: false; readonly reason: 'closed' | 'busy' | 'wrong-seat' }

export type ModelPreparation<Observation, Action> =
  | { readonly ready: true; readonly model: ModelIdentity; readonly seat: ModelSeat<Observation, Action> }
  | { readonly ready: false; readonly seatId: string; readonly reason: string }

export interface ModelSeat<Observation, Action> {
  request(request: ModelRequest<Observation>): ModelAcceptance<Action>
  cancel(): void
  dispose(): void
}

// A01 discovers a model. A02 creates a fresh runner for each prepared seat.
export class ModelService<Observation, Action, Config = unknown> {
  private readonly providers = new Map<string, ModelProvider<Observation, Action, Config>>()

  constructor(
    providers: readonly ModelProvider<Observation, Action, Config>[],
    private readonly projectAction: ModelActionProjector<Action>,
  ) {
    if (typeof projectAction !== 'function') throw new TypeError('A model action projector is required')
    for (const provider of providers) {
      const { id } = provider.identity
      if (this.providers.has(id)) throw new Error(`Duplicate model ID: ${id}`)
      this.providers.set(id, provider)
    }
  }

  async query(selection: ModelSelection): Promise<ModelAvailability> {
    const provider = this.providers.get(selection.id)
    if (!provider) return { available: false, reason: 'model-not-found' }
    const { id, version } = provider.identity
    if (selection.version !== undefined && selection.version !== version) {
      return { available: false, reason: 'model-version-unavailable' }
    }

    try {
      const availability = provider.availability ? await provider.availability() : true
      if (availability !== true) return { available: false, reason: availability }
      return { available: true, model: { id, version } }
    } catch {
      return { available: false, reason: 'model-unavailable' }
    }
  }

  async prepare({ model, seatId, config }: ModelSeatRequest<Config>): Promise<ModelPreparation<Observation, Action>> {
    const availability = await this.query(model)
    if (!availability.available) return { ready: false, seatId, reason: availability.reason }

    try {
      const provider = this.providers.get(availability.model.id)!
      const runner = await provider.prepare({ seatId, config: structuredClone(config) })
      return { ready: true, model: availability.model, seat: new PreparedModelSeat(seatId, runner, this.projectAction) }
    } catch {
      return { ready: false, seatId, reason: 'model-preparation-failed' }
    }
  }
}

interface PendingRequest<Action> {
  readonly controller: AbortController
  readonly resolve: (result: ModelCompletion<Action>) => void
}

class PreparedModelSeat<Observation, Action> implements ModelSeat<Observation, Action> {
  private active?: PendingRequest<Action>
  private disposed = false

  constructor(
    private readonly seatId: string,
    private readonly runner: ModelRunner<Observation, Action>,
    private readonly projectAction: ModelActionProjector<Action>,
  ) {}

  request({ requestId, basis, observation }: ModelRequest<Observation>): ModelAcceptance<Action> {
    if (this.disposed) return { accepted: false, reason: 'closed' }
    if (basis.seatId !== this.seatId) return { accepted: false, reason: 'wrong-seat' }
    if (this.active) return { accepted: false, reason: 'busy' }

    let resolve!: PendingRequest<Action>['resolve']
    const completion = new Promise<ModelCompletion<Action>>((settle) => { resolve = settle })
    const active = { controller: new AbortController(), resolve }
    this.active = active

    try {
      const { sessionId, seatId, viewBasis, decisionId } = basis
      const jobBasis: ModelBasis = decisionId === undefined
        ? { sessionId, seatId, viewBasis }
        : { sessionId, seatId, viewBasis, decisionId }
      const request = Object.freeze({ requestId, basis: Object.freeze({ ...jobBasis }), observation: structuredClone(observation) })
      void this.generate(active, jobBasis, request)
    } catch {
      this.finish(active, { status: 'generation-failed' })
    }

    // Each A03 completion belongs to the adapter that made this A02 request.
    return { accepted: true, completion }
  }

  cancel(): void {
    const active = this.active
    if (!active) return
    this.finish(active, { status: 'cancelled' })
    active.controller.abort()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    this.runner.dispose?.()
  }

  private async generate(active: PendingRequest<Action>, basis: ModelBasis, request: ModelRequest<Observation>): Promise<void> {
    await Promise.resolve()
    if (this.active !== active) return

    try {
      const generated = await this.runner.generate(request, active.controller.signal)
      if (this.active !== active) return
      const result = this.projectAction(generated)
      if (result === undefined) {
        this.finish(active, { status: 'generation-failed' })
        return
      }
      this.finish(active, { status: 'generated', job: { requestId: request.requestId, basis, result: structuredClone(result) } })
    } catch {
      this.finish(active, { status: 'generation-failed' })
    }
  }

  private finish(active: PendingRequest<Action>, result: ModelCompletion<Action>): void {
    if (this.active !== active) return
    this.active = undefined
    active.resolve(result)
  }
}
