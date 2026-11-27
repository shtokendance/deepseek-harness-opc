#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARENT_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
ENV_LOCAL_FILE="$SCRIPT_DIR/.env.local"

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
DO_UPLOAD=""
DO_PUBLISH=0

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
    --upload)
      DO_UPLOAD="yes"
      shift
      ;;
    --no-upload)
      DO_UPLOAD="no"
      shift
      ;;
    --publish)
      DO_UPLOAD="yes"
      DO_PUBLISH=1
      shift
      ;;
    -y|--yes)
      AUTO_YES=1
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [version] [--arch arm64|x64] [--channel stable|nightly] [--no-pull] [--upload|--no-upload] [--publish] [-y|--yes]"
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

PREPARE_ARGS=()
if [[ "$NO_PULL" -eq 1 ]]; then
  PREPARE_ARGS+=(--no-pull --no-push)
else
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree has uncommitted changes. Commit/stash them or pass --no-pull." >&2
    exit 1
  fi
  git checkout release
  git pull --ff-only origin release
fi

SUGGEST_JSON="$(node apps/desktop/scripts/prepare-workopc-release.mjs --suggest ${PREPARE_ARGS[@]+"${PREPARE_ARGS[@]}"})"
CURRENT_VERSION="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.currentPackageVersion)" "$SUGGEST_JSON")"
LATEST_TAG="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.latestTag || '无')" "$SUGGEST_JSON")"
DEFAULT_BUILD_VERSION="$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.defaultBuildVersion)" "$SUGGEST_JSON")"

if [[ -z "$TARGET_VERSION" ]]; then
  if [[ "$AUTO_YES" -eq 1 || ! -t 0 ]]; then
    TARGET_VERSION="$DEFAULT_BUILD_VERSION"
  else
    echo "当前代码版本: ${CURRENT_VERSION} | 最新 Git Tag: ${LATEST_TAG}"
    read -r -p "请输入要打包的版本或 Tag (直接回车默认 ${DEFAULT_BUILD_VERSION}): " INPUT_VERSION
    TARGET_VERSION="${INPUT_VERSION:-$DEFAULT_BUILD_VERSION}"
  fi
fi

TARGET_VERSION="${TARGET_VERSION#v}"
if [[ ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid semver version: $TARGET_VERSION" >&2
  exit 1
fi

OUT_DIR="$REPO_ROOT/apps/desktop/.desktop-build/release-local/$TARGET_VERSION"
mkdir -p "$OUT_DIR"

echo "==> Preparing Git Tag v$TARGET_VERSION & changelog..."
node apps/desktop/scripts/prepare-workopc-release.mjs --version "$TARGET_VERSION" --notes-out "$OUT_DIR/release-notes.md" ${PREPARE_ARGS[@]+"${PREPARE_ARGS[@]}"}

cleanup_checkout() {
  if [[ "$NO_PULL" -eq 0 ]]; then
    git -C "$REPO_ROOT" checkout release >/dev/null 2>&1 || true
  fi
}
trap cleanup_checkout EXIT

if [[ "$NO_PULL" -eq 0 ]]; then
  git checkout "v$TARGET_VERSION"
fi

echo "==> Building WorkOPC $TARGET_VERSION from tag v$TARGET_VERSION (mac-$ARCH, channel=$CHANNEL)"

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
cp -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.dmg" "$OUT_DIR/"
cp -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip" "$OUT_DIR/"
if [[ -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip.blockmap" ]]; then
  cp -f "$SIGNED_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip.blockmap" "$OUT_DIR/"
fi

ARTIFACT_FILES=(
  "$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.dmg"
  "$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip"
)
if [[ -f "$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip.blockmap" ]]; then
  ARTIFACT_FILES+=("$OUT_DIR/WorkOPC-$TARGET_VERSION-mac-$ARCH.zip.blockmap")
fi

echo ""
echo "Done! Artifacts ready in: $OUT_DIR"
ls -lh "$OUT_DIR"

SHOULD_UPLOAD=0
if [[ "$DO_UPLOAD" == "yes" ]]; then
  SHOULD_UPLOAD=1
elif [[ "$DO_UPLOAD" == "no" ]]; then
  SHOULD_UPLOAD=0
elif [[ "$AUTO_YES" -eq 1 ]]; then
  SHOULD_UPLOAD=1
elif [[ -t 0 ]]; then
  read -r -p "是否自动上传制品到 WorkOPC 发布中心并生成中文更新日志（草稿）？[Y/n]: " UPLOAD_ANS
  if [[ -z "$UPLOAD_ANS" || "$UPLOAD_ANS" =~ ^[Yy]$ ]]; then
    SHOULD_UPLOAD=1
  fi
fi

if [[ "$SHOULD_UPLOAD" -eq 1 ]]; then
  if [[ -f "$ENV_LOCAL_FILE" ]]; then
    set -a
    . "$ENV_LOCAL_FILE"
    set +a
  fi

  ADMIN_KEY="${WORKOPC_ADMIN_KEY:-${PLATFORM_ADMIN_KEY:-}}"
  if [[ -z "$ADMIN_KEY" && -t 0 ]]; then
    read -r -s -p "请输入 WorkOPC 发布中心管理员密钥 (WORKOPC_ADMIN_KEY): " INPUT_KEY
    echo ""
    ADMIN_KEY="$INPUT_KEY"
    if [[ -n "$ADMIN_KEY" ]]; then
      read -r -p "是否保存到 $ENV_LOCAL_FILE（仅本机使用，已加入 .gitignore）？[Y/n]: " SAVE_KEY_ANS
      if [[ -z "$SAVE_KEY_ANS" || "$SAVE_KEY_ANS" =~ ^[Yy]$ ]]; then
        printf "WORKOPC_ADMIN_KEY=%q\n" "$ADMIN_KEY" > "$ENV_LOCAL_FILE"
        chmod 600 "$ENV_LOCAL_FILE"
      fi
    fi
  fi

  if [[ -z "$ADMIN_KEY" ]]; then
    echo "未提供 WORKOPC_ADMIN_KEY，已跳过自动上传。" >&2
  else
    export WORKOPC_ADMIN_KEY="$ADMIN_KEY"
    PUBLISH_ARGS=(
      --version "$TARGET_VERSION"
      --channel "$CHANNEL"
      --auto-notes
      --notes-out "$OUT_DIR/release-notes.md"
    )
    if [[ "$DO_PUBLISH" -eq 1 ]]; then
      PUBLISH_ARGS+=(--publish)
    fi
    node apps/desktop/scripts/publish-workopc-release.mjs ${PUBLISH_ARGS[@]+"${PUBLISH_ARGS[@]}"} ${ARTIFACT_FILES[@]+"${ARTIFACT_FILES[@]}"}

    if [[ "$DO_PUBLISH" -eq 0 && -t 0 && "$AUTO_YES" -eq 0 ]]; then
      read -r -p "制品已上传为草稿。是否立即正式发布版本 ${TARGET_VERSION} (${CHANNEL})? [y/N]: " PUB_ANS
      if [[ "$PUB_ANS" =~ ^[Yy]$ ]]; then
        node apps/desktop/scripts/publish-workopc-release.mjs --version "$TARGET_VERSION" --channel "$CHANNEL" --publish-only
      fi
    fi
  fi
else
  echo ""
  echo "如需稍后上传，可执行："
  echo "  WORKOPC_ADMIN_KEY=<PLATFORM_ADMIN_KEY> node apps/desktop/scripts/publish-workopc-release.mjs \\"
  echo "    --version $TARGET_VERSION --channel $CHANNEL --auto-notes \\"
  echo "    \"${ARTIFACT_FILES[*]}\""
fi

if [[ -t 1 ]] && command -v open >/dev/null 2>&1; then
  open "$OUT_DIR"
fi
