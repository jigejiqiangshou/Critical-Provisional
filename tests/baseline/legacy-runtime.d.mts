export function legacySourceMetadata(edition: '2d' | '3d'): { path: string; sha256: string }

export function legacyDefinitions(edition: '2d' | '3d'): {
  cardDefinitions: Record<string, unknown>
  presets: Record<'A' | 'B', { name: string; desc: string; list: string[] }>
}

export function captureLegacyScenario(
  edition: '2d' | '3d',
  scenario: { initial: unknown; steps: { action: unknown }[] },
): Promise<{ initial: unknown; steps: unknown[] }>
