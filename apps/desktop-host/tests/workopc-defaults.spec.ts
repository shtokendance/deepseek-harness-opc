import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeEntries, readProfilePatches, type Profile, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { expect, it, onTestFinished } from 'vitest'
import { workopcBundleDefaults } from '../src/workopc-defaults.ts'

it('applies the WorkOPC defaults to participating bundles and lets the user override them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workopc-defaults-'))
  onTestFinished(() => { rmSync(dir, { recursive: true }) })
  const profile: Profile = { name: 'desktop', dir, patchPath: join(dir, 'cordis.patch.yml'), skippedBundles: [],
    patches: [], layers: [
      { packageName: '@deepseek-ai/dsh-base', packageDir: dir, patchPaths: [], patches: [{ insert: [
        { id: 'agent-default-model', name: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      ] }] },
      { packageName: '@deepseek-ai/dsh-web-app', packageDir: dir, patchPaths: [], patches: [{ insert: [
        { id: 'agent-preset-registry', name: 'agent-preset-registry', config: { default: 'standard' } },
      ] }] },
      { packageName: 'dsh-browser-cdp', packageDir: dir, patchPaths: [], patches: [{ insert: [
        { id: 'dsh-browser-cdp', name: 'dsh-browser-cdp' },
      ] }] },
    ] }
  const ctx: ProfileContext = { name: 'desktop', dir, patchPath: profile.patchPath, installAnchor: join(dir, 'package.json'),
    cwd: dir, home: join(dir, 'home'), startedBundles: [], overlayPaths: [], telemetryDisabledEnv: undefined,
    bundleDefaults: workopcBundleDefaults }
  const rows = () => composeEntries([readProfilePatches('dsh', ctx, profile)])
  const configOf = (id: string): unknown => rows().find(row => row.id === id)?.config
  expect(rows().map(row => row.id)).toEqual(['agent-default-model', 'agent-preset-registry', 'dsh-browser-cdp'])
  expect(configOf('agent-default-model')).toEqual({
    provider: 'deepseek-official', model: 'deepseek-flash',
    preferred: { provider: 'opc-benlai-ai', name: 'Benlai/DeepSeek-V4.1-Flash（全局推荐）' },
  })
  expect(configOf('agent-preset-registry')).toEqual({ default: 'ptc' })
  expect(configOf('dsh-browser-cdp')).toEqual({ cdpMode: 'local' })
  // A choice the user saved into the profile patch outranks both defaults.
  profile.patches = [{ id: 'agent-preset-registry', config: { default: 'ptc', selectedDefault: 'standard' } },
    { id: 'dsh-browser-cdp', config: { cdpMode: 'auto' } }]
  expect(configOf('agent-preset-registry')).toEqual({ default: 'ptc', selectedDefault: 'standard' })
  expect(configOf('dsh-browser-cdp')).toEqual({ cdpMode: 'auto' })
  // Without the declaring bundle the default has no row to patch.
  profile.patches = []
  profile.layers.pop()
  expect(rows().some(row => row.id === 'dsh-browser-cdp')).toBe(false)
})
