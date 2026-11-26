import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';

import fixtures from './fixtures.json';
import { captureLegacyScenario, legacyDefinitions } from './legacy-runtime.mjs';

const editions = ['2d', '3d'] as const;
type Edition = (typeof editions)[number];
type Seat = 'A' | 'B';
type Card = { name: string; instanceId: string };
type Unit = Card & { hp: number; atk: number; canAttack: boolean; attacked: boolean; skillLock: boolean };
type Player = {
  hp: number;
  ap: number;
  hand: Card[];
  deck: Card[];
  board: Unit[];
  grave: Card[];
  facedown: Card[];
  ice: Card[];
};
type State = {
  turn: number;
  phase: string;
  activeSeat: Seat | null;
  winner: string | null;
  finale: unknown;
  pending: { kind: string; owner: Seat; visibleTo: Seat[]; candidates?: Card[] } | null;
  seats: Record<Seat, Player>;
  replay: { actions: { t: string }[]; result: string | null; archivedActions: string[] };
};
type TraceEvent = { event: string; seat?: Seat };
type Observation = { state: State | null; trace: TraceEvent[]; random: unknown[] };
type Run = { initial: State | null; steps: Observation[] };
type Fixture = (typeof fixtures.scenarios)[number];

const expectedVariants = {
  'LG-01': ['mulligan', 'out-of-window'],
  'LG-02': ['main', 'battle-mode'],
  'LG-03': ['attack'],
  'LG-04': ['evolve'],
  'LG-05': ['same-turn', 'after-turn'],
  'LG-06': ['flip', 'decline', 'invalid'],
  'LG-07': ['threshold', 'below-threshold'],
  'LG-08': ['playable', 'unplayable', 'restart', 'empty', 'one-playable', 'one-unplayable', 'two'],
  'LG-09': ['surrender'],
} satisfies Record<string, string[]>;
type SampleId = keyof typeof expectedVariants;

const captured = new Map<Edition, Map<string, Run>>();
const fixtureKey = (id: string, variant: string) => `${id} ${variant}`;
const cardNames = (cards: readonly Card[]) => cards.map((card) => card.name);

function run(edition: Edition, id: SampleId, variant: string): Run {
  const sample = captured.get(edition)?.get(fixtureKey(id, variant));
  if (!sample) throw new Error(`Missing legacy capture: ${edition} ${id} ${variant}`);
  return sample;
}

function states(capture: Run): State[] {
  return [capture.initial, ...capture.steps.map((step) => step.state)].filter((state) => state !== null);
}

function final(capture: Run): State {
  const result = capture.steps.at(-1)?.state;
  if (!result) throw new Error('Expected a final legacy state');
  return result;
}

function unit(state: State, seat: Seat, name: string): Unit {
  const found = state.seats[seat].board.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing ${name} from ${seat}'s board`);
  return found;
}

function terminalWinner(state: State): Seat | null {
  if (state.winner === 'A' || state.winner === 'player') return 'A';
  if (state.winner === 'B' || state.winner === 'ai') return 'B';
  return null;
}

function expectUntouched(before: State, after: State) {
  expect(after.seats).toEqual(before.seats);
  expect(after.turn).toBe(before.turn);
  expect(after.winner).toBe(before.winner);
  expect(after.finale).toEqual(before.finale);
}

describe('legacy baseline source integrity', () => {
  test.each(editions)('%s verifies the original tracked page against its recorded SHA-256', (edition) => {
    const expectedPage = `quote/临界·模块化·${edition.toUpperCase()}版.html`;
    const source = fixtures.sources[edition];
    expect(source.path).toBe(expectedPage);
    const sourceBytes = readFileSync(new URL(`../../${expectedPage}`, import.meta.url));
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(source.sha256);
  });

  test('covers each required sample and its variants exactly once', () => {
    expect(fixtures.scenarios.map(({ id, variant }) => fixtureKey(id, variant)).sort()).toEqual(
      Object.entries(expectedVariants).flatMap(([id, variants]) => variants.map((variant) => fixtureKey(id, variant))).sort(),
    );
  });
});

describe.each(editions)('legacy %s gameplay', (edition) => {
  beforeAll(async () => {
    const runs = await Promise.all(
      fixtures.scenarios.map(async (fixture: Fixture) => {
        const inputs = {
          initial: fixture.initial,
          steps: fixture.steps.map(({ action }) => ({ action })),
        };
        const actual = (await captureLegacyScenario(edition, inputs)) as Run;
        return [fixtureKey(fixture.id, fixture.variant), actual] as const;
      }),
    );
    captured.set(edition, new Map(runs));
  }, 30_000);

  test.each(fixtures.scenarios)('$id $variant replays the fixed initialization and ordered observations', (fixture) => {
    const capture = run(edition, fixture.id as SampleId, fixture.variant);
    expect(capture.initial).toEqual(fixture.initialObserved[edition]);
    expect(capture.steps).toEqual(fixture.steps.map((step) => step.observed[edition]));
    const terminalStep = fixture.id === 'LG-09' || fixture.variant === 'threshold';
    const nonterminal = terminalStep ? capture.steps.slice(0, -1) : capture.steps;
    for (const step of nonterminal) {
      if (step.state) expect(step.state.winner).toBeNull();
    }
  });

  test('pins the original built-in cards and preset lists', () => {
    const definitions = legacyDefinitions(edition);
    expect(definitions.cardDefinitions).toEqual(fixtures.cardDefinitions[edition]);
    expect(definitions.presets).toEqual(fixtures.presets[edition]);
  });

  test('correlates the separately recorded browser observations with the old source captures', () => {
    const evidence = fixtures.browserEvidence.editions[edition];
    expect(fixtures.browserEvidence.runtime).toMatch(/Playwright.*Chromium/);
    expect(Object.keys(evidence.response).sort()).toEqual(['decline', 'flip', 'invalid']);
    for (const variant of ['flip', 'decline', 'invalid'] as const) {
      const response = evidence.response[variant];
      const [, paused, settled] = states(run(edition, 'LG-06', variant));
      expect(response.options).toEqual(['-1', '0:0']);
      expect(response.paused).toEqual({
        hp: paused.seats.A.hp, ap: paused.seats.B.ap, attacked: unit(paused, 'B', '火鸦').attacked,
      });
      expect(response.settled).toEqual({
        hp: settled.seats.A.hp, ap: settled.seats.B.ap, attacked: unit(settled, 'B', '火鸦').attacked,
        keep: cardNames(settled.seats.A.facedown), grave: cardNames(settled.seats.A.grave),
      });
    }

    const iceVariants = {
      playable: 'playable', unplayable: 'unplayable', restart: 'restart', empty: 'empty',
      single: 'one-playable', 'single-unplayable': 'one-unplayable', double: 'two',
    } as const;
    expect(Object.keys(evidence.ice).sort()).toEqual(Object.keys(iceVariants).sort());
    for (const browserVariant of Object.keys(iceVariants) as (keyof typeof iceVariants)[]) {
      const observed = evidence.ice[browserVariant];
      const sample = run(edition, 'LG-08', iceVariants[browserVariant]);
      expect(observed.candidates).toEqual(cardNames(sample.steps[0].state?.pending?.candidates ?? []));
      if ('settled' in observed) {
        const player = final(sample).seats.A;
        expect(observed.settled).toEqual({
          ice: cardNames(player.ice), board: cardNames(player.board), grave: cardNames(player.grave),
        });
      } else {
        expect(observed.reloaded).toEqual({ game: null, archived: 0 });
        expect(sample.steps[1].state).toBeNull();
      }
    }

    const surrender = final(run(edition, 'LG-09', 'surrender'));
    expect(evidence.surrender).toEqual({
      winner: 'ai', hp: [surrender.seats.A.hp, surrender.seats.B.hp], title: '你认输了', reason: '本局判负',
      actions: ['surrender'], archivedActions: [],
    });
    if (edition === '3d') {
      expect(fixtures.browserEvidence.editions['3d'].responseRadioHit).toEqual({ pointerEvents: 'none', hit: 'gl' });
    }
  });

  test('LG-01 deals ordered preset cards and permits a single first-turn mulligan', () => {
    const mulligan = run(edition, 'LG-01', 'mulligan');
    const [opening, replaced, duplicate] = states(mulligan);
    const dealOrder = mulligan.steps[0].trace
      .filter(({ event }) => event === 'drawCard' || event === 'startTurn')
      .map(({ event, seat }) => `${event} ${seat}`);
    expect(dealOrder).toEqual([
      'drawCard A', 'drawCard A', 'drawCard A', 'drawCard B', 'drawCard B',
      'drawCard B', 'drawCard B', 'startTurn A', 'drawCard A',
    ]);
    expect(opening.activeSeat).toBe('A');
    expect(opening.phase).toBe('player-main');
    expect(opening.turn).toBe(1);
    expect(opening.seats.A.ap).toBe(0);
    expect(cardNames(opening.seats.A.hand)).toEqual(fixtures.presets[edition].A.list.slice(0, 4));
    expect(cardNames(opening.seats.B.hand)).toEqual(fixtures.presets[edition].B.list.slice(0, 4));
    const reversed = [...fixtures.presets[edition].A.list].reverse();
    expect(cardNames(replaced.seats.A.hand)).toEqual(reversed.slice(0, 4));
    expect(cardNames(replaced.seats.A.deck)).toEqual(reversed.slice(4));
    expectUntouched(replaced, duplicate);

    const late = states(run(edition, 'LG-01', 'out-of-window'));
    expect(late.at(-2)!.turn).not.toBe(1);
    expectUntouched(late.at(-2)!, late.at(-1)!);
  });

  test('LG-02 resolves Flame Mark damage before drawing and rejects play in battle mode', () => {
    const cast = run(edition, 'LG-02', 'main');
    const end = final(cast);
    expect(end.seats.A.ap).toBe(states(cast)[0].seats.A.ap);
    expect(cardNames(end.seats.A.hand)).toEqual(['金乌']);
    expect(cardNames(end.seats.A.grave)).toEqual(['炎纹']);
    expect(end.seats.B.board).toEqual([]);
    expect(cardNames(end.seats.B.grave)).toEqual(['火鸦']);
    const trace = cast.steps.flatMap((step) => step.trace).filter(({ event }) => event !== 'log');
    expect(trace).toMatchObject([
      { event: 'damageUnit', seat: 'B', target: '火鸦', amount: 3 },
      { event: 'killUnit', seat: 'B', card: '火鸦' },
      { event: 'drawCard', seat: 'A', card: '金乌' },
    ]);

    const blocked = run(edition, 'LG-02', 'battle-mode');
    expectUntouched(states(blocked)[0], final(blocked));
  });

  test('LG-03 rejects an attack on a protected core and consumes AP only once', () => {
    const attack = run(edition, 'LG-03', 'attack');
    const [initial, , rejected, hit, repeat] = states(attack);
    expectUntouched(initial, rejected);
    expect(rejected.seats.B.hp).toBe(50);
    expect(hit.seats.A.ap).toBe(0);
    expect(unit(hit, 'A', '火鸦').attacked).toBe(true);
    expect(unit(hit, 'A', '火鸦').hp).toBe(unit(initial, 'A', '火鸦').hp);
    expect(unit(hit, 'B', '冰夷').hp).toBe(1);
    expectUntouched(hit, repeat);
  });

  test('LG-04 rejects an incompatible unit and replaces the matching board slot', () => {
    const [initial, , rejected, evolved] = states(run(edition, 'LG-04', 'evolve'));
    expectUntouched(initial, rejected);
    expect(cardNames(evolved.seats.A.board)).toEqual(['三足金乌', '毕方']);
    expect(cardNames(evolved.seats.A.grave)).toEqual(['火鸦']);
    expect(evolved.seats.A.hand).toEqual([]);
    expect(unit(evolved, 'A', '三足金乌')).toMatchObject({ hp: 4, canAttack: true });
  });

  test('LG-05 applies the death-trigger boost only during the skill turn', () => {
    const active = run(edition, 'LG-05', 'same-turn');
    const [initial, armed, repeat, attemptedAttack] = states(active);
    expect(unit(armed, 'A', '火鸦').skillLock).toBe(true);
    expectUntouched(armed, repeat);
    expectUntouched(repeat, attemptedAttack);
    const sameTurn = final(active);
    const trace = active.steps.at(-1)!.trace.filter(({ event }) => event !== 'log');
    expect(trace).toMatchObject([
      { event: 'killUnit', seat: 'A', card: '毕方', graveBefore: 0, graveAfter: 1 },
      { event: 'drawCard', seat: 'A', card: '金乌' },
    ]);
    expect(cardNames(sameTurn.seats.A.grave)).toContain('毕方');
    expect(cardNames(sameTurn.seats.A.hand)).toContain('金乌');
    const startingAttack = unit(initial, 'A', '火鸦').atk;
    expect(unit(sameTurn, 'A', '火鸦').atk).toBe(startingAttack + 1);
    const afterTurn = final(run(edition, 'LG-05', 'after-turn'));
    expect(unit(afterTurn, 'A', '火鸦').atk).toBe(startingAttack);
  });

  test('LG-06 pauses the AI attack and documents the invalid legacy choice as a decline', () => {
    for (const variant of ['flip', 'decline', 'invalid']) {
      const attack = run(edition, 'LG-06', variant);
      const ended = final(attack);
      const paused = states(attack).at(-2)!;
      expect(paused.pending).toMatchObject({
        kind: 'response',
        owner: 'A',
        visibleTo: ['A'],
        groups: [{ trigger: 'attackCore', cards: [{ name: '镇岳' }] }],
      });
      expect(paused.seats.A.hp).toBe(50);
      expect(paused.seats.B.ap).toBe(1);
      expect(unit(paused, 'B', '火鸦').attacked).toBe(false);
      expect(ended.pending).toBeNull();
      expect(ended.seats.B.ap).toBe(0);
      expect(unit(ended, 'B', '火鸦').attacked).toBe(true);
      expect(ended.winner).toBeNull();
      expect(ended.seats.A.hp).toBe(variant === 'flip' ? 50 : 47);
      expect(cardNames(ended.seats.A.grave)).toEqual(variant === 'flip' ? ['镇岳'] : []);
      expect(cardNames(ended.seats.A.facedown)).toEqual(variant === 'flip' ? [] : ['镇岳']);
    }
  });

  test('LG-07 applies the 40-card threshold after discarding and enters terminal combat', () => {
    const finale = run(edition, 'LG-07', 'threshold');
    const [, redraw, started] = states(finale);
    expect(redraw.finale).toBeTruthy();
    expect(cardNames(redraw.seats.A.hand)).toEqual(Array(6).fill('金乌'));
    expect(cardNames(redraw.seats.B.hand)).toEqual(Array(7).fill('冰夷'));
    expect(redraw.seats.A.grave.length + redraw.seats.B.grave.length).toBe(40);
    const checkpoints = finale.steps[0].trace.filter(({ event }) => ['checkFinale', 'redrawFinale'].includes(event));
    expect(checkpoints).toMatchObject([
      { event: 'checkFinale', seat: 'A', graveTotal: 40 },
      { event: 'redrawFinale', seat: 'A', count: 6 },
      { event: 'redrawFinale', seat: 'B', count: 7 },
    ]);
    expect(started.activeSeat).toBe('B');
    expect(cardNames(started.seats.B.hand)).toEqual(Array(8).fill('冰夷'));
    expect(started.winner).toBeNull();
    const ended = final(finale);
    expect(ended.seats.B.ap).toBe(started.seats.B.ap);
    expect(ended.seats.A.hp).toBe(0);
    expect(terminalWinner(ended)).toBe('B');
    const below = final(run(edition, 'LG-07', 'below-threshold'));
    expect(below.finale).toBeNull();
    expect(below.seats.A.grave.length + below.seats.B.grave.length).toBe(39);
  });

  test('LG-08 pauses for existing candidates and handles playable, failed and empty Ice Spring selections', () => {
    const playable = run(edition, 'LG-08', 'playable');
    const unplayable = run(edition, 'LG-08', 'unplayable');
    const playableEnd = final(playable);
    const unplayableEnd = final(unplayable);
    const paused = states(playable)[1].pending;
    expect(paused).toMatchObject({ kind: 'icePick', owner: 'A' });
    expect(cardNames(paused?.candidates ?? [])).toEqual(['火鸦', '三足金乌', '毕方']);
    expect(playable.steps[0].random).toHaveLength(3);
    expect(playable.steps[1].random).toEqual([]);
    expect(cardNames(playableEnd.seats.A.ice)).toEqual(['金乌']);
    expect(cardNames(playableEnd.seats.A.board)).toEqual(['探珠', '火鸦']);
    expect(cardNames(playableEnd.seats.A.grave)).toEqual(['三足金乌', '毕方']);
    expect(cardNames(unplayableEnd.seats.A.ice)).toEqual(['金乌', '三足金乌']);
    expect(cardNames(unplayableEnd.seats.A.board)).toEqual(['探珠']);
    expect(cardNames(unplayableEnd.seats.A.grave)).toEqual(['火鸦', '毕方']);
    expect(final(run(edition, 'LG-08', 'empty')).pending).toBeNull();
    const smallCandidates = [
      ['one-playable', ['火鸦'], ['探珠', '火鸦'], [], []],
      ['one-unplayable', ['三足金乌'], ['探珠'], ['三足金乌'], []],
      ['two', ['火鸦', '三足金乌'], ['探珠', '火鸦'], [], ['三足金乌']],
    ] as const;
    for (const [variant, names, board, ice, grave] of smallCandidates) {
      const sample = run(edition, 'LG-08', variant);
      const selection = states(sample)[1].pending;
      expect(selection, variant).toMatchObject({ kind: 'icePick', owner: 'A' });
      expect(cardNames(selection?.candidates ?? [])).toEqual(names);
      const ended = final(sample);
      expect(ended.pending).toBeNull();
      expect(cardNames(ended.seats.A.board)).toEqual(board);
      expect(cardNames(ended.seats.A.ice)).toEqual(ice);
      expect(cardNames(ended.seats.A.grave)).toEqual(grave);
    }

    const restart = run(edition, 'LG-08', 'restart');
    expect(restart.steps[0].state?.pending).toEqual(paused);
    expect(restart.steps[1]).toMatchObject({
      state: null,
      trace: [{ event: 'page-reload', archivedMatches: 0 }],
      random: [],
    });
  });

  test('LG-09 surrenders with unchanged core life and a recorded surrender action', () => {
    const surrender = run(edition, 'LG-09', 'surrender');
    const ended = final(surrender);
    const [initial] = states(surrender);
    expect(initial.winner).toBeNull();
    expect(initial.seats.A.hp).toBeGreaterThan(0);
    expect(initial.seats.B.hp).toBeGreaterThan(0);
    expect(terminalWinner(ended)).toBe('B');
    expect(ended.seats.A.hp).toBe(initial.seats.A.hp);
    expect(ended.seats.B.hp).toBe(initial.seats.B.hp);
    expect(ended.replay).toMatchObject({ actions: [{ t: 'surrender' }], result: 'ai', archivedActions: [] });
    expect(surrender.steps[0].random).toEqual([]);
    expect(surrender.steps[0].trace).toMatchObject([{ event: 'endGame', title: '你认输了', reason: '本局判负' }]);
  });
});
