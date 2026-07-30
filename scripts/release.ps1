# -----------------------------------------------------------------------------
# Valx Writer Windows release script — the counterpart to scripts/release.sh.
#
#   .\scripts\release.ps1             -> typecheck, build, package the installer
#   .\scripts\release.ps1 -Publish    -> additionally publish to GitHub Releases
#                                        (needs `gh auth login`)
#
# Output lands in out\release\ under BOTH names a release has to carry, because
# the two places that link a download disagree about which one they want:
#
#   Valx.Prose.Writer_<version>_x64-setup.exe   Tauri's own bundle name, and
#       what site/download.html hardcodes per release. Every release since
#       1.0.7 has carried it. (GitHub turns the spaces in the file tauri build
#       actually writes into dots, which is where the dotted form comes from.)
#   valx-prose-writer-setup.exe   the stable name README.md points at through
#       /releases/latest/download/, a URL that never needs editing. This script
#       produced it from the start and nothing ever uploaded it, so both README
#       links 404'd from 1.0.7 until 1.1.0 fixed it.
#
# Uploading both costs a duplicated 6 MB and makes both links work. Collapsing
# to one name is the better end state — point download.html at /latest/ too —
# but that is a change to a published page, not something to do inside a
# release script.
#
# This drives `tauri build`. The previous version of this script called
# electron-forge and electron-builder, which stopped being able to run when the
# app moved from Electron to Tauri — neither package is a dependency any more,
# and there is no forge/builder config left in the repo.
#
# Signing (optional; unsigned installers make SmartScreen warn on first run).
# Tauri reads these itself:
#   TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# For an Authenticode certificate, set bundle.windows.certificateThumbprint in
# tauri.conf.json rather than passing it here.
# -----------------------------------------------------------------------------
param([switch]$Publish)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Step($msg) { Write-Host "== $msg ==" -ForegroundColor Green }

Step 'Preflight'
foreach ($tool in 'node', 'cargo') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool not found. Node 20+ from https://nodejs.org and Rust from https://rustup.rs are both required."
  }
}

Step 'Install dependencies'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

Step 'Typecheck'
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }

Step 'Clean old artifacts'
if (Test-Path out) {
  try { Remove-Item out -Recurse -Force -ErrorAction Stop }
  catch { throw 'Could not clean out\ (is the app running from it?). Close it and retry.' }
}

Step 'Build (NSIS installer)'
npx tauri build
if ($LASTEXITCODE -ne 0) { throw 'tauri build failed' }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$nsisDir = 'src-tauri\target\release\bundle\nsis'
$setup = Get-ChildItem $nsisDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) { throw "No installer produced under $nsisDir" }

New-Item -ItemType Directory -Force out\release | Out-Null
# Dots, not the spaces tauri build writes: GitHub substitutes them on upload,
# so naming the file this way locally is what makes the local artifact and the
# release asset the same string. See the header.
$versioned = "out\release\Valx.Prose.Writer_${version}_x64-setup.exe"
Copy-Item $setup.FullName $versioned
Copy-Item $setup.FullName 'out\release\valx-prose-writer-setup.exe'

Step "Release artifacts ($version)"
Get-ChildItem out\release | ForEach-Object { '{0}  {1:N1} MB' -f $_.Name, ($_.Length / 1MB) }

if ($Publish) {
  Step 'Publishing to GitHub Releases'
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "gh not found — install the GitHub CLI and run 'gh auth login'"
  }
  # Bare version, no leading v: 1.0.7 through 1.0.10 are all tagged that way and
  # site/download.html builds its URLs from it. The v-prefixed form this script
  # used to pass would have created a second, parallel tag series.
  gh release create "$version" `
    $versioned `
    'out\release\valx-prose-writer-setup.exe' `
    --title "Valx Writer v$version" --generate-notes
  if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
}
