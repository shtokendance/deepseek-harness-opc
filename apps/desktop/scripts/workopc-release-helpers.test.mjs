import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inferArtifactTarget,
  inferArtifactKind,
  formatChineseChangelogFromCommits,
  loadEnvFileIfExists,
} from './workopc-release-helpers.mjs'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('inferArtifactTarget detects mac-arm64, mac-x64, win-x64 and returns empty when ambiguous', () => {
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-mac-arm64.dmg'), 'mac-arm64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-mac-arm64.zip'), 'mac-arm64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-mac-arm64.zip.blockmap'), 'mac-arm64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-aarch64.dmg'), 'mac-arm64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-mac-x64.dmg'), 'mac-x64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-intel.zip'), 'mac-x64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-win-x64.exe'), 'win-x64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5-win-x64.exe.blockmap'), 'win-x64')
  assert.equal(inferArtifactTarget('WorkOPC-Setup-0.2.5.exe'), 'win-x64')
  assert.equal(inferArtifactTarget('WorkOPC-0.2.5.dmg'), '')
})

test('inferArtifactKind detects all supported extensions', () => {
  assert.equal(inferArtifactKind('WorkOPC-0.2.5-mac-arm64.dmg'), 'dmg')
  assert.equal(inferArtifactKind('WorkOPC-0.2.5-mac-arm64.zip'), 'zip')
  assert.equal(inferArtifactKind('WorkOPC-0.2.5-mac-arm64.zip.blockmap'), 'zip_blockmap')
  assert.equal(inferArtifactKind('WorkOPC-0.2.5-win-x64.exe'), 'exe')
  assert.equal(inferArtifactKind('WorkOPC-0.2.5-win-x64.exe.blockmap'), 'exe_blockmap')
  assert.equal(inferArtifactKind('README.txt'), '')
})

test('formatChineseChangelogFromCommits translates English commits, keeps Chinese, and filters merges/bumps', () => {
  const input = [
    'Merge fix/workopc-plugin-update-and-changelog into release',
    'chore(desktop): bump version to 0.2.5',
    'fix(workopc): enable registry update check for bundled plugins, seed dshmarket in existing profiles, and load changelog with CORS',
    'feat(release): add one-click macOS DMG and auto-update release script',
    'feat(workopc): bundle dshmarket, add changelog modal, add OPC left sidebar (0.1.73), and bump to 0.2.4',
    'fix(desktop): 修复更新日志弹窗高度遮挡问题',
    'chore(desktop): misc internal cleanup without keywords',
  ]
  const result = formatChineseChangelogFromCommits(input)
  assert.ok(!result.includes('Merge '))
  assert.ok(!result.includes('bump version'))
  assert.ok(!/[A-Za-z]{4,}\s+[a-z]{3,}/.test(result), `Expected Chinese output without raw English sentences, got:\n${result}`)
  assert.ok(result.includes('修复：'))
  assert.ok(result.includes('新增：'))
  assert.ok(result.includes('修复更新日志弹窗高度遮挡问题'))
  assert.ok(result.includes('更新日志'))
  assert.ok(result.includes('dshmarket'))
})

test('formatChineseChangelogFromCommits returns Chinese fallback when empty after filtering', () => {
  const result = formatChineseChangelogFromCommits([
    'Merge pull request #12 from release',
    'chore(desktop): bump version to 0.2.6',
  ])
  assert.equal(result, '- 优化：常规功能改进与问题修复')
})

test('loadEnvFileIfExists parses KEY=VALUE without overwriting existing keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workopc-env-'))
  try {
    const envPath = join(dir, '.env.local')
    writeFileSync(envPath, "WORKOPC_ADMIN_KEY='secret-123'\nWORKOPC_PLATFORM_URL=https://aiwork.benlai.com\n", 'utf8')
    const targetEnv = { WORKOPC_PLATFORM_URL: 'https://custom.local' }
    loadEnvFileIfExists(envPath, targetEnv)
    assert.equal(targetEnv.WORKOPC_ADMIN_KEY, 'secret-123')
    assert.equal(targetEnv.WORKOPC_PLATFORM_URL, 'https://custom.local')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
