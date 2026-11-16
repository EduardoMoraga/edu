# Edu installer for Windows (PowerShell 5.1+).
#   irm https://raw.githubusercontent.com/EduardoMoraga/edu/main/scripts/install.ps1 | iex
#
# The release package and its SHA256SUMS are downloaded only from
# https://github.com/EduardoMoraga/edu/releases/download/<tag>/ and the checksum is verified before npm
# installs the local file. EDU_ASSET: a release asset URL under that prefix, or a local .tgz (installed as
# given). EDU_ALLOW_UNVERIFIED=1 also accepts a release older than 6.0, which has no SHA256SUMS.
$ErrorActionPreference = 'Stop'
$Asset = if ($env:EDU_ASSET) { $env:EDU_ASSET } else { '' }

# Same verifier as install.sh: prints the verified local package path, or exits 3 with a message.
# Kept ASCII-only and run from a file, because PowerShell 5.1 mangles quotes in native arguments.
$VerifyJs = @'
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const PREFIX = "https://github.com/EduardoMoraga/edu/releases/download/";
const fail = (message) => { console.error("  " + message); process.exit(3); };
(async () => {
  const asset = process.env.EDU_DL_ASSET || "";
  let tag; let name;
  if (asset) {
    const parts = asset.startsWith(PREFIX) ? asset.slice(PREFIX.length).split("/") : [];
    if (parts.length !== 2) fail(`Refusing ${asset}: Edu installs only release packages from ${PREFIX}<tag>/ (or a local .tgz file).`);
    [tag, name] = parts;
  } else {
    const latest = await fetch("https://github.com/EduardoMoraga/edu/releases/latest", { method: "HEAD", redirect: "follow" });
    const match = /\/releases\/tag\/([^/?#]+)$/.exec(latest.url || "");
    if (!match) fail("Could not find the latest Edu release on GitHub.");
    tag = decodeURIComponent(match[1]); name = "edu-agent.tgz";
  }
  if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag) || !/^edu-agent[\w.-]*\.tgz$/.test(name)) fail(`Refusing ${asset || tag}: not an Edu release package.`);
  const get = async (file) => {
    const response = await fetch(PREFIX + tag + "/" + file, { redirect: "follow" });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${PREFIX}${tag}/${file}`), { status: response.status });
    return Buffer.from(await response.arrayBuffer());
  };
  const data = await get(name);
  const actual = createHash("sha256").update(data).digest("hex");
  let sums;
  try { sums = (await get("SHA256SUMS")).toString("utf8"); } catch (error) { if (error.status !== 404) throw error; }
  if (sums === undefined) {
    if (Number(tag.replace(/^v/, "").split(".")[0]) >= 6) fail(`Release ${tag} publishes no SHA256SUMS, so its package cannot be verified. Nothing was installed.`);
    if (process.env.EDU_ALLOW_UNVERIFIED !== "1") fail(`Release ${tag} predates verified releases (no SHA256SUMS). Run again with --allow-unverified to install it anyway (not recommended).`);
    console.error(`  WARNING: installing ${tag} WITHOUT a checksum check (--allow-unverified).`);
  } else {
    const line = sums.split(/\r?\n/).map((text) => /^([0-9a-fA-F]{64}) [ *](\S.*)$/.exec(text.trimEnd())).find((found) => found && found[2] === name);
    if (!line) fail(`SHA256SUMS of ${tag} lists no ${name}. Nothing was installed.`);
    if (line[1].toLowerCase() !== actual) fail(`Checksum mismatch for ${name}: SHA256SUMS says ${line[1].toLowerCase()}, the download is ${actual}. Nothing was installed.`);
  }
  const file = join(process.env.EDU_DL_DIR, name);
  writeFileSync(file, data);
  process.stdout.write(file);
})().catch((error) => fail(`Could not download Edu: ${error.message}`));
'@

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

# 3. Download and verify the prebuilt package, then install it (no build tools needed)
Msg 'Installing Edu...' 'Instalando Edu...'
$download = $null
if ($Asset -and (Test-Path -LiteralPath $Asset -PathType Leaf)) {
  Msg "Using the local package $Asset (not checksum-verified)." "Usando el paquete local $Asset (sin verificar checksum)."
  $package = $Asset
} else {
  $download = Join-Path ([System.IO.Path]::GetTempPath()) ('edu-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $download | Out-Null
  $verifier = Join-Path $download 'verify.cjs'
  Set-Content -LiteralPath $verifier -Value $VerifyJs -Encoding ASCII
  $env:EDU_DL_DIR = $download
  $env:EDU_DL_ASSET = $Asset
  if (-not $env:EDU_ALLOW_UNVERIFIED) { $env:EDU_ALLOW_UNVERIFIED = '0' }
  $package = (& node $verifier | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $package) {
    Remove-Item -Recurse -Force $download -ErrorAction SilentlyContinue
    Msg 'Edu was not installed: the release package could not be downloaded and verified (see above).' 'Edu no se instalo: no se pudo descargar y verificar el paquete de la version (ver arriba).'
    exit 1
  }
}
& npm install -g $package --no-fund --no-audit
$npmExit = $LASTEXITCODE
if ($download) { Remove-Item -Recurse -Force $download -ErrorAction SilentlyContinue }
if ($npmExit -ne 0) { Say 'npm could not install Edu. See the error above.'; exit 1 }

$edu = Get-Command edu -ErrorAction SilentlyContinue
if (-not $edu) {
  $env:Path = "$prefix;$env:Path"
  $edu = Get-Command edu -ErrorAction SilentlyContinue
}
if (-not $edu) { Say "Installed, but 'edu' is not on PATH. Add $prefix to PATH and open a new terminal."; exit 1 }

Msg ("Edu " + (& edu --version) + ' installed.') ("Edu " + (& edu --version) + ' instalado.')
Write-Host ''

# 4. Connect Edu to every coding CLI found on this machine (or only EDU_HOSTS, e.g. claude,codex)
$failed = $false
if ($env:EDU_HOSTS) { & edu setup --yes --cli $env:EDU_HOSTS } else { & edu setup --yes }
if ($LASTEXITCODE -ne 0) { $failed = $true; Msg 'Setup did not finish; run: edu setup --yes' 'El setup no termino; ejecuta: edu setup --yes' }
Write-Host ''

# 5. Optional shared brain (cloud sandboxes): EDU_JOIN=<repo url>. Credentials come from GH_TOKEN or a
#    credential helper and are never printed.
if ($env:EDU_JOIN) {
  $shown = $env:EDU_JOIN -replace '//[^/@]*@', '//***@'
  Msg "Joining the shared brain $shown..." "Uniendo el cerebro compartido $shown..."
  & edu join $env:EDU_JOIN --cloud
  if ($LASTEXITCODE -ne 0) { $failed = $true; Msg 'Join did not finish; check GH_TOKEN and run: edu join <url> --cloud' 'La union no termino; revisa GH_TOKEN y ejecuta: edu join <url> --cloud' }
  Write-Host ''
}
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
# Non-interactive callers (EDU_YES=1, cloud sandboxes, CI) need a failing status, not just a message.
if ($failed -and $env:EDU_YES -eq '1') { exit 1 }
