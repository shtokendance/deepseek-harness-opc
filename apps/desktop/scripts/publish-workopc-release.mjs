import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'

function parseArgs(argv) {
  const args = { files: [], publish: false, signed: true, notarized: false, channel: 'stable', rollout: 100, mandatory: false, minSupported: '', notes: '', commitSha: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--base-url': args.baseUrl = argv[++i]; break
      case '--version': args.version = argv[++i]; break
      case '--channel': args.channel = argv[++i]; break
      case '--target': args.target = argv[++i]; break
      case '--notes': args.notes = argv[++i]; break
      case '--rollout': args.rollout = Number(argv[++i]); break
      case '--min-supported': args.minSupported = argv[++i]; break
      case '--commit': args.commitSha = argv[++i]; break
      case '--mandatory': args.mandatory = true; break
      case '--publish': args.publish = true; break
      case '--signed': args.signed = argv[++i] !== 'false'; break
      case '--notarized': args.notarized = argv[++i] !== 'false'; break
      case '--file': args.files.push(argv[++i]); break
      default:
        if (!a.startsWith('--')) args.files.push(a)
    }
  }
  return args
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
  try { json = JSON.parse(text) } catch { throw new Error(`HTTP ${res.status}: ${text}`) }
  if (!res.ok || json.code !== 0) {
    throw new Error(json.message || `HTTP ${res.status}`)
  }
  return json.data
}

async function ensureRelease(baseUrl, token, args) {
  const list = await apiJson(`${baseUrl}/admin/api/workopc/releases?channel=${encodeURIComponent(args.channel)}`, token)
  const existing = list.find(r => r.version === args.version && r.channel === args.channel)
  if (existing) {
    console.log(`Reusing existing release ${existing.id} (${existing.version} ${existing.channel})`)
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

async function uploadArtifact(baseUrl, token, releaseId, target, filePath, signed, notarized) {
  const name = basename(filePath)
  const size = statSync(filePath).size
  const params = new URLSearchParams({
    target,
    filename: name,
    signed: String(signed),
    notarized: String(notarized),
  })
  const url = `${baseUrl}/admin/api/workopc/releases/${releaseId}/artifacts?${params.toString()}`
  console.log(`Uploading ${name} (${size} bytes) -> ${target}...`)
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = (args.baseUrl || process.env.WORKOPC_PLATFORM_URL || 'https://aiwork.benlai.com').replace(/\/+$/u, '')
  const token = process.env.WORKOPC_ADMIN_KEY || process.env.PLATFORM_ADMIN_KEY
  if (!token) throw new Error('WORKOPC_ADMIN_KEY (or PLATFORM_ADMIN_KEY) is required')
  if (!args.version) throw new Error('--version is required')
  if (!args.target) throw new Error('--target (mac-arm64 | mac-x64 | win-x64) is required')
  if (args.files.length === 0) throw new Error('At least one --file is required')

  const rel = await ensureRelease(baseUrl, token, args)
  for (const filePath of args.files) {
    await uploadArtifact(baseUrl, token, rel.id, args.target, filePath, args.signed, args.notarized)
  }
  if (args.publish) {
    await apiJson(`${baseUrl}/admin/api/workopc/releases/${rel.id}/publish`, token, { method: 'POST' })
    console.log(`Published release ${rel.version} (${rel.channel})`)
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
