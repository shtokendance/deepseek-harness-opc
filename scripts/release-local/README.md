# Local Release Build Scripts

Dedicated directory for one-click local release build scripts (Windows `.exe` and macOS `.dmg`).

## 自动上传与中文更新日志

打包完成后，两个脚本均会自动：
1. 询问是否自动上传到 WorkOPC 发布中心（默认 `Y`），如未存在对应版本则自动新建草稿，如已存在（例如已由另一端创建）则自动复用并追加对应平台制品；
2. 根据发布中心上一版的 `commit_sha` 到当前 `HEAD` 的 Git 提交自动汇总**中文更新日志**（无需手填）；
3. 默认先保存为**草稿**，上传完成后再由人工确认是否立即正式发布（`y/N`）；
4. 输出后台管理地址、固定直链及指定版本下载直链。

首次上传需输入发布中心管理员密钥 `WORKOPC_ADMIN_KEY`，可按提示保存到本机 `scripts/release-local/.env.local`（已加入 `.gitignore`，不会入库）。

## Windows x64 (`build-win-exe.bat`)

- **Interactive (auto-increment version +1)**:
  Double-click `scripts/release-local/build-win-exe.bat` or run it from a terminal.
  It switches to `release`, pulls `origin/release`, proposes `<current-version + 1>`, builds `WorkOPC-<version>-win-x64.exe` + `.exe.blockmap` + `resources/app-update.yml`, and prompts to upload & publish.
- **Custom version via CLI**:
  ```bat
  scripts\release-local\build-win-exe.bat 0.2.5
  ```

## macOS arm64/x64 (`build-mac-dmg.sh`)

- **Interactive (auto-increment version +1)**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh
  ```
  Switches to `release`, pulls `origin/release`, proposes `<current-version + 1>`, bumps manifests, builds, signs & notarizes `WorkOPC.app`, generates `WorkOPC-<version>-mac-<arch>.dmg` + `.zip` (+ `.zip.blockmap`), and prompts to upload & publish.
- **Custom version / flags via CLI**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh 0.3.0 --arch arm64 --channel stable --upload
  ```
  Supported flags: `--arch arm64|x64`, `--channel stable|nightly`, `--no-pull`, `--upload`, `--no-upload`, `--publish`, `-y|--yes`.
