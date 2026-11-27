[CmdletBinding()]
param(
    [string]$Version = '',
    [ValidateSet('stable', 'nightly')]
    [string]$Channel = 'stable',
    [switch]$DryRun,
    [switch]$NoCommit,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$RootPkgPath = Join-Path $RepoRoot 'package.json'
$DesktopPkgPath = Join-Path $RepoRoot 'apps\desktop\package.json'
$EnvWindowsPath = Join-Path $RepoRoot 'apps\desktop\.env.windows'

function Get-NextVersion {
    param([Parameter(Mandatory)][string]$Current)
    if ($Current -match '^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z.-]+?)\.(\d+)$') {
        $major = $Matches[1]
        $minor = $Matches[2]
        $patch = $Matches[3]
        $tag = $Matches[4]
        $num = [int]$Matches[5] + 1
        return "$major.$minor.$patch-$tag.$num"
    }
    if ($Current -match '^(\d+)\.(\d+)\.(\d+)$') {
        $major = $Matches[1]
        $minor = $Matches[2]
        $patch = [int]$Matches[3] + 1
        return "$major.$minor.$patch"
    }
    throw "Cannot auto-increment version '$Current'; please specify -Version explicitly."
}

function Assert-ValidSemver {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$') {
        throw "Invalid version format '$Value'. Expected semver like 0.2.4 or 0.2.4-alpha.1."
    }
}

function Update-ManifestVersion {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$NewVersion
    )
    $raw = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false))
    $updated = [regex]::Replace(
        $raw,
        '("version"\s*:\s*")([^"]+)(")',
        { param($m) $m.Groups[1].Value + $NewVersion + $m.Groups[3].Value },
        [System.Text.RegularExpressions.RegexOptions]::None,
        [TimeSpan]::FromSeconds(2)
    )
    if ($updated -eq $raw) {
        return $false
    }
    [IO.File]::WriteAllText($Path, $updated, [Text.UTF8Encoding]::new($false))
    return $true
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

Push-Location $RepoRoot
try {
    # Refresh PATH so newly installed pwsh / fnm are visible in this session.
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

        Invoke-Checked 'Switching to release and pulling latest origin/release' {
            git checkout release
            if ($LASTEXITCODE -eq 0) {
                git pull --ff-only origin release
            }
        }
    }

    $rootPkg = Get-Content $RootPkgPath -Raw | ConvertFrom-Json
    $currentVersion = [string]$rootPkg.version
    $defaultNextVersion = Get-NextVersion -Current $currentVersion

    $targetVersion = $Version.Trim()
    if (-not $targetVersion) {
        Write-Host ""
        Write-Host "Current release version : $currentVersion" -ForegroundColor Yellow
        Write-Host "Default next version (+1): $defaultNextVersion" -ForegroundColor Green
        $inputVersion = Read-Host "Enter version to build (press Enter for $defaultNextVersion, or type custom like 0.2.4)"
        $targetVersion = if ($inputVersion.Trim()) { $inputVersion.Trim() } else { $defaultNextVersion }
    }

    Assert-ValidSemver -Value $targetVersion
    Write-Host "==> Target build version: $targetVersion (channel: $Channel)" -ForegroundColor Green

    if ($DryRun) {
        Write-Host "[DryRun] Skipping file edits, git commit, pnpm install, and packaging." -ForegroundColor Yellow
        return
    }

    if ($targetVersion -ne $currentVersion) {
        $changedRoot = Update-ManifestVersion -Path $RootPkgPath -NewVersion $targetVersion
        $changedDesktop = Update-ManifestVersion -Path $DesktopPkgPath -NewVersion $targetVersion
        if (($changedRoot -or $changedDesktop) -and (-not $NoCommit)) {
            Invoke-Checked "Committing version bump ($targetVersion) on release" {
                git add package.json apps/desktop/package.json
                if ($LASTEXITCODE -eq 0) {
                    git commit -m "chore(desktop): bump version to $targetVersion"
                }
            }
        }
    }

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

    $artifactsDir = Join-Path $RepoRoot 'apps\desktop\.desktop-build\targets\win-x64\artifacts'
    $exePath = Join-Path $artifactsDir "WorkOPC-$targetVersion-win-x64.exe"
    $blockmapPath = Join-Path $artifactsDir "WorkOPC-$targetVersion-win-x64.exe.blockmap"
    $updateYmlPath = Join-Path $artifactsDir 'win-unpacked\resources\app-update.yml'

    if (-not (Test-Path -LiteralPath $exePath)) { throw "Missing EXE artifact: $exePath" }
    if (-not (Test-Path -LiteralPath $blockmapPath)) { throw "Missing blockmap artifact: $blockmapPath" }
    if (-not (Test-Path -LiteralPath $updateYmlPath)) { throw "Missing app-update.yml: $updateYmlPath" }

    Write-Host ""
    Write-Host "================ Build Summary ================" -ForegroundColor Green
    Write-Host "Version   : $targetVersion ($Channel)"
    Write-Host "EXE       : $exePath"
    Write-Host "Blockmap  : $blockmapPath"
    Write-Host "UpdateYml : $updateYmlPath"
    Write-Host "Admin URL : https://aiwork.benlai.com/admin/workopc"
    Write-Host "===============================================" -ForegroundColor Green

    if ($targetVersion -ne $currentVersion -and (-not $NoCommit)) {
        Write-Host "Note: Version bump commit was created on local 'release'. Push with: git push origin release" -ForegroundColor Yellow
    }

    if (-not $NoOpen) {
        Start-Process explorer.exe $artifactsDir
    }
} finally {
    Pop-Location
}
