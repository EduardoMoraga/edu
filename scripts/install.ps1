# Edu installer for Windows (PowerShell 5.1+).
#   irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Asset = if ($env:EDU_ASSET) { $env:EDU_ASSET } else { 'https://github.com/EduardoMoraga/edu/releases/latest/download/edu-agent.tgz' }

function Say($text) { Write-Host "  $text" }
# Spanish or English: EDU_LANG, else the Windows UI culture. Kept ASCII-only: PowerShell 5.1
# reads a BOM-less script as ANSI, which would garble accents.
$Lang = if ($env:EDU_LANG) { $env:EDU_LANG } else { (Get-UICulture).TwoLetterISOLanguageName }
$UseSpanish = $Lang -like 'es*'
function Msg($english, $spanish) { if ($UseSpanish) { Say $spanish } else { Say $english } }
Write-Host ''
Write-Host '  EDU - a second brain that learns, a crew you can see' -ForegroundColor Cyan
Write-Host ''

# 1. Node.js >= 22
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) { $major = [int]((& node --version).TrimStart('v').Split('.')[0]) }
if ($major -lt 22) {
  Msg 'Node.js 22 or newer is required.' 'Se necesita Node.js 22 o superior.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Msg 'Installing Node.js LTS with winget (winget install OpenJS.NodeJS.LTS)...' 'Instalando Node.js LTS con winget (winget install OpenJS.NodeJS.LTS)...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $major = 0
    if (Get-Command node -ErrorAction SilentlyContinue) { $major = [int]((& node --version).TrimStart('v').Split('.')[0]) }
    if ($major -lt 22) {
      Msg 'Node.js was installed but is not on PATH yet. Open a new terminal and run this installer again.' 'Node.js quedo instalado pero aun no esta en el PATH. Abre una terminal nueva y vuelve a ejecutar este instalador.'
      exit 1
    }
  } else {
    Msg 'Install it one of these ways, then run this installer again:' 'Instalalo de una de estas formas y vuelve a ejecutar este instalador:'
    Say '  - https://nodejs.org/en/download   (official installer / instalador oficial)'
    Say '  - fnm: https://github.com/Schniz/fnm#installation  ->  fnm install 22'
    exit 1
  }
}

# 2. Remove a broken previous install (failed git installs leave locked folders behind)
$prefix = (& npm prefix -g).Trim()
$stale = Join-Path $prefix 'node_modules\edu-agent'
if ((Test-Path $stale) -and -not (Test-Path (Join-Path $stale 'dist\cli.js'))) {
  Msg 'Removing an incomplete previous install...' 'Quitando una instalacion previa incompleta...'
  Remove-Item -Recurse -Force $stale -ErrorAction SilentlyContinue
}

# 3. Install the prebuilt package (no build tools needed)
Msg 'Installing Edu...' 'Instalando Edu...'
& npm install -g $Asset --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Say 'npm could not install Edu. See the error above.'; exit 1 }

$edu = Get-Command edu -ErrorAction SilentlyContinue
if (-not $edu) {
  $env:Path = "$prefix;$env:Path"
  $edu = Get-Command edu -ErrorAction SilentlyContinue
}
if (-not $edu) { Say "Installed, but 'edu' is not on PATH. Add $prefix to PATH and open a new terminal."; exit 1 }

Msg ("Edu " + (& edu --version) + ' installed.') ("Edu " + (& edu --version) + ' instalado.')
Write-Host ''

# 4. Connect Edu to every coding CLI found on this machine
& edu setup --yes
if ($LASTEXITCODE -ne 0) { Msg 'Setup did not finish; run: edu setup --yes' 'El setup no termino; ejecuta: edu setup --yes' }
Write-Host ''
if ($UseSpanish) {
  Say 'Listo. Siguientes pasos:'
  Say '  1. Crea tu primer espacio desde un documento:'
  Say '       edu create <documento> --name <NombreDelAgente>'
  Say '  2. Abrelo en Obsidian: Open folder as vault -> la carpeta creada'
  Say '  3. Entra con tu CLI (claude, codex, pi, opencode) y pregunta: "quien eres?"'
  Say '  4. Mantente al dia: edu update'
} else {
  Say 'Done. Next steps:'
  Say '  1. Create your first workspace from a document:'
  Say '       edu create <document> --name <AgentName>'
  Say '  2. Open it in Obsidian: Open folder as vault -> the new folder'
  Say '  3. Open it with your CLI (claude, codex, pi, opencode) and ask: "who are you?"'
  Say '  4. Stay current: edu update'
}
