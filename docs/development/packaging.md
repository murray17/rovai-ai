---
document_type: development-guide
authority: macos-build-and-packaging
last_updated: 2026-08-25
---

# macOS 构建、签名与打包

当前本地桌面交付目标是 macOS 14+ Apple Silicon。`package:mac` 和 `dist:mac` 固定生成
arm64 产物；正式签名 workflow 另外生成 x64 产物并组合两种架构的更新清单。

## 构建

构建 Release Core、bundled Agent CLI 和 Electron：

```bash
pnpm build
```

只构建一部分：

```bash
pnpm core:build
pnpm build:desktop
```

生成可直接运行、仅供本地工程验收的 unsigned/ad-hoc `.app`：

```bash
pnpm package:mac:unsigned
```

该命令直接构建 arm64 Release Core、bundled Agent CLI 和 Renderer，然后调用 `electron-builder`
生成目录型 App。`package:mac` 使用同一条直接打包路径；两者都不依赖额外的准备、来源检查或
打包后检查步骤。

### Electron 下载与受限网络

`package:mac:unsigned` 由 `electron-builder` 解析准确 Electron 归档，过程中仍可能访问
`https://github.com/electron/electron/releases/` 获取 Electron arm64 归档或校验信息。macOS 的默认归档
缓存位于 `~/Library/Caches/electron/`，但“ZIP 已缓存”不保证 `electron-builder` 不再联网读取校验信息。

已知当前执行环境不能访问 GitHub，且尚未确认本地归档可用时，不要先在该受限环境运行一遍完整打包再
等待下载失败；应从第一次尝试就使用可访问 GitHub 的执行环境。不得用关闭 TLS、关闭 checksum 或提交
个人镜像地址的方式绕过。

GitHub 暂时不可用、但依赖安装曾成功完成时，可以先从 Electron 包自带的 checksum 验证本地归档，再用
`electronDist` 直接打包。以下命令不硬编码 Electron 版本：

```bash
ELECTRON_ARCHIVE_NAME="$(node -p "'electron-v' + require('./node_modules/electron/package.json').version + '-darwin-arm64.zip'")"
ELECTRON_ARCHIVE="$(find "$HOME/Library/Caches/electron" -type f -name "$ELECTRON_ARCHIVE_NAME" -print | sed -n '1p')"
test -n "$ELECTRON_ARCHIVE" || { echo "Electron archive cache miss" >&2; false; }

EXPECTED_ELECTRON_SHA="$(node -p "require('./node_modules/electron/checksums.json')[process.argv[1]]" "$ELECTRON_ARCHIVE_NAME")"
ACTUAL_ELECTRON_SHA="$(shasum -a 256 "$ELECTRON_ARCHIVE" | awk '{print $1}')"
test "$ACTUAL_ELECTRON_SHA" = "$EXPECTED_ELECTRON_SHA" || { echo "Electron archive checksum mismatch" >&2; false; }

pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder \
  --mac dir --arm64 --config.electronDist="$ELECTRON_ARCHIVE"
```

如果同一轮 `pnpm package:mac:unsigned` 已明确完成前置构建、只在 Electron 下载阶段失败，恢复时跳过上面
的 `pnpm build`，直接执行最后一条 `electron-builder` 命令，避免重复 Release 编译。生成 DMG 时把
`--mac dir` 改为 `--mac dmg`。缓存缺失或 checksum 不匹配时必须恢复可信网络后使用标准命令，不得把
未验证归档传给 `electronDist`。

产物：

```text
dist/mac-arm64/Rovai AI.app
```

外层产品名、App bundle、主可执行文件与 Helper 名统一为 `Rovai AI` / `Rovai AI.app`。Bundle ID
继续使用 `ai.rovai.desktop`，旧的 `Rovai-ai` userData 由启动兼容层继续采用，不因产品名改动而丢失。

生成 DMG：

```bash
pnpm dist:mac
```

该命令同时生成安装用 DMG、自动更新用 ZIP 和 `latest-mac.yml`。DMG/ZIP 使用 URL 安全的
`Rovai-AI-<version>-<arch>` 文件名；文件名由 `package.json#build.mac.artifactName` 决定，DMG
内部仍是 `Rovai AI.app`。

## 一键更新发布集合

应用内“检查更新”只由用户触发。Main 通过打包进 App 的 `app-update.yml` 读取官方
`murray17/rovai-ai` GitHub Release 通道；发现新版本后自动下载 ZIP，Renderer 显示进度，用户点击
“安装并重启”后才进入受控关闭与安装。

macOS 正式 Release 必须在同一个版本标签中上传以下完整集合：

```text
Rovai-AI-<version>-arm64.dmg
Rovai-AI-<version>-arm64.zip
Rovai-AI-<version>-x64.dmg
Rovai-AI-<version>-x64.zip
latest-mac.yml
```

`.github/workflows/macos-signed-build.yml` 分架构构建并验证后，生成一个名为
`rovai-macos-signed` 的组合 artifact。它的 `latest-mac.yml` 由
`scripts/merge-macos-update-info.mjs` 合并，必须同时包含 arm64 与 x64 ZIP；发布者只能上传这份
组合清单，不能任选一个架构构建出的单架构 `latest-mac.yml`。少任一 ZIP 或清单时，另一架构可能
拿到错误更新包，因此发布必须 fail closed。

已发布的 v0.0.1 没有 ZIP/`latest-mac.yml`，旧 App 也没有自动安装能力，所以
`v0.0.1 → v0.0.2` 是一次性手动迁移；从 v0.0.2 安装完成后，后续完整 Release 才能使用应用内升级。

## 本地签名

普通本地 `package:mac` / `package:mac:unsigned` 关闭自动证书发现并显式使用 `identity=-`，因此生成
ad-hoc 签名产物。它们只适合隔离开发验收，不得提升到日常 `/Applications`，也不能作为自动升级签名
连续性的证据。

检查签名：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Rovai AI.app"
codesign --verify --strict \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai-core"
codesign --verify --strict \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai"
```

仓库签名 workflow 使用固定 `Rovai Release Signing` 身份并校验其证书指纹，使相邻版本具备同一
designated-requirement 根。正式公共分发仍需要独立配置 Developer ID、Hardened Runtime entitlement
和 Apple Notarization 凭据，并验证公证结果。不要把证书、密码或 notarization 凭据写入仓库。

本机需要把已验收构建提升为日常安装版时，使用专用固定签名入口：

```bash
pnpm package:mac:daily
pnpm install:mac:daily -- --backup "/Applications/Rovai AI.backup-before-<timestamp>.app"
```

`package:mac:daily` 要求本机 Keychain 中存在同一 `Rovai Release Signing` identity，构建后立即验证 App、
Core、CLI 的架构、Authority、固定 certificate root、Bundle ID，并拒绝 ad-hoc 或 CDHash-only requirement。
`install:mac:daily` 在修改日常路径前验证源 bundle，复制到 `/Applications` 同文件系统暂存路径后再次验证，
原子替换后第三次验证；失败时恢复旧安装并保留验证失败的新候选供诊断。已有备份路径会 fail closed，脚本
不会覆盖备份或修改日常 `userData`。普通 `package:mac` 产物不能通过这条安装门。

## 隔离运行打包 App

`dist/mac-arm64/Rovai AI.app` 是可被下次打包覆盖的生成产物，不得作为日常安装版运行。日常 App
必须位于仓库外；完整边界见[本地开发与 App 隔离流程](local-workflow.md)。

从仓库根目录运行刚生成的 App 时，显式创建隔离 `userData`：

```bash
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai AI.app"
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai AI" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

如果刚完成重新打包，正在运行的旧进程不会自动切换到新 bundle。不要通过打开 `dist` 覆盖日常
进程；只停止本次隔离验收实例后，再用新的隔离目录启动。

打包 App 自身不要求系统安装 Node.js、pnpm 或 Rust。普通启动也不要求所有 Product Runtime
全部存在。只有实际启动对应 AgentRun 时，才要求所选 Runtime 已安装、认证且探测
Ready。

用户工作区可以是普通目录或无 Commit 的空 Git 仓库。Git 相关功能会按当前目录动态
探测，不是 App 启动或 Camp 创建的全局硬门。

## 产物检查

确认架构和内置 Core/CLI：

```bash
file "dist/mac-arm64/Rovai AI.app/Contents/MacOS/Rovai AI"
file "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai-core"
file "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai"
```

需要确认本次 release Core 已进入 App 时，可比较 Mach-O UUID：

```bash
dwarfdump --uuid resources/bin/rovai-core
dwarfdump --uuid \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai-core"
dwarfdump --uuid resources/bin/rovai
dwarfdump --uuid \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai"
```

codesign 会修改签名相关字节，因此不要把签名后文件的逐字节 `cmp` 当作唯一一致性
判断。

真实 App 截图和隔离 `userData` 使用方法见
[桌面 UI 验收](ui-acceptance.md)。
