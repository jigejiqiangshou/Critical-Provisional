import type {
  ModelBasis,
  ModelCompletion,
  ModelIdentity,
  ModelSeat,
  ModelSeatRequest,
  ModelService,
} from '../ai-decision/model'

export interface AiAction {
  readonly type: string
  readonly decisionId?: string
}

export interface AiSeatView<Observation> {
  readonly sessionId: string
  readonly seatId: string
  readonly sequence: number
  readonly basis: string
  readonly decisionId?: string
  readonly status: 'waiting' | 'eligible' | 'finished'
  readonly observation: Observation
}

export interface AiPlayerCommand<Action> {
  readonly type: 'request'
  readonly interaction: 'M02'
  readonly requestId: string
  readonly commandId: string
  readonly sessionId: string
  readonly seatId: string
  readonly basis: string
  readonly action: Action
}

export interface AiPlayerPort<Action, Receipt> {
  submit(command: AiPlayerCommand<Action>): Receipt | Promise<Receipt>
}

export type AiTurnOutcome<Receipt> =
  | { readonly status: 'submitted'; readonly receipt: Receipt }
  | { readonly status: 'discarded' | 'model-failed' | 'submit-failed' }

export interface AiPlayerConnection<Observation, Receipt> {
  observe(view: AiSeatView<Observation>): Promise<AiTurnOutcome<Receipt>> | undefined
  cancel(): void
  close(): void
}

export type AiPlayerPreparation<Observation, Action extends AiAction> =
  | { readonly ready: true; readonly model: ModelIdentity; readonly adapter: AiPlayerAdapter<Observation, Action> }
  | { readonly ready: false; readonly seatId: string; readonly reason: string }

export async function prepareAiPlayer<Observation, Action extends AiAction, Config>(
  service: ModelService<Observation, Action, Config>,
  request: ModelSeatRequest<Config>,
): Promise<AiPlayerPreparation<Observation, Action>> {
  const { seatId } = request
  const prepared = await service.prepare(request)
  if (!prepared.ready) return prepared
  return { ready: true, model: prepared.model, adapter: new AiPlayerAdapter(seatId, prepared.seat) }
}

export class AiPlayerAdapter<Observation, Action extends AiAction> {
  private connection?: { close(): void }
  private disposed = false

  constructor(readonly seatId: string, private readonly model: ModelSeat<Observation, Action>) {}

  // The host binds only after session confirmation. A reconnect gets a new view stream.
  bind<Receipt>(sessionId: string, port: AiPlayerPort<Action, Receipt>): AiPlayerConnection<Observation, Receipt> {
    if (this.disposed) throw new Error('AI player is disposed')
    this.connection?.close()
    const connection = new SeatConnection(sessionId, this.seatId, this.model, port)
    this.connection = connection
    return connection
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.connection?.close()
    this.connection = undefined
    this.model.dispose()
  }
}

interface PendingDecision {
  readonly requestId: string
  readonly basis: ModelBasis
}

class SeatConnection<Observation, Action extends AiAction, Receipt> implements AiPlayerConnection<Observation, Receipt> {
  private sequence = -1
  private view?: { readonly basis: ModelBasis; readonly status: AiSeatView<Observation>['status'] }
  private pending?: PendingDecision
  private closed = false

  constructor(
    private readonly sessionId: string,
    private readonly seatId: string,
    private readonly model: ModelSeat<Observation, Action>,
    private readonly port: AiPlayerPort<Action, Receipt>,
  ) {}

  // The protocol bridge supplies complete authorized snapshots, including any M03 resync after a sequence gap.
  observe(view: AiSeatView<Observation>): Promise<AiTurnOutcome<Receipt>> | undefined {
    if (this.closed || view.sessionId !== this.sessionId || view.seatId !== this.seatId) return
    if (!Number.isSafeInteger(view.sequence) || view.sequence <= this.sequence) return
    this.sequence = view.sequence

    if (view.status === 'finished') {
      this.close()
      return
    }

    const basis: ModelBasis = { sessionId: view.sessionId, seatId: view.seatId, viewBasis: view.basis, decisionId: view.decisionId }
    if (this.view?.status === view.status && sameBasis(this.view.basis, basis)) return
    this.view = { basis, status: view.status }
    this.cancel()
    if (view.status !== 'eligible') return

    const active = { requestId: crypto.randomUUID(), basis }
    const accepted = this.model.request({ requestId: active.requestId, basis, observation: view.observation })
    if (!accepted.accepted) return Promise.resolve({ status: 'model-failed' })

    this.pending = active
    return this.submit(active, accepted.completion)
  }

  cancel(): void {
    if (!this.pending) return
    this.pending = undefined
    this.model.cancel()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.view = undefined
    this.cancel()
  }

  private async submit(
    active: PendingDecision,
    completion: Promise<ModelCompletion<Action>>,
  ): Promise<AiTurnOutcome<Receipt>> {
    const completed = await completion.catch(() => ({ status: 'generation-failed' } as const))
    if (this.pending !== active) return { status: 'discarded' }
    this.pending = undefined
    if (completed.status === 'cancelled') return { status: 'discarded' }
    if (completed.status !== 'generated') return { status: 'model-failed' }

    const { requestId, basis, result: action } = completed.job
    if (requestId !== active.requestId || !sameBasis(basis, active.basis)) return { status: 'discarded' }
    if (typeof action?.type !== 'string') return { status: 'model-failed' }
    if (action.type === 'respond' && (basis.decisionId === undefined || action.decisionId !== basis.decisionId)) {
      return { status: 'discarded' }
    }

    try {
      const receipt = await this.port.submit({
        type: 'request',
        interaction: 'M02',
        requestId,
        commandId: requestId,
        sessionId: basis.sessionId,
        seatId: basis.seatId,
        basis: basis.viewBasis,
        action,
      })
      return { status: 'submitted', receipt }
    } catch {
      return { status: 'submit-failed' }
    }
  }
}

function sameBasis(left: ModelBasis, right: ModelBasis): boolean {
  return left.sessionId === right.sessionId && left.seatId === right.seatId
    && left.viewBasis === right.viewBasis && left.decisionId === right.decisionId
}
