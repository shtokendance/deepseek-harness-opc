#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARENT_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

TARGET_VERSION=""
ARCH="${WORKOPC_ARCH:-$(uname -m)}"
if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
  ARCH="arm64"
else
  ARCH="x64"
fi
CHANNEL="${DSH_DESKTOP_UPDATE_CHANNEL:-stable}"
NO_PULL=0
AUTO_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --no-pull)
      NO_PULL=1
      shift
      ;;
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [version] [--arch arm64|x64] [--channel stable|nightly] [--no-pull] [-y|--yes]"
      exit 0
      ;;
    *)
      if [[ -z "$TARGET_VERSION" ]]; then
        TARGET_VERSION="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

cd "$REPO_ROOT"

if [[ "$NO_PULL" -eq 0 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree has uncommitted changes. Commit/stash them or pass --no-pull." >&2
    exit 1
  fi
  git checkout release
  git pull --ff-only origin release
fi

CURRENT_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"
DEFAULT_NEXT_VERSION="$(node -e "
const v = process.argv[1];
const pre = v.match(/^(\d+\.\d+\.\d+-[A-Za-z0-9.-]*?)(\d+)$/);
if (pre) { console.log(pre[1] + (Number(pre[2]) + 1)); process.exit(0); }
const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (m) { console.log(m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1)); process.exit(0); }
console.log(v);
" "$CURRENT_VERSION")"

if [[ -z "$TARGET_VERSION" ]]; then
  if [[ "$AUTO_YES" -eq 1 || ! -t 0 ]]; then
    TARGET_VERSION="$DEFAULT_NEXT_VERSION"
  else
    read -r -p "Current version is $CURRENT_VERSION. Enter release version [$DEFAULT_NEXT_VERSION]: " INPUT_VERSION
    TARGET_VERSION="${INPUT_VERSION:-$DEFAULT_NEXT_VERSION}"
  fi
fi

if [[ ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid semver version: $TARGET_VERSION" >&2
  exit 1
fi

echo "==> Building WorkOPC $TARGET_VERSION (mac-$ARCH, channel=$CHANNEL)"

if [[ "$TARGET_VERSION" != "$CURRENT_VERSION" ]]; then
  node -e "
const fs = require('fs');
const { globSync } = require('fs');
const from = process.argv[1];
const to = process.argv[2];
const files = ['package.json', ...globSync('apps/*/package.json'), ...globSync('packages/*/*/package.json')];
let count = 0;
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const json = JSON.parse(txt);
  if (json.version === from) {
    fs.writeFileSync(f, txt.replace('\"version\": \"' + from + '\"', '\"version\": \"' + to + '\"'));
    count++;
  }
}
console.log('Updated', count, 'manifests to', to);
" "$CURRENT_VERSION" "$TARGET_VERSION"
fi

if [[ ! -f "native/system/darwin-$ARCH/bin/system.node" ]]; then
  pnpm run build:native-system
fi

DSH_DESKTOP_APP_ID="${DSH_DESKTOP_APP_ID:-com.workopc.desktop}" \
  pnpm --filter @deepseek-ai/dsh-desktop run "package:mac:${ARCH}:dir" -- --unsigned

APP_SUBDIR="mac-arm64"
if [[ "$ARCH" == "x64" ]]; then
  APP_SUBDIR="mac"
fi
APP_PATH="$REPO_ROOT/apps/desktop/.desktop-build/targets/mac-$ARCH/unsigned-artifacts/$APP_SUBDIR/WorkOPC.app"

export WORKOPC_VERSION="$TARGET_VERSION"
export WORKOPC_ARCH="$ARCH"
export WORKOPC_APP_PATH="$APP_PATH"
export DSH_DESKTOP_UPDATE_CHANNEL="$CHANNEL"
export DSH_DESKTOP_MACOS_SIGNING_IDENTITY="${DSH_DESKTOP_MACOS_SIGNING_IDENTITY:-Developer ID Application: Shanghai Ciyuan Jumping Information Technology Co., Ltd (Q35YK5Q9F3)}"
export APPLE_API_KEY="${APPLE_API_KEY:-$PARENT_ROOT/apple-signing/AuthKey_2D37J4DSW7.p8}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-2D37J4DSW7}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-222345b1-fc61-4bb4-bc1b-e538f0d8044c}"

node apps/desktop/scripts/sign-and-notarize-macos.mjs

SIGNED_DIR="$REPO_ROOT/apps/desktop/.desktop-build/targets/mac-$ARCH/signed-artifacts"
OUT_DIR="$REPO_ROOT/apps/desktop/.desktop-build/release-local/$TARGET_VERSION"
mkdir -p "$OUT_DIR"
cp -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.dmg" "$OUT_DIR/"
cp -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip" "$OUT_DIR/"

echo ""
echo "Done! Artifacts ready in: $OUT_DIR"
ls -lh "$OUT_DIR"
echo ""
echo "Optional upload command:"
echo "  WORKOPC_ADMIN_KEY=<PLATFORM_ADMIN_KEY> node apps/desktop/scripts/publish-workopc-release.mjs \\"
echo "    --version $TARGET_VERSION --channel $CHANNEL --target mac-$ARCH --signed true --notarized true --publish \\"
echo "    \"$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.dmg\" \\"
echo "    \"$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip\""

if [[ -t 1 ]] && command -v open >/dev/null 2>&1; then
  open "$OUT_DIR"
fi
