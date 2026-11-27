# Local Release Build Scripts

Dedicated directory for one-click local release build scripts (Windows `.exe` now, macOS `.dmg` scripts in the future).

## Windows x64 (`build-win-exe.bat`)

- **Interactive (auto-increment version +1)**:
  Double-click `scripts/release-local/build-win-exe.bat` or run it from a terminal.
  It switches to `release`, pulls `origin/release`, proposes `<current-version + 1>` (press `Enter` to accept, or type a custom semver like `0.2.4`), builds `WorkOPC-<version>-win-x64.exe` + `.exe.blockmap` + `resources/app-update.yml` (skipping EV token signing while keeping auto-update enabled), and opens the output folder.
- **Custom version via CLI**:
  ```bat
  scripts\release-local\build-win-exe.bat 0.2.4
  ```

## macOS arm64/x64 (`build-mac-dmg.sh`)

- **Interactive (auto-increment version +1)**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh
  ```
  It switches to `release`, pulls `origin/release`, proposes `<current-version + 1>` (press `Enter` to accept, or type a custom semver), bumps manifests, builds, embeds `app-update.yml`, signs & notarizes & staples `WorkOPC.app`, generates the styled `WorkOPC-<version>-mac-<arch>.dmg` and auto-update `WorkOPC-<version>-mac-<arch>.zip`, and opens the output folder.
- **Custom version / arch / channel via CLI**:
  ```bash
  ./scripts/release-local/build-mac-dmg.sh 0.3.0 --arch arm64 --channel stable
  ```
