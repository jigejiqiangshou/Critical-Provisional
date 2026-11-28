import { expect, it } from 'vitest'
import { captureLegacyScenario } from './legacy-runtime.mjs'

it.each(['2d', '3d'] as const)('%s: legacy response resolves while deployment choice is still pending', async edition => {
  const initial = { mode: 'confirmed-state', template: { A: 'A', B: 'B' }, turn: 7, phase: 'player-main',
    seats: { A: { hand: ['焰羽'], deck: ['火鸦', '毕方'] }, B: { facedown: ['虎啸'] } } }
  const captured = await captureLegacyScenario(edition, { initial, steps: [{ action: { name: 'playCard', args: [0] } }] })
  const step = captured.steps[0] as { state: { effect: { card: string; index: number }; seats: { A: { board: unknown[]; grave: { name: string }[] }; B: { grave: { name: string }[] } } }; trace: { event: string; target?: string }[] }
  expect(step.state.effect).toMatchObject({ card: '焰羽', index: 0 })
  expect(step.state.seats.A.board).toHaveLength(0)
  expect(step.state.seats.A.grave.map(card => card.name)).toEqual(['焰羽'])
  expect(step.state.seats.B.grave.map(card => card.name)).toEqual(['虎啸'])
  expect(step.trace).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'damageUnit', target: '焰羽' })]))
})
