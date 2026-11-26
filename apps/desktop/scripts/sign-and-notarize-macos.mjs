import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = resolve(SCRIPT_DIR, '..')

const MACHO_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca])

function isMachO(filePath) {
  let fd
  try {
    fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(4)
    if (readSync(fd, buf, 0, 4, 0) < 4) return false
    return MACHO_MAGICS.has(buf.readUInt32BE(0))
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

function collectSignTargets(appPath) {
  const binaries = []
  const bundles = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(full)
        if (entry.name.endsWith('.framework') || entry.name.endsWith('.app') || entry.name.endsWith('.xpc')) {
          bundles.push(full)
        }
      } else if (entry.isFile() && isMachO(full)) {
        binaries.push(full)
      }
    }
  }
  walk(join(appPath, 'Contents'))
  bundles.sort((a, b) => b.split('/').length - a.split('/').length)
  return { binaries, bundles }
}

function signItem(itemPath, identity, entitlements) {
  const args = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity]
  if (entitlements) args.push('--entitlements', entitlements)
  args.push(itemPath)
  execFileSync('codesign', args, { stdio: 'pipe' })
}

function main() {
  const arch = process.env.WORKOPC_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x64')
  const target = `mac-${arch}`
  const version = process.env.WORKOPC_VERSION || JSON.parse(
    execFileSync('node', ['-e', `console.log(require(${JSON.stringify(join(DESKTOP_ROOT, 'package.json'))}).version)`], { encoding: 'utf8' })
  )
  const identity = process.env.DSH_DESKTOP_MACOS_SIGNING_IDENTITY
  const apiKey = process.env.APPLE_API_KEY
  const apiKeyId = process.env.APPLE_API_KEY_ID
  const apiIssuer = process.env.APPLE_API_ISSUER
  if (!identity || !apiKey || !apiKeyId || !apiIssuer) {
    throw new Error('Required env vars: DSH_DESKTOP_MACOS_SIGNING_IDENTITY, APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER')
  }

  const entitlements = join(DESKTOP_ROOT, 'build', 'macos-entitlements.plist')
  const targetDir = join(DESKTOP_ROOT, '.desktop-build', 'targets', target)
  const appPath = process.env.WORKOPC_APP_PATH || join(targetDir, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'WorkOPC.app')
  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found: ${appPath}`)
  }

  const outDir = join(targetDir, 'signed-artifacts')
  mkdirSync(outDir, { recursive: true })

  const { binaries, bundles } = collectSignTargets(appPath)
  console.log(`Signing ${binaries.length} Mach-O binaries and ${bundles.length} nested bundles...`)
  for (const bin of binaries) signItem(bin, identity, entitlements)
  for (const bundle of bundles) signItem(bundle, identity, entitlements)
  signItem(appPath, identity, entitlements)
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])

  const appNotarizeZip = join(outDir, `WorkOPC-${version}-${target}-notarize.zip`)
  rmSync(appNotarizeZip, { force: true })
  run('ditto', ['-c', '-k', '--keepParent', appPath, appNotarizeZip])
  run('xcrun', ['notarytool', 'submit', appNotarizeZip, '--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer, '--wait'])
  rmSync(appNotarizeZip, { force: true })
  run('xcrun', ['stapler', 'staple', appPath])

  const updateZip = join(outDir, `WorkOPC-${version}-${target}.zip`)
  rmSync(updateZip, { force: true })
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, updateZip])

  const dmgStage = join(outDir, '.dmg-stage')
  rmSync(dmgStage, { recursive: true, force: true })
  mkdirSync(dmgStage, { recursive: true })
  run('ditto', [appPath, join(dmgStage, 'WorkOPC.app')])
  symlinkSync('/Applications', join(dmgStage, 'Applications'))

  const dmgPath = join(outDir, `WorkOPC-${version}-${target}.dmg`)
  rmSync(dmgPath, { force: true })
  run('hdiutil', ['create', '-volname', 'WorkOPC', '-srcfolder', dmgStage, '-ov', '-format', 'UDZO', dmgPath])
  rmSync(dmgStage, { recursive: true, force: true })

  run('codesign', ['--force', '--timestamp', '--sign', identity, dmgPath])
  run('xcrun', ['notarytool', 'submit', dmgPath, '--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer, '--wait'])
  run('xcrun', ['stapler', 'staple', dmgPath])
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', dmgPath])

  console.log(`Signed & notarized artifacts ready in ${outDir}:`)
  console.log(`  DMG: ${dmgPath} (${statSync(dmgPath).size} bytes)`)
  console.log(`  ZIP: ${updateZip} (${statSync(updateZip).size} bytes)`)
}

main()
