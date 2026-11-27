# Local Release Build Scripts

Dedicated directory for one-click local release build scripts (Windows `.exe` and macOS `.dmg`).

## 基于 Git Tag 的双端一致性发布流程

Mac 与 Windows 打包脚本现已统一采用 **「先定 Tag 与 Release，再按 Tag 打包」** 的流程，确保双端产物来自完全一致的 Git 提交：

1. **拉取最新 `release` 与远程 Tag**：自动对比当前代码版本与最新 `v*` Tag，推荐待构建版本。
2. **准备 Tag 与 GitHub Release**：
   - 若对应 `v<version>` Tag **尚未创建**：自动更新全仓清单版本号并推送到 `release`、根据上一 Tag 自动汇总**中文更新日志**、创建并推送 `v<version>` Tag；若本机已登录 `gh`，自动创建附带中文更新日志的 GitHub Release。
   - 若对应 `v<version>` Tag **已存在**（例如另一台电脑刚发完 Tag）：直接复用该 Tag 与其更新日志。
3. **按 Tag 检出代码打包**：脚本检出 `v<version>` 精确代码进行构建（完成后自动切回 `release`）。
4. **自动上传发布中心**：询问是否自动上传产物（默认 `Y`）到 `https://aiwork.benlai.com/admin/workopc`（自动携带中文更新日志，默认先存**草稿**），上传后人工确认 `Y` 即可立即发布并输出下载直链。

首次上传需输入发布中心管理员密钥 `WORKOPC_ADMIN_KEY`，可按提示保存到本机 `scripts/release-local/.env.local`（已加入 `.gitignore`，不会入库）。

### 仅提前生成 Tag 与 GitHub Release（不本地打包）

```bash
node apps/desktop/scripts/prepare-workopc-release.mjs --version 0.2.5
```

## Windows x64 (`build-win-exe.bat`)

- **Interactive**:
  Double-click `scripts/release-local/build-win-exe.bat` or run `scripts\release-local\build-win-exe.bat 0.2.5`.

## macOS arm64/x64 (`build-mac-dmg.sh`)

- **Interactive**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh
  ```
- **Custom version / flags via CLI**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh 0.2.5 --arch arm64 --channel stable --upload
  ```
  Supported flags: `--arch arm64|x64`, `--channel stable|nightly`, `--no-pull`, `--upload`, `--no-upload`, `--publish`, `-y|--yes`.
