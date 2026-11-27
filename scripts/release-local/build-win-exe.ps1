[CmdletBinding()]
param(
    [string]$Version = '',
    [ValidateSet('stable', 'nightly')]
    [string]$Channel = 'stable',
    [switch]$DryRun,
    [switch]$NoCommit,
    [switch]$NoOpen,
    [switch]$Upload,
    [switch]$NoUpload,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$EnvWindowsPath = Join-Path $RepoRoot 'apps\desktop\.env.windows'
$EnvLocalPath = Join-Path $PSScriptRoot '.env.local'

function Assert-ValidSemver {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$') {
        throw "Invalid version format '$Value'. Expected semver like 0.2.4 or 0.2.4-alpha.1."
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][scriptblock]$Command
    )
    Write-Host "==> $Label" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Read-LocalAdminKey {
    if ($env:WORKOPC_ADMIN_KEY) { return $env:WORKOPC_ADMIN_KEY }
    if ($env:PLATFORM_ADMIN_KEY) { return $env:PLATFORM_ADMIN_KEY }
    if (Test-Path -LiteralPath $EnvLocalPath) {
        foreach ($line in Get-Content -LiteralPath $EnvLocalPath) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
            $idx = $trimmed.IndexOf('=')
            if ($idx -le 0) { continue }
            $k = $trimmed.Substring(0, $idx).Trim()
            $v = $trimmed.Substring($idx + 1).Trim().Trim("'`"")
            if (($k -eq 'WORKOPC_ADMIN_KEY' -or $k -eq 'PLATFORM_ADMIN_KEY') -and $v) {
                return $v
            }
        }
    }
    return ''
}

Push-Location $RepoRoot
$checkedOutTag = $false
try {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($machinePath -or $userPath) {
        $env:Path = (@($machinePath, $userPath) | Where-Object { $_ }) -join ';'
    }

    if (Get-Command fnm -ErrorAction SilentlyContinue) {
        fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
        $nodeVersions = @(fnm list | ForEach-Object { $_.Trim() -replace '^\*\s*', '' -replace '\s+.*$', '' })
        $preferred = $nodeVersions | Where-Object { $_ -match '^v?(24|26)\.' } | Select-Object -Last 1
        if ($preferred) {
            fnm use $preferred
        }
    }

    if (-not $DryRun) {
        $dirty = git status --porcelain
        if ($dirty) {
            throw "Working tree has uncommitted changes. Please commit or stash them before running release build."
        }

        Invoke-Checked 'Switching to release and pulling latest origin/release + tags' {
            git checkout release
            if ($LASTEXITCODE -eq 0) {
                git pull --ff-only origin release
            }
        }
    }

    $suggestArgs = @('apps/desktop/scripts/prepare-workopc-release.mjs', '--suggest')
    if ($DryRun) { $suggestArgs += '--no-pull' }
    $suggestRaw = node @suggestArgs
    if ($LASTEXITCODE -ne 0) { throw "Failed to query version suggestion." }
    $suggest = $suggestRaw | ConvertFrom-Json

    $currentVersion = [string]$suggest.currentPackageVersion
    $latestTag = if ($suggest.latestTag) { [string]$suggest.latestTag } else { '无' }
    $defaultBuildVersion = [string]$suggest.defaultBuildVersion

    $targetVersion = $Version.Trim().TrimStart('v')
    if (-not $targetVersion) {
        Write-Host ""
        Write-Host "当前代码版本: $currentVersion | 最新 Git Tag: $latestTag" -ForegroundColor Yellow
        $inputVersion = Read-Host "请输入要打包的版本或 Tag（直接回车默认 $defaultBuildVersion）"
        $targetVersion = if ($inputVersion.Trim()) { $inputVersion.Trim().TrimStart('v') } else { $defaultBuildVersion }
    }

    Assert-ValidSemver -Value $targetVersion
    Write-Host "==> Target build version: $targetVersion (channel: $Channel)" -ForegroundColor Green

    if ($DryRun) {
        Write-Host "[DryRun] Skipping tag creation, checkout, pnpm install, and packaging." -ForegroundColor Yellow
        return
    }

    $artifactsDir = Join-Path $RepoRoot 'apps\desktop\.desktop-build\targets\win-x64\artifacts'
    $notesOut = Join-Path $artifactsDir 'release-notes.md'

    $prepareArgs = @('apps/desktop/scripts/prepare-workopc-release.mjs', '--version', $targetVersion, '--notes-out', $notesOut)
    if ($NoCommit) { $prepareArgs += '--no-push' }

    Invoke-Checked "Preparing Git Tag v$targetVersion & Chinese changelog" {
        node @prepareArgs
    }

    Invoke-Checked "Checking out Git Tag v$targetVersion" {
        git checkout "v$targetVersion"
    }
    $checkedOutTag = $true

    if (-not (Test-Path -LiteralPath $EnvWindowsPath)) {
        Write-Host "==> Creating apps/desktop/.env.windows with WorkOPC production defaults" -ForegroundColor Cyan
        $envContent = @(
            'DSH_DESKTOP_APP_ID=com.workopc.desktop'
            'DSH_DESKTOP_AUTO_UPDATE_ENV=production'
            'DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://aiwork.benlai.com'
            'DSH_DESKTOP_WINDOWS_COMPRESSION_LEVEL=3'
        ) -join "`n"
        [IO.File]::WriteAllText($EnvWindowsPath, "$envContent`n", [Text.UTF8Encoding]::new($false))
    }

    $env:DSH_DESKTOP_UPDATE_CHANNEL = $Channel

    Invoke-Checked 'Installing locked dependencies (pnpm install --frozen-lockfile)' {
        pnpm install --frozen-lockfile
    }

    Invoke-Checked "Running preflight check (--check --build-version $targetVersion)" {
        pnpm run package:desktop:win:x64:no-sign --check --build-version $targetVersion
    }

    Invoke-Checked "Building Windows x64 EXE + blockmap + auto-update ($targetVersion)" {
        pnpm run package:desktop:win:x64:no-sign --build-version $targetVersion
    }

    $exePath = Join-Path $artifactsDir "WorkOPC-$targetVersion-win-x64.exe"
    $blockmapPath = Join-Path $artifactsDir "WorkOPC-$targetVersion-win-x64.exe.blockmap"
    $updateYmlPath = Join-Path $artifactsDir 'win-unpacked\resources\app-update.yml'

    if (-not (Test-Path -LiteralPath $exePath)) { throw "Missing EXE artifact: $exePath" }
    if (-not (Test-Path -LiteralPath $blockmapPath)) { throw "Missing blockmap artifact: $blockmapPath" }
    if (-not (Test-Path -LiteralPath $updateYmlPath)) { throw "Missing app-update.yml: $updateYmlPath" }

    Write-Host ""
    Write-Host "================ Build Summary ================" -ForegroundColor Green
    Write-Host "Version   : $targetVersion ($Channel) [tag: v$targetVersion]"
    Write-Host "EXE       : $exePath"
    Write-Host "Blockmap  : $blockmapPath"
    Write-Host "UpdateYml : $updateYmlPath"
    Write-Host "Admin URL : https://aiwork.benlai.com/admin/workopc"
    Write-Host "===============================================" -ForegroundColor Green

    $shouldUpload = $false
    if ($Upload -or $Publish) {
        $shouldUpload = $true
    } elseif (-not $NoUpload) {
        $uploadAns = Read-Host "是否自动上传产物到 WorkOPC 发布中心并生成中文更新日志（草稿）？[Y/n]"
        $shouldUpload = ([string]::IsNullOrWhiteSpace($uploadAns) -or $uploadAns -match '^[Yy]$')
    }

    if ($shouldUpload) {
        $adminKey = Read-LocalAdminKey
        if (-not $adminKey) {
            $secKey = Read-Host "请输入 WorkOPC 发布中心管理员密钥 (WORKOPC_ADMIN_KEY)" -AsSecureString
            if ($secKey -and $secKey.Length -gt 0) {
                $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secKey)
                try { $adminKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
                if ($adminKey) {
                    $saveAns = Read-Host "是否保存到 $EnvLocalPath（仅本机使用，已加入 .gitignore）？[Y/n]"
                    if ([string]::IsNullOrWhiteSpace($saveAns) -or $saveAns -match '^[Yy]$') {
                        [IO.File]::WriteAllText($EnvLocalPath, "WORKOPC_ADMIN_KEY=$adminKey`n", [Text.UTF8Encoding]::new($false))
                    }
                }
            }
        }

        if (-not $adminKey) {
            Write-Host "未提供 WORKOPC_ADMIN_KEY，已跳过自动上传。" -ForegroundColor Yellow
        } else {
            $env:WORKOPC_ADMIN_KEY = $adminKey
            $pubArgs = @(
                'apps/desktop/scripts/publish-workopc-release.mjs',
                '--version', $targetVersion,
                '--channel', $Channel,
                '--auto-notes',
                '--notes-out', $notesOut
            )
            if ($Publish) {
                $pubArgs += '--publish'
            }
            $pubArgs += @($exePath, $blockmapPath)

            Invoke-Checked "Uploading Windows artifacts to WorkOPC Release Center" {
                node @pubArgs
            }

            if (-not $Publish) {
                $pubAns = Read-Host "制品已上传为草稿。是否立即正式发布版本 $targetVersion ($CHANNEL)？[y/N]"
                if ($pubAns -match '^[Yy]$') {
                    Invoke-Checked "Publishing version $targetVersion ($Channel)" {
                        node apps/desktop/scripts/publish-workopc-release.mjs --version $targetVersion --channel $Channel --publish-only
                    }
                }
            }
        }
    }

    if (-not $NoOpen) {
        Start-Process explorer.exe $artifactsDir
    }
} finally {
    if ($checkedOutTag) {
        git checkout release | Out-Null
    }
    Pop-Location
}
