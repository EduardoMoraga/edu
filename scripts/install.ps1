# Edu installer for Windows (PowerShell 5.1+).
#   irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Asset = if ($env:EDU_ASSET) { $env:EDU_ASSET } else { 'https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz' }

function Say($text) { Write-Host "  $text" }
Write-Host ''
Write-Host '  EDU - a second brain that learns, a crew you can see' -ForegroundColor Cyan
Write-Host ''

# 1. Node.js >= 22
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int]((& node --version).TrimStart('v').Split('.')[0]) }
if ($major -lt 22) {
  Say 'Node.js 22 or newer is required.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say 'Installing Node.js LTS with winget...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  } else {
    Say 'Install it from https://nodejs.org and run this installer again.'
    exit 1
  }
}

# 2. Remove a broken previous install (failed git installs leave locked folders behind)
$prefix = (& npm prefix -g).Trim()
$stale = Join-Path $prefix 'node_modules\edu-agent'
if ((Test-Path $stale) -and -not (Test-Path (Join-Path $stale 'dist\cli.js'))) {
  Say 'Removing an incomplete previous install...'
  Remove-Item -Recurse -Force $stale -ErrorAction SilentlyContinue
}

# 3. Install the prebuilt package (no build tools needed)
Say 'Installing Edu...'
& npm install -g $Asset --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Say 'npm could not install Edu. See the error above.'; exit 1 }

$edu = Get-Command edu -ErrorAction SilentlyContinue
if (-not $edu) {
  $env:Path = "$prefix;$env:Path"
  $edu = Get-Command edu -ErrorAction SilentlyContinue
}
if (-not $edu) { Say "Installed, but 'edu' is not on PATH. Add $prefix to PATH and open a new terminal."; exit 1 }

Say ("Edu " + (& edu --version) + ' installed.')
Write-Host ''

# 4. Connect Edu to every coding CLI found on this machine
& edu setup --yes
Write-Host ''
Say 'Done. Open your favorite CLI (claude, codex, pi, opencode, agy) and ask: "what do you remember?"'
