import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrontendInstaller } from '../../src/clients/launcher/install'
import { FrontendPackageStore } from '../../src/clients/launcher/package-store'
import { frontendInstallPackages } from '../acceptance/fixtures/frontend-install-packages'

const samples = frontendInstallPackages('<!doctype html><title>Initial</title>', '<!doctype html><title>Upgrade</title>')

function file(value: unknown) {
  return new Blob([JSON.stringify(value)])
}

const stores: FrontendPackageStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

function verifyEarlyRejection(maxPackageBytes?: number) {
  const store = new FrontendPackageStore(new URL('https://fixture.invalid/'))
  stores.push(store)
  const lookup = vi.spyOn(store, 'get')
  const checkCandidate = vi.fn()
  const confirmSource = vi.fn()
  return {
    installer: new FrontendInstaller(store, checkCandidate, { maxPackageBytes }),
    confirmSource,
    assertNoSideEffects: () => {
      expect(lookup).not.toHaveBeenCalled()
      expect(confirmSource).not.toHaveBeenCalled()
      expect(checkCandidate).not.toHaveBeenCalled()
    },
  }
}

describe('frontend package validation before staging', () => {
  it('checks the UTF-8 byte limit before reading or decoding the file', async () => {
    const { installer, confirmSource, assertNoSideEffects } = verifyEarlyRejection(3)
    const value = new Blob(['界a'])
    const read = vi.spyOn(value, 'arrayBuffer')
    expect(value.size).toBe(4)
    await expect(installer.install(value, confirmSource)).rejects.toMatchObject({ code: 'package-too-large' })
    expect(read).not.toHaveBeenCalled()
    assertNoSideEffects()
  })

  it.each([
    { title: 'malformed JSON', value: new Blob(['{']), code: 'package-corrupt' },
    { title: 'invalid UTF-8', value: new Blob([new Uint8Array([0xC3, 0x28])]), code: 'package-corrupt' },
    { title: 'unknown package format', value: file({ ...samples.initial, formatVersion: 2 }), code: 'format-incompatible' },
    { title: 'invalid ID', value: file({ ...samples.initial, id: 'Invalid.ID' }), code: 'package-corrupt' },
    { title: 'invalid semantic version', value: file({ ...samples.initial, version: '1.0.0-01' }), code: 'package-corrupt' },
    { title: 'empty entry', value: file({ ...samples.initial, entryHtml: '   ' }), code: 'resource-missing' },
    { title: 'incompatible major protocol', value: file(samples.incompatibleMajor), code: 'protocol-incompatible',
      diagnostic: 'major-version-mismatch' },
    { title: 'no common minor protocol', value: file(samples.incompatibleMinor), code: 'protocol-incompatible',
      diagnostic: 'no-common-minor-version' },
  ])('rejects $title without storage or confirmation', async ({ value, code, diagnostic }) => {
    const { installer, confirmSource, assertNoSideEffects } = verifyEarlyRejection()
    await expect(installer.install(value, confirmSource)).rejects.toMatchObject({
      code,
      ...(diagnostic ? { message: expect.stringContaining(diagnostic) } : {}),
    })
    assertNoSideEffects()
  })
})
