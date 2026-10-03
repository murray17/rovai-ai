---
document_type: development-guide
authority: macos-build-and-packaging
last_updated: 2026-10-03
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

## 主动检查更新发布集合

正式打包 App 在首个主窗口加载完成 5 秒后主动检查，之后在每轮完成 6 小时后再检查。Main 通过打包进
App 的 `app-update.yml` 读取官方 `murray17/rovai-ai` GitHub Release 通道；检查只形成共享版本事实和
可关闭的全局提醒，不自动下载。下载、安装和重启分别由用户显式确认，下载进度由 Renderer 投影；
“安装并重启”先让 updater stage 安装器，再进入既有受控关闭。

本地隔离 packaged UI 验收可以在同时满足隔离实例 admission 时设置
`ROVAI_DISABLE_AUTO_UPDATE_CHECKS=1`，避免访问真实 Release 通道。该变量不对日常实例生效，也不构成
更新功能或签名连续性的发布证据。完整状态及发布说明语言合同见 [App Update v7](../contracts/app-update-v7.md)。

[`build/release-notes.md`](../../build/release-notes.md) 是 macOS 与 Windows 共用的唯一发布说明源；
`package.json#build.releaseInfo.releaseNotesFile` 必须显式指向它。首个非空行必须是
`# Rovai AI v<package.json version>`，正文必须非空且不超过 100,000 字符。electron-builder 把其原始
Markdown 写入 `latest-mac.yml` / `latest.yml` 的 `releaseNotes`，使 updater 不再把 GitHub Atom HTML
fallback 当作页面日志内容。发布者不得手工维护另一份 manifest 日志，也不得为日志展示增加 Renderer
GitHub 请求；版本提升必须在同一个 Release PR 中更新该文件。

新发布的共用文件必须同时包含非空英文和简体中文段。版本首标题保留在公共前言中，语言标记是
Markdown 语法树的顶层独立单行 HTML 注释，段正文从标记后开始，直到下一个标记或文件结束。
标记必须与相邻内容分隔，使解析器可识别独立节点；推荐如下格式，精确语法由
[App Update v7](../contracts/app-update-v7.md#language-boundaries)拥有：

```markdown
# Rovai AI v<package.json version>

<!-- lang:en -->

## What's new

- English changes and upgrade guidance.

<!-- lang:zh-CN -->

## 更新内容

- 中文更新内容及升级提醒。
```

公共前言只放两种语言共用的内容；升级提醒等需要翻译的内容必须分别写入对应语言段。
`check-release-source.mjs` 和 Server draft 组装使用同一个 CommonMark/GFM 解析器，拒绝缺少中英文、
重复语言标记、格式歧义或空语言段。仅隐藏注释、HTML、定义、禁用图片及递归空容器不算正文，
不能用它们满足非空门禁。GitHub Release 正文使用完整文件（`--notes-file`），不能只取一种语言；
Server draft 流程已直接复用此源。manifest 与内嵌日志也保留完整原文。
应用展示按当前界面语言选择副本，匹配缺失或为空时按 v7 回退；无标记历史、全空或异常分段保留全文。
文档级链接和完整脚注按原文 first-wins 保留，不能依赖所选语言段覆写同名定义；建议使用不同标识符。
切换界面语言不发请求、不重置日志版本选择、不修改 updater 快照；具体显示规则见
[App Update v7](../contracts/app-update-v7.md#document-level-definitions-and-display-cleanup)，不属于发布字节变更。

Desktop Main 也在构建时内嵌此文件，并只在首标题与运行版本完全匹配时把它作为当前版本日志投影给
Renderer。更新页离线显示当前日志；新版日志继续只来自既有更新检查结果。`releaseInfo.releaseNotesFile`
本身仅保证更新清单内容，不能替代 App 内嵌。验收打包产物时应核对 Main 快照与页面都含当前日志。

[`build/release-metadata.json`](../../build/release-metadata.json) 记录与包版本绑定的发布日期 UTC 时间戳。
版本提升时与更新日志一同更新；`build:desktop` 在打包前校验版本一致且日期规范，避免把上一版日期带入
新包。正式发布时对照 GitHub Release 的实际发布日期；若跨日，须在分发产物前修正元数据并重新构建。
Main 与 Desktop 托管的 Web 页面只在元数据版本匹配运行版本时离线展示该日期；新版日期仍取自 updater。

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
拿到错误更新包，因此发布必须 fail closed。每个架构的 `scripts/verify-macos-release.mjs` 还必须验证
清单日志与源 Markdown 完全相同；合并器拒绝两个架构之间任何稳定 Release 元数据差异。
合并输出必须保持 YAML 1.1 字符串兼容性，尤其不能省略 `releaseDate` 的引号；否则
`electron-updater` 会将时间戳解析为 `Date` 对象，旧客户端会丢弃候选版本的日期。
`scripts/lib/macos-update-info.test.mjs` 使用更新器自身的解析器验证合并前后字段和值类型一致。

已发布的 v0.0.1 没有 ZIP/`latest-mac.yml`，旧 App 也没有自动安装能力，所以
`v0.0.1 → v0.0.2` 是一次性手动迁移。后来到 v0.4.0 的公共 macOS 包使用仓库原有的临时自签名
`Rovai Release Signing`；本地 daily 包是 ad-hoc 签名。它们的 designated requirement 均不与
Apple Developer ID 身份兼容。切换到 Developer ID 的第一个版本，即使旧 App 在“关于与更新”中查到并下载了
新版本，Squirrel.Mac 的安装阶段也不能作为成功升级路径。发布说明和公告必须明确要求这两类 macOS
用户首次手动下载新版 DMG、退出旧 App、替换 `Rovai AI.app` 后再启动。保持 Bundle ID
`ai.rovai.desktop` 和原有用户数据路径；不要卸载或清理用户数据。只有完成这次迁移并安装 Developer ID
版本后，后续同一 Apple Team ID 的正式版本才能使用应用内“安装并重启”；发布前仍须以真实旧版→新版
升级验收确认。

## 本地签名

普通本地 `package:mac` / `package:mac:unsigned` / `package:mac:daily` 关闭自动证书发现并显式使用
`identity=-`，因此生成 ad-hoc 签名产物。前两者只用于隔离开发验收；需要显式提升到日常
`/Applications` 时，必须使用带完整验证门的 `package:mac:daily` 和 `install:mac:daily`。任何本地 ad-hoc
产物都不能作为自动升级签名连续性或正式分发签名的证据。

检查签名：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Rovai AI.app"
codesign --verify --strict \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai-core"
codesign --verify --strict \
  "dist/mac-arm64/Rovai AI.app/Contents/Resources/bin/rovai"
```

仓库签名 workflow 与本地安装入口相互独立：它从受保护的 `release-signing` 环境导入 Developer ID
Application 证书，校验 SHA-256 指纹和 Team ID，使用现有 Hardened Runtime entitlements，分别公证并
贴票 App 与 DMG。每个架构的 verifier 检查 Apple Developer ID 签名链、Team ID、designated requirement、
App/CLI/Core/Host 架构、App/DMG 票据和 Gatekeeper 准入；任何一项失败都不得发布。本地 daily 命令不得
调用或放宽这两个 Release 入口。证书、密码和公证 API Key 不得写入仓库。

### 首次配置 Apple Developer ID 发布环境

1. 在 Apple Developer 的 Certificates 中创建 **Developer ID Application** 证书（不是 Apple Development、
   Apple Distribution 或 Developer ID Installer）。在生成 CSR 的同一台 Mac 钥匙串中保留私钥，把证书与
   私钥导出为有密码的 `.p12`。Apple Developer Team ID 应与证书名称末尾的括号内容一致。
2. 在 App Store Connect 的“用户与访问 → 集成”确认 Team API Key 权限；首次使用 API 时 Account Holder
   可能需要先申请访问。创建可用于 Notary Service 的 **Team Key**，妥善保存只能下载一次的 `.p8`、
   Key ID 和 Issuer ID。Individual API Key 不能用于 `notarytool`。不要把 `.p12`、`.p8`、密码或
   base64 内容提交到仓库或贴到 Issue/日志。
3. 在 GitHub 仓库的 `release-signing` Environment 设置变量 `MAC_RELEASE_TEAM_ID`（10 位 Team ID）和
   `MAC_RELEASE_CERT_SHA256`（证书 SHA-256 指纹，64 位大写十六进制、无冒号）。设置 Secrets：
   `MAC_CSC_LINK`（`.p12` 的 base64）、`MAC_CSC_KEY_PASSWORD`（导出密码）、
   `APPLE_API_KEY_BASE64`（`.p8` 的 base64）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。
   本地可用 `openssl x509 -in certificate.pem -noout -fingerprint -sha256` 读取指纹，或从 Keychain
   Access 导出证书后读取；只记录指纹，不公开私钥。
4. 合入发布代码并提升版本与 `build/release-notes.md` 后，从 `main` 手动运行
   `.github/workflows/macos-signed-build.yml`。它先检查证书指纹和有效身份，分别签名、公证 App，
   再公证 DMG，最后验证两种架构并合并唯一的 `latest-mac.yml`。只有完整的
   `rovai-macos-signed` artifact 和全部验证通过后，才能把五件发布集合上传到同一 GitHub Release。
5. 用隔离机器或隔离用户数据验证新 DMG 的首次安装；再用上一版 Developer ID 正式包测试“关于与更新”
   下载和“安装并重启”。切换时的旧临时签名用户按上文执行一次手动迁移，不能把其旧 App 能显示更新视为
   安装已获验证。

本机需要把已验收构建提升为日常安装版时，使用专用 ad-hoc 入口：

```bash
pnpm package:mac:daily
pnpm install:mac:daily --backup "/Applications/Rovai AI.backup-before-<timestamp>.app"
```

`package:mac:daily` 不读取本机 Keychain 证书；构建后立即验证 App、Core、CLI 的架构、ad-hoc 签名、
CDHash designated requirement 与 Bundle ID，并拒绝证书签名或缺少有效 ad-hoc 签名的候选。
`install:mac:daily` 只接受 `/Applications/Rovai AI.app` 作为规范目标；它在修改日常路径前验证源 bundle，
并用 no-follow 路径项检查拒绝任何已有 backup 和符号链接 target，包括 dangling symlink。复制到目标同
文件系统暂存路径后再次验证，原子替换后第三次验证。交换前失败会报告旧安装未改变；交换后失败时尽力
恢复旧安装并保留验证失败的新候选供诊断。若宿主在回滚期间继续拒绝改名，错误会明确报告规范路径是旧
安装、未验证候选或缺失，以及旧备份是否仍被保留，不会误报已恢复。脚本不会覆盖备份或修改日常
`userData`。普通 `package:mac` 虽然也是 ad-hoc，但没有完成 daily 的打包后门禁，仍不得代替
`package:mac:daily` 作为提升入口。

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
