# -----------------------------------------------------------------------------
# Valx Writer release script.
#   .\scripts\release.ps1            -> test, build, package installer + portable zip
#   .\scripts\release.ps1 -Publish   -> additionally publish to GitHub Releases (needs `gh auth login`)
#   .\scripts\release.ps1 -OutDir out2 -> build into a different directory (use when
#                                         out\ is locked by a process running from it)
# Output lands in <OutDir>\release\ with the exact asset names the download page
# links to: valx-prose-writer-setup.exe and valx-prose-writer-portable.zip
# -----------------------------------------------------------------------------
param([switch]$Publish, [string]$OutDir = 'out')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:VALX_OUT_DIR = $OutDir

Write-Host '== Typecheck ==' -ForegroundColor Green
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }

Write-Host '== Build renderer + main ==' -ForegroundColor Green
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

Write-Host '== Clean old artifacts ==' -ForegroundColor Green
if (Test-Path $OutDir) {
  try { Remove-Item $OutDir -Recurse -Force -ErrorAction Stop }
  catch { throw "Could not clean $OutDir (a process is running from it?). Close it or rerun with -OutDir <fresh-dir>." }
}

Write-Host '== Package (app + portable zip) ==' -ForegroundColor Green
npx electron-forge make
if ($LASTEXITCODE -ne 0) { throw 'electron-forge make failed' }

Write-Host '== NSIS installer (wizard with install-location page) ==' -ForegroundColor Green
npx electron-builder --prepackaged "$OutDir/valx-prose-writer-win32-x64" --win "-c.directories.output=$OutDir/installer"
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force $OutDir\release | Out-Null
Copy-Item "$OutDir\installer\valx-prose-writer-setup.exe" "$OutDir\release\valx-prose-writer-setup.exe"
Copy-Item "$OutDir\make\zip\win32\x64\valx-prose-writer-win32-x64-$version.zip" "$OutDir\release\valx-prose-writer-portable.zip"

Write-Host "== Release artifacts (v$version) ==" -ForegroundColor Green
Get-ChildItem $OutDir\release | ForEach-Object { '{0}  {1:N1} MB' -f $_.Name, ($_.Length / 1MB) }

if ($Publish) {
  Write-Host '== Publishing to GitHub Releases ==' -ForegroundColor Green
  gh release create "v$version" `
    "$OutDir\release\valx-prose-writer-setup.exe" `
    "$OutDir\release\valx-prose-writer-portable.zip" `
    --title "Valx Writer v$version" --generate-notes
  if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
}
