import type { CardCatalog, DeckEntry, Release } from './catalog'
import { CatalogStorageError } from './catalog-errors'
import type { CatalogStorageErrorCode } from './catalog-errors'

export type DeckDiagnostic =
  | { readonly code: 'invalid-entry'; readonly index: number }
  | { readonly code: 'missing-card'; readonly cardId: string; readonly releaseId: string }
  | { readonly code: 'deck-size' | 'flagship-count'; readonly expected: number; readonly actual: number }
  | { readonly code: 'same-name-limit'; readonly name: string; readonly limit: number; readonly actual: number }

export type DeckValidation =
  | { readonly ok: true; readonly entries: readonly DeckEntry[] }
  | { readonly ok: false; readonly diagnostics: readonly DeckDiagnostic[] }

/** Apply the same §3.1.1–4 construction rules to a player deck or official preset. */
export function validateDeck(release: Release, entries: readonly DeckEntry[]): DeckValidation {
  const deckSize = 60
  const cards = new Map(release.cards.map((card) => [card.id, card]))
  const byName = new Map<string, { count: number; limit: number }>()
  const normalized = new Map<string, number>()
  const missing = new Set<string>()
  const diagnostics: DeckDiagnostic[] = []
  let total = 0
  let flagshipCount = 0
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry.cardId !== 'string' || !entry.cardId.trim()
      || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) {
      diagnostics.push({ code: 'invalid-entry', index })
      continue
    }
    const { cardId, quantity } = entry
    total += quantity
    const card = cards.get(cardId)
    if (!card) {
      missing.add(cardId)
      continue
    }
    normalized.set(cardId, (normalized.get(cardId) ?? 0) + quantity)
    if (card.flagship) flagshipCount += quantity
    const sameName = byName.get(card.name) ?? { count: 0, limit: 4 }
    sameName.count += quantity
    if (card.kind === 'ace') sameName.limit = 1
    byName.set(card.name, sameName)
  }
  for (const cardId of missing) diagnostics.push({ code: 'missing-card', cardId, releaseId: release.id })
  if (total !== deckSize) diagnostics.push({ code: 'deck-size', expected: deckSize, actual: total })
  if (flagshipCount !== 1) diagnostics.push({ code: 'flagship-count', expected: 1, actual: flagshipCount })
  for (const [name, { count, limit }] of byName) {
    if (count > limit) diagnostics.push({ code: 'same-name-limit', name, limit, actual: count })
  }
  if (diagnostics.length) return { ok: false, diagnostics }
  return {
    ok: true,
    entries: Object.freeze(Array.from(normalized, ([cardId, quantity]) => Object.freeze({ cardId, quantity }))),
  }
}

export interface MatchDeckQuery {
  readonly releaseId: string
  readonly decks: readonly [readonly DeckEntry[], readonly DeckEntry[]]
}

export type MatchDeckValidation =
  | { readonly ok: true; readonly snapshot: Release; readonly decks: MatchDeckQuery['decks'] }
  | { readonly ok: false; readonly reason: 'release-not-found'; readonly releaseId: string }
  | { readonly ok: false; readonly reason: 'invalid-decks'; readonly releaseId: string;
      readonly decks: readonly [DeckValidation, DeckValidation] }
  | { readonly ok: false; readonly reason: 'storage-failed'; readonly releaseId: string;
      readonly detail: string; readonly storageCode?: CatalogStorageErrorCode }

/** M05. Resolve the exact requested release once, then check both lists against it. */
export async function validateMatchDecks(catalog: CardCatalog, query: MatchDeckQuery): Promise<MatchDeckValidation> {
  const { releaseId } = query
  let snapshot: Release | undefined
  try {
    snapshot = await catalog.getRelease(releaseId)
  } catch (error) {
    return {
      ok: false,
      reason: 'storage-failed',
      releaseId,
      detail: error instanceof Error ? error.message : String(error),
      ...(error instanceof CatalogStorageError ? { storageCode: error.code } : {}),
    }
  }
  if (!snapshot) return { ok: false, reason: 'release-not-found', releaseId }
  const first = validateDeck(snapshot, query.decks[0])
  const second = validateDeck(snapshot, query.decks[1])
  if (!first.ok || !second.ok) {
    return { ok: false, reason: 'invalid-decks', releaseId, decks: [first, second] }
  }
  return { ok: true, snapshot, decks: [first.entries, second.entries] }
}
