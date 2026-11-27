import { execFileSync } from 'node:child_process'
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareSemver,
  formatChineseChangelogFromCommits,
  getNextSemver,
  normalizeTagName,
} from './workopc-release-helpers.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')

function parseArgs(argv) {
  const args = {
    version: '',
    suggest: false,
    noPull: false,
    noPush: false,
    skipGhRelease: false,
    notesOut: '',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--version': args.version = argv[++i]; break
      case '--suggest': args.suggest = true; break
      case '--no-pull': args.noPull = true; break
      case '--no-push': args.noPush = true; break
      case '--skip-gh-release': args.skipGhRelease = true; break
      case '--notes-out': args.notesOut = argv[++i]; break
      default:
        if (!a.startsWith('--') && !args.version) args.version = a
    }
  }
  return args
}

function runGit(args, opts = {}) {
  const pathParts = [
    dirname(process.execPath),
    process.env.PATH,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.HOME ? `${process.env.HOME}/.local/share/pnpm` : '',
  ].filter(Boolean)
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: pathParts.join(':') },
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })?.trim?.() || ''
}

function tryGit(args) {
  try {
    return runGit(args)
  } catch {
    return ''
  }
}

function listSemverTags() {
  const out = tryGit(['tag', '-l', 'v*', '--sort=-v:refname'])
  if (!out) return []
  return out
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .filter((s) => /^v\d+\.\d+\.\d+/.test(s))
}

function getPackageVersion() {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
  return String(pkg.version || '').trim()
}

function bumpAllManifests(fromVersion, toVersion) {
  if (!fromVersion || !toVersion || fromVersion === toVersion) return 0
  const files = [
    'package.json',
    ...globSync('apps/*/package.json', { cwd: REPO_ROOT }),
    ...globSync('packages/*/*/package.json', { cwd: REPO_ROOT }),
  ]
  let count = 0
  for (const rel of files) {
    const full = resolve(REPO_ROOT, rel)
    const txt = readFileSync(full, 'utf8')
    const json = JSON.parse(txt)
    if (json.version === fromVersion) {
      writeFileSync(full, txt.replace(`"version": "${fromVersion}"`, `"version": "${toVersion}"`), 'utf8')
      count++
    }
  }
  return count
}

function buildSuggestion() {
  const currentPackageVersion = getPackageVersion()
  const tags = listSemverTags()
  const latestTag = tags[0] || ''
  const latestTagVersion = latestTag.replace(/^v/u, '')
  const headTags = tryGit(['tag', '--points-at', 'HEAD']).split(/\r?\n/u).filter(Boolean)
  const headMatchesLatestTag = Boolean(latestTag && headTags.includes(latestTag))

  let defaultBuildVersion = ''
  if (headMatchesLatestTag && latestTagVersion) {
    defaultBuildVersion = latestTagVersion
  } else if (latestTagVersion && compareSemver(latestTagVersion, currentPackageVersion) > 0) {
    defaultBuildVersion = latestTagVersion
  } else {
    const base = latestTagVersion && compareSemver(latestTagVersion, currentPackageVersion) >= 0
      ? latestTagVersion
      : currentPackageVersion
    defaultBuildVersion = getNextSemver(base)
  }

  return {
    currentPackageVersion,
    latestTag,
    latestTagVersion,
    headMatchesLatestTag,
    suggestedNextVersion: getNextSemver(
      latestTagVersion && compareSemver(latestTagVersion, currentPackageVersion) >= 0
        ? latestTagVersion
        : currentPackageVersion,
    ),
    defaultBuildVersion,
  }
}

function buildChangelogForRange(prevTag, targetRef) {
  const range = prevTag ? `${prevTag}..${targetRef}` : targetRef
  const args = ['log', '--no-merges', '--pretty=format:%s']
  if (!prevTag) args.push('-n', '15')
  args.push(range)
  const raw = tryGit(args)
  const subjects = raw ? raw.split(/\r?\n/u) : []
  return formatChineseChangelogFromCommits(subjects)
}

function hasGhAuth() {
  try {
    execFileSync('gh', ['auth', 'status'], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function ensureGithubRelease(tagName, version, notes) {
  if (!hasGhAuth()) {
    console.log(`[提示] 当前未登录 GitHub CLI (gh)，已跳过自动创建 GitHub Release。`)
    console.log(`如需补建 GitHub Release，请先运行: gh auth login`)
    console.log(`然后执行: gh release create ${tagName} --title "WorkOPC ${tagName}" --notes-file <release-notes.md>`)
    return false
  }
  try {
    execFileSync('gh', ['release', 'view', tagName], { cwd: REPO_ROOT, stdio: 'ignore' })
    console.log(`GitHub Release ${tagName} 已存在。`)
    return true
  } catch {
    const ghArgs = ['release', 'create', tagName, '--title', `WorkOPC ${tagName}`, '--notes', notes]
    if (version.includes('-')) ghArgs.push('--prerelease')
    execFileSync('gh', ghArgs, { cwd: REPO_ROOT, stdio: 'inherit' })
    console.log(`已创建 GitHub Release ${tagName}。`)
    return true
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.noPull) {
    runGit(['fetch', 'origin', 'release', '--tags'], { inherit: true })
  }

  if (args.suggest) {
    console.log(JSON.stringify(buildSuggestion()))
    return
  }

  const version = String(args.version || '').trim().replace(/^v/u, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error(`Invalid semver version: ${args.version}`)
  }

  const tagName = normalizeTagName(version)
  const allTags = listSemverTags()
  const tagExists = allTags.includes(tagName) || Boolean(tryGit(['rev-parse', '-q', '--verify', `refs/tags/${tagName}`]))

  if (tagExists) {
    const prevTag = allTags.find((t) => t !== tagName && compareSemver(t, tagName) < 0) || ''
    const notes = buildChangelogForRange(prevTag, tagName)
    if (args.notesOut) {
      mkdirSync(dirname(resolve(REPO_ROOT, args.notesOut)), { recursive: true })
      writeFileSync(resolve(REPO_ROOT, args.notesOut), `${notes}\n`, 'utf8')
    }
    if (!args.skipGhRelease) {
      ensureGithubRelease(tagName, version, notes)
    }
    console.log(`Using existing Git Tag ${tagName}`)
    return
  }

  if (tryGit(['status', '--porcelain'])) {
    throw new Error('Working tree has uncommitted changes. Please commit or stash them first.')
  }

  runGit(['checkout', 'release'], { inherit: true })
  if (!args.noPull) {
    runGit(['pull', '--ff-only', 'origin', 'release'], { inherit: true })
  }

  const currentVersion = getPackageVersion()
  if (version !== currentVersion) {
    const updatedCount = bumpAllManifests(currentVersion, version)
    if (updatedCount > 0) {
      runGit(['add', '-A'], { inherit: true })
      runGit(['commit', '-m', `chore(desktop): bump version to ${version}`], { inherit: true })
      if (!args.noPush) {
        runGit(['push', 'origin', 'release'], { inherit: true })
      }
    }
  }

  const prevTag = allTags.find((t) => compareSemver(t, tagName) < 0) || ''
  const notes = buildChangelogForRange(prevTag, 'HEAD')
  if (args.notesOut) {
    mkdirSync(dirname(resolve(REPO_ROOT, args.notesOut)), { recursive: true })
    writeFileSync(resolve(REPO_ROOT, args.notesOut), `${notes}\n`, 'utf8')
  }

  runGit(['tag', '-a', tagName, '-m', `WorkOPC ${tagName}\n\n${notes}`], { inherit: true })
  if (!args.noPush) {
    runGit(['push', 'origin', tagName], { inherit: true })
  }

  if (!args.skipGhRelease) {
    ensureGithubRelease(tagName, version, notes)
  }

  console.log(`Prepared Git Tag ${tagName}`)
}

main()
