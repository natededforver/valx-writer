#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Valx Writer macOS release script — the counterpart to scripts/release.ps1.
#
#   ./scripts/release.sh                 -> typecheck, build, package .app + .dmg
#   ./scripts/release.sh --publish       -> additionally publish to GitHub Releases
#   ./scripts/release.sh --target aarch64-apple-darwin   -> single-arch build
#
# Defaults to a universal (Intel + Apple Silicon) binary, which is what a
# downloadable DMG should be — a user landing on the download page has no way to
# know which slice they need.
#
# Output lands in out/release/ with stable asset names:
#   valx-prose-writer.dmg
#
# Signing & notarization (optional; unsigned builds work but Gatekeeper will
# make the user right-click > Open on first launch). Set before running:
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Name (TEAMID)"
#   APPLE_CERTIFICATE        base64 .p12, with APPLE_CERTIFICATE_PASSWORD  (CI)
#   APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID    app-specific password, or
#   APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH    App Store Connect key
# Tauri reads these itself; the script only reports which mode it is in.
# -----------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PUBLISH=0
TARGET="universal-apple-darwin"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=1; shift ;;
    --target)  TARGET="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

green() { printf '\033[32m== %s ==\033[0m\n' "$1"; }

[[ "$(uname -s)" == "Darwin" ]] || { echo "release.sh only builds the macOS bundles; use scripts/release.ps1 on Windows." >&2; exit 1; }

green "Preflight"
command -v node >/dev/null  || { echo "node not found — install Node 20+ (https://nodejs.org)" >&2; exit 1; }
command -v cargo >/dev/null || { echo "cargo not found — install Rust (https://rustup.rs)" >&2; exit 1; }
# Command Line Tools are enough: cargo needs clang and a macOS SDK, and Tauri
# assembles the .app and .dmg itself (hdiutil/osascript/codesign, all in the
# base system). Full Xcode is only required for the iOS targets, which this app
# does not build. Deliberately NOT a check for xcodebuild — requiring that
# would turn a working machine away.
xcrun --show-sdk-path >/dev/null 2>&1 || {
  echo "No macOS SDK found. Install the Command Line Tools: xcode-select --install" >&2
  exit 1
}
# A universal build needs both slices' std libraries present.
if [[ "$TARGET" == "universal-apple-darwin" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
fi
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "signing as: $APPLE_SIGNING_IDENTITY"
else
  echo "no APPLE_SIGNING_IDENTITY — producing an UNSIGNED build (Gatekeeper will warn on first open)"
fi

green "Install dependencies"
npm ci

green "Typecheck"
npm run lint

green "Clean old artifacts"
rm -rf out
BUNDLE_DIR="src-tauri/target/${TARGET}/release/bundle"
rm -rf "$BUNDLE_DIR"

green "Build (.app + .dmg, ${TARGET})"
npx tauri build --target "$TARGET"

VERSION="$(node -p "require('./package.json').version")"
APP="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -print -quit)"
DMG="$(find "$BUNDLE_DIR/dmg"   -maxdepth 1 -name '*.dmg' -print -quit)"
[[ -n "$APP" ]] || { echo "no .app produced under $BUNDLE_DIR/macos" >&2; exit 1; }
[[ -n "$DMG" ]] || { echo "no .dmg produced under $BUNDLE_DIR/dmg" >&2; exit 1; }

green "Verify bundle"
# Confirms the slices actually made it in — a universal build that silently
# came out single-arch is the failure this catches.
lipo -archs "$APP/Contents/MacOS/"* || true
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --verify --deep --strict --verbose=2 "$APP"
  # Only meaningful once the build has been notarized and stapled.
  spctl --assess --type execute --verbose "$APP" || echo "(not yet notarized/stapled)"
fi

mkdir -p out/release
cp "$DMG" "out/release/valx-prose-writer.dmg"

green "Release artifacts (v$VERSION)"
ls -lh out/release | awk 'NR>1 {printf "%s  %s\n", $9, $5}'

if [[ "$PUBLISH" == "1" ]]; then
  green "Publishing to GitHub Releases"
  command -v gh >/dev/null || { echo "gh not found — install the GitHub CLI and run 'gh auth login'" >&2; exit 1; }
  gh release create "v$VERSION" \
    out/release/valx-prose-writer.dmg \
    --title "Valx Writer v$VERSION" --generate-notes
fi
