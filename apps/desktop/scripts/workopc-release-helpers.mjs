import { existsSync, readFileSync } from 'node:fs'

export function inferArtifactKind(filename) {
  const lower = String(filename || '').trim().toLowerCase()
  if (lower.endsWith('.zip.blockmap')) return 'zip_blockmap'
  if (lower.endsWith('.exe.blockmap')) return 'exe_blockmap'
  if (lower.endsWith('.dmg')) return 'dmg'
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.exe')) return 'exe'
  return ''
}

export function inferArtifactTarget(filename) {
  const lower = String(filename || '').trim().toLowerCase()
  if (
    lower.endsWith('.exe.blockmap') ||
    lower.endsWith('.exe') ||
    lower.includes('win-x64') ||
    lower.includes('win32') ||
    lower.includes('windows') ||
    lower.includes('-win-') ||
    lower.includes('_win_')
  ) {
    return 'win-x64'
  }
  if (
    lower.includes('arm64') ||
    lower.includes('aarch64') ||
    lower.includes('apple-silicon')
  ) {
    return 'mac-arm64'
  }
  if (
    lower.includes('x64') ||
    lower.includes('amd64') ||
    lower.includes('intel') ||
    lower.includes('x86_64')
  ) {
    return 'mac-x64'
  }
  return ''
}

export function loadEnvFileIfExists(filePath, targetEnv = process.env) {
  if (!filePath || !existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    let val = line.slice(eqIdx + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1)
    }
    if (key && !targetEnv[key]) {
      targetEnv[key] = val
    }
  }
}

const COMMIT_PREFIX_RE = /^(feat|fix|chore|refactor|perf|docs|style|test|build|ci)(?:\(([^)]*)\))?!?:\s*(.+)$/i

const PHRASE_TRANSLATIONS = [
  { test: /(registry update check|update check.*plugin|plugin.*update check|bundled plugin)/i, zh: '内置插件检查更新能力' },
  { test: /(dshmarket.*(profile|seed|default|bundle)|seed dshmarket|bundle dshmarket)/i, zh: '默认内置并启用 dshmarket 插件' },
  { test: /dshmarket/i, zh: 'dshmarket 插件集成' },
  { test: /changelog.*cors|cors.*changelog/i, zh: '更新日志接口跨域支持' },
  { test: /changelog/i, zh: '更新日志展示与拉取' },
  { test: /(left sidebar|sidebar)/i, zh: '左侧边栏入口' },
  { test: /(styled dmg|dmg.*layout|dmg.*window)/i, zh: 'DMG 安装窗口视觉指引布局' },
  { test: /(one-click.*(dmg|mac|windows|release)|release script|build script|publish.*script|upload)/i, zh: '一键打包与自动上传发布脚本' },
  { test: /(dmg|macos|darwin)/i, zh: 'macOS 安装包打包与签名流程' },
  { test: /(auto-update|auto update|updater|app-update\.yml)/i, zh: '客户端自动更新支持' },
  { test: /(installer.*(branding|asset)|branding)/i, zh: '安装器品牌图标与界面资源' },
  { test: /(windows|win-x64|\.exe\b)/i, zh: 'Windows 客户端打包与更新支持' },
  { test: /(sign|notariz)/i, zh: '应用签名与公证处理' },
  { test: /plugin/i, zh: '插件管理与运行体验' },
  { test: /(tray|menu)/i, zh: '系统托盘与菜单体验' },
  { test: /(auth|login|token)/i, zh: '登录认证与会话校验' },
  { test: /mcp/i, zh: 'MCP 服务集成与调用' },
  { test: /(setting|config)/i, zh: '应用设置界面与配置项' },
]

function actionLabelForType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'feat':
      return '新增'
    case 'fix':
      return '修复'
    case 'perf':
    case 'refactor':
    case 'style':
      return '优化'
    case 'docs':
      return '文档'
    default:
      return '调整'
  }
}

function fallbackChineseSummary(type, scope) {
  const scopeLower = String(scope || '').toLowerCase()
  const typeLower = String(type || '').toLowerCase()
  const area = scopeLower.includes('workopc')
    ? 'WorkOPC '
    : scopeLower.includes('desktop')
      ? '桌面端'
      : scopeLower.includes('plugin')
        ? '插件系统'
        : scopeLower.includes('release')
          ? '发布流程'
          : ''
  if (typeLower === 'fix') return `${area}问题修复与稳定性改进`
  if (typeLower === 'feat') return `${area}新功能与使用体验优化`
  if (typeLower === 'perf' || typeLower === 'refactor') return `${area}性能与代码结构优化`
  return `${area}功能细节与常规调整`
}

function translateSubjectToChinese(rawSubject) {
  const subject = String(rawSubject || '').trim()
  if (!subject) return ''
  const match = subject.match(COMMIT_PREFIX_RE)
  const type = match ? match[1] : ''
  const scope = match ? match[2] : ''
  const body = match ? match[3].trim() : subject
  const label = actionLabelForType(type)

  const hasChinese = /[\u4e00-\u9fff]/.test(body)
  const hasEnglishSentence = /[A-Za-z]{4,}\s+[a-z]{3,}/.test(body)
  if (hasChinese && !hasEnglishSentence) {
    const cleaned = body.replace(/[.,;]+$/u, '').trim()
    return `- ${label}：${cleaned}`
  }

  const parts = []
  for (const rule of PHRASE_TRANSLATIONS) {
    if (rule.test.test(subject)) {
      if (!parts.includes(rule.zh)) {
        parts.push(rule.zh)
      }
      if (parts.length >= 3) break
    }
  }

  if (parts.length > 0) {
    return `- ${label}：${parts.join('、')}`
  }
  return `- ${label}：${fallbackChineseSummary(type, scope)}`
}

export function formatChineseChangelogFromCommits(subjects) {
  const seen = new Set()
  const bullets = []
  for (const raw of subjects || []) {
    const line = String(raw || '').trim()
    if (!line) continue
    if (/^Merge\b/i.test(line)) continue
    if (/\bbump\b.*\bversion\b/i.test(line) || /\bversion\s+to\s+\d+\.\d+\.\d+/i.test(line)) continue
    if (/^chore(?:\([^)]*\))?:\s*(?:release|bump)\b/i.test(line)) continue

    const bullet = translateSubjectToChinese(line)
    if (!bullet || seen.has(bullet)) continue
    seen.add(bullet)
    bullets.push(bullet)
    if (bullets.length >= 12) break
  }

  if (bullets.length === 0) {
    return '- 优化：常规功能改进与问题修复'
  }
  return bullets.join('\n')
}
