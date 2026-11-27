import { execFileSync } from 'node:child_process'
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatChineseChangelogFromCommits,
  inferArtifactKind,
  inferArtifactTarget,
  loadEnvFileIfExists,
} from './workopc-release-helpers.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'scripts/release-local/.env.local')

function parseArgs(argv) {
  const args = {
    files: [],
    publish: false,
    publishOnly: false,
    autoNotes: false,
    notesOut: '',
    signed: undefined,
    notarized: undefined,
    channel: 'stable',
    rollout: 100,
    mandatory: false,
    minSupported: '',
    notes: '',
    commitSha: '',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--base-url': args.baseUrl = argv[++i]; break
      case '--version': args.version = argv[++i]; break
      case '--channel': args.channel = argv[++i]; break
      case '--target': args.target = argv[++i]; break
      case '--notes': args.notes = argv[++i]; break
      case '--notes-out': args.notesOut = argv[++i]; break
      case '--auto-notes': args.autoNotes = true; break
      case '--rollout': args.rollout = Number(argv[++i]); break
      case '--min-supported': args.minSupported = argv[++i]; break
      case '--commit': args.commitSha = argv[++i]; break
      case '--mandatory': args.mandatory = true; break
      case '--publish': args.publish = true; break
      case '--publish-only': args.publishOnly = true; break
      case '--signed': args.signed = argv[++i] !== 'false'; break
      case '--notarized': args.notarized = argv[++i] !== 'false'; break
      case '--file': args.files.push(argv[++i]); break
      default:
        if (!a.startsWith('--')) args.files.push(a)
    }
  }
  return args
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function commitExists(sha) {
  if (!sha) return false
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function collectChineseChangelog(existingReleases, currentVersion) {
  const currentTag = `v${String(currentVersion || '').replace(/^v/u, '')}`
  const targetRef = commitExists(currentTag) ? currentTag : 'HEAD'
  const tagsRaw = gitOutput(['tag', '-l', 'v*', '--sort=-v:refname'])
  const prevTag = tagsRaw
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .find((t) => /^v\d+\.\d+\.\d+/.test(t) && t !== currentTag)

  const prevRelease = (existingReleases || []).find(
    (r) => r.version !== currentVersion && r.commit_sha && (r.status === 'published' || r.status === 'archived'),
  )
  let rawLog = ''
  if (prevTag && commitExists(prevTag)) {
    rawLog = gitOutput(['log', '--no-merges', '--pretty=format:%s', `${prevTag}..${targetRef}`])
  } else if (prevRelease && commitExists(prevRelease.commit_sha)) {
    rawLog = gitOutput(['log', '--no-merges', '--pretty=format:%s', `${prevRelease.commit_sha}..${targetRef}`])
  }
  if (!rawLog) {
    rawLog = gitOutput(['log', '--no-merges', '-n', '12', '--pretty=format:%s', targetRef])
  }
  const subjects = rawLog ? rawLog.split(/\r?\n/u) : []
  return formatChineseChangelogFromCommits(subjects)
}

async function apiJson(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  if (!res.ok || json.code !== 0) {
    throw new Error(json.message || `HTTP ${res.status}`)
  }
  return json.data
}

async function ensureRelease(baseUrl, token, args, existingList) {
  const existing = existingList.find((r) => r.version === args.version && r.channel === args.channel)
  if (existing) {
    console.log(`Reusing existing release ${existing.id} (${existing.version} ${existing.channel})`)
    const updates = {}
    if (!existing.release_notes && args.notes) updates.release_notes = args.notes
    if (!existing.commit_sha && args.commitSha) updates.commit_sha = args.commitSha
    if (Object.keys(updates).length > 0) {
      await apiJson(`${baseUrl}/admin/api/workopc/releases/${existing.id}`, token, {
        method: 'PUT',
        body: JSON.stringify(updates),
      })
    }
    return existing
  }
  const created = await apiJson(`${baseUrl}/admin/api/workopc/releases`, token, {
    method: 'POST',
    body: JSON.stringify({
      version: args.version,
      channel: args.channel,
      release_notes: args.notes,
      rollout_percentage: args.rollout,
      is_mandatory: args.mandatory,
      min_supported_version: args.minSupported,
      commit_sha: args.commitSha,
    }),
  })
  console.log(`Created release draft ${created.id} (${created.version} ${created.channel})`)
  return created
}

async function uploadArtifact(baseUrl, token, releaseId, target, kind, filePath, signed, notarized) {
  const name = basename(filePath)
  const size = statSync(filePath).size
  const params = new URLSearchParams({
    target,
    filename: name,
    signed: String(signed),
    notarized: String(notarized),
  })
  if (kind) params.set('kind', kind)
  const url = `${baseUrl}/admin/api/workopc/releases/${releaseId}/artifacts?${params.toString()}`
  console.log(`Uploading ${name} (${size} bytes) -> ${target} (${kind || 'auto'})...`)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
    },
    body: createReadStream(filePath),
    duplex: 'half',
  })
  const json = await res.json()
  if (!res.ok || json.code !== 0) {
    throw new Error(`Upload ${name} failed: ${json.message || res.status}`)
  }
  console.log(`Uploaded ${name}: sha256=${json.data.sha256}`)
  return json.data
}

function installerFilename(version, target) {
  if (target === 'win-x64') return `WorkOPC-${version}-win-x64.exe`
  if (target === 'mac-x64') return `WorkOPC-${version}-mac-x64.dmg`
  return `WorkOPC-${version}-mac-arm64.dmg`
}

async function main() {
  loadEnvFileIfExists(DEFAULT_ENV_FILE)

  const args = parseArgs(process.argv.slice(2))
  const baseUrl = (args.baseUrl || process.env.WORKOPC_PLATFORM_URL || 'https://aiwork.benlai.com').replace(/\/+$/u, '')
  const token = process.env.WORKOPC_ADMIN_KEY || process.env.PLATFORM_ADMIN_KEY
  if (!token) throw new Error('WORKOPC_ADMIN_KEY (or PLATFORM_ADMIN_KEY) is required')
  if (!args.version) throw new Error('--version is required')
  if (args.publishOnly) {
    const list = await apiJson(`${baseUrl}/admin/api/workopc/releases?channel=${encodeURIComponent(args.channel)}`, token)
    const rel = list.find((r) => r.version === args.version && r.channel === args.channel)
    if (!rel) throw new Error(`Release ${args.version} (${args.channel}) not found`)
    await apiJson(`${baseUrl}/admin/api/workopc/releases/${rel.id}/publish`, token, { method: 'POST' })
    console.log(`Published release ${rel.version} (${rel.channel})`)
    console.log(`管理后台    : ${baseUrl}/admin/workopc`)
    return
  }
  if (args.files.length === 0) throw new Error('At least one --file is required')

  const fileJobs = args.files.map((filePath) => {
    const name = basename(filePath)
    const target = args.target || inferArtifactTarget(name)
    if (!target) {
      throw new Error(`Cannot infer target platform from filename: ${name}. Pass --target mac-arm64|mac-x64|win-x64.`)
    }
    const kind = inferArtifactKind(name)
    const isMac = target.startsWith('mac-')
    const signed = args.signed !== undefined ? args.signed : isMac
    const notarized = args.notarized !== undefined ? args.notarized : isMac
    return { filePath, name, target, kind, signed, notarized }
  })

  if (!args.commitSha) {
    args.commitSha = gitOutput(['rev-parse', '--short', 'HEAD'])
  }

  const existingList = await apiJson(`${baseUrl}/admin/api/workopc/releases?channel=${encodeURIComponent(args.channel)}`, token)

  if (!args.notes && args.autoNotes) {
    args.notes = collectChineseChangelog(existingList, args.version)
  }
  if (args.notes && args.notesOut) {
    mkdirSync(dirname(args.notesOut), { recursive: true })
    writeFileSync(args.notesOut, `${args.notes}\n`, 'utf8')
  }

  const rel = await ensureRelease(baseUrl, token, args, existingList)
  const uploaded = []
  for (const job of fileJobs) {
    const art = await uploadArtifact(baseUrl, token, rel.id, job.target, job.kind, job.filePath, job.signed, job.notarized)
    uploaded.push({ ...job, sha256: art.sha256 })
  }

  let finalStatus = rel.status || 'draft'
  if (args.publish) {
    await apiJson(`${baseUrl}/admin/api/workopc/releases/${rel.id}/publish`, token, { method: 'POST' })
    finalStatus = 'published'
    console.log(`Published release ${rel.version} (${rel.channel})`)
  }

  const targets = Array.from(new Set(uploaded.map((u) => u.target)))
  console.log('')
  console.log('================ WorkOPC 发布中心同步完成 ================')
  console.log(`版本 / 通道 : ${rel.version} (${rel.channel})`)
  console.log(`当前状态    : ${finalStatus === 'published' ? '已发布' : '草稿（未发布，需确认发布后生效）'}`)
  console.log(`管理后台    : ${baseUrl}/admin/workopc`)
  if (args.notes) {
    console.log('更新日志    :')
    for (const line of args.notes.split(/\r?\n/u)) {
      console.log(`  ${line}`)
    }
  }
  for (const t of targets) {
    console.log(`最新固定直链 (${t}) : ${baseUrl}/workopc/download/${t}`)
    console.log(`指定版本直链 (${t}) : ${baseUrl}/workopc/installers/${rel.id}/${t}/${installerFilename(rel.version, t)}`)
  }
  console.log('==========================================================')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
