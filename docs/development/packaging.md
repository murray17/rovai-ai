---
document_type: development-guide
authority: macos-build-and-packaging
last_updated: 2026-08-20
---

# macOS 构建、签名与打包

当前仓库记录的桌面交付目标是 macOS 14+ Apple Silicon。`package:mac` 和 `dist:mac`
固定生成 arm64 产物。

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

该命令准备并验证外置 legal payload、执行 source provenance gate、构建 Core/CLI/Renderer，
然后只以 `--integrity-only` 验证生成的 `.app`。它不把本地工程验收等同于公开二进制发布批准。

`pnpm package:mac` 在构建前执行完整 binary release gate。`option-ext 0.2.0` 采用经项目所有者
确认的保守 MPL-2.0 方案：准确且未修改的 crates.io 源码归档、完整 MPL 文本、来源记录和源码取得
说明同时进入公开仓库与 App 外置 legal payload。门禁会验证归档哈希、内容、Cargo 元数据和通知路径，
任一事实漂移都会在进入构建和签名前失败。

### 法律来源门与外置 payload

依赖、素材、Schema 或 Skill 来源发生变化时，先在 frozen install 上重建并审核 tracked 清单：

```bash
pnpm legal:generate
pnpm legal:check:source
```

`legal:generate` 从 `pnpm-lock.yaml`、安装包许可证文件、`Cargo.lock` 和 macOS arm64 release
graph 生成稳定排序的 JavaScript/Rust/素材 manifest。生成结果属于审查输入，不应在不看 diff 的情况下提交。
`legal:check:source` 校验 artwork/嵌入图片哈希、13 个 Skill NOTICE、Runtime Logo 表、Codex
schema 归一化摘要、精确依赖版本与许可证文本；未知来源、未知许可证、缺失 NOTICE 或
`REVIEW_REQUIRED` 都会失败。

打包前运行：

```bash
pnpm legal:prepare
```

该命令删除并重建 ignored 的 `.legal-payload/`，从 Electron `43.1.1` 的准确平台归档复制原样
`LICENSE` 与 `LICENSES.chromium.html`，先用包内 `checksums.json` 验证归档 SHA-256，再生成无
时间戳、无绝对路径、稳定排序的 `manifest.json`。Electron Builder 将它复制到：

```text
dist/mac-arm64/Rovai-ai.app/Contents/Resources/legal/
```

该目录位于 `app.asar` 外，可直接读取。工程完整性检查与公开发布门必须区分：

```bash
pnpm legal:check:package -- --integrity-only dist/mac-arm64/Rovai-ai.app
pnpm legal:check:package -- dist/mac-arm64/Rovai-ai.app
```

第一条验证文件覆盖、稳定 manifest、大小与 SHA-256，供当前 unsigned 验收使用。第二条还要求
所有 binary legal review 状态获批，并核验 `option-ext` 精确源码归档、MPL 文本、来源记录与接收者说明。
`dist:mac` 和两个正式 release 脚本在构建/签名前执行完整 binary preflight，未获批时不会进入签名或
notarization 流程。

### Electron 下载与受限网络

`legal:prepare` 和 `package:mac:unsigned` 需要准确 Electron 归档；随后 `electron-builder` 仍可能访问
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

pnpm legal:prepare
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
dist/mac-arm64/Rovai-ai.app
```

生成 DMG（要求完整 binary release gate 已通过）：

```bash
pnpm dist:mac
```

DMG 文件位于 `dist/`，文件名由 `package.json#build.mac.artifactName` 决定。

## 本地签名

当前本地脚本关闭自动证书发现，`package.json#build.mac.identity` 使用 `-`，因此生成
ad-hoc 签名产物。它适合本机开发验收，不代表可以对外发布。

检查签名：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Rovai-ai.app"
codesign --verify --strict \
  "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core"
codesign --verify --strict \
  "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai"
```

正式分发需要独立配置 Developer ID、Hardened Runtime entitlement 和 Apple
Notarization 凭据，并验证公证结果。不要把证书、密码或 notarization 凭据写入仓库。

## 隔离运行打包 App

`dist/mac-arm64/Rovai-ai.app` 是可被下次打包覆盖的生成产物，不得作为日常安装版运行。日常 App
必须位于仓库外；完整边界见[本地开发与 App 隔离流程](local-workflow.md)。

从仓库根目录运行刚生成的 App 时，显式创建隔离 `userData`：

```bash
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai-ai.app"
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai-ai" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

如果刚完成重新打包，正在运行的旧进程不会自动切换到新 bundle。不要通过打开 `dist` 覆盖日常
进程；只停止本次隔离验收实例后，再用新的隔离目录启动。

打包 App 自身不要求系统安装 Node.js、pnpm 或 Rust。普通启动也不要求十个 Runtime
全部存在。只有实际启动对应 AgentRun 时，才要求所选 Runtime 已安装、认证且探测
Ready。

用户工作区可以是普通目录或无 Commit 的空 Git 仓库。Git 相关功能会按当前目录动态
探测，不是 App 启动或 Camp 创建的全局硬门。

## 产物检查

先验证法律文件位于 `app.asar` 外且 manifest 完整：

```bash
find "dist/mac-arm64/Rovai-ai.app/Contents/Resources/legal" -type f
pnpm legal:check:package -- --integrity-only dist/mac-arm64/Rovai-ai.app
```

默认不带 `--integrity-only` 的命令是公开二进制发布门，不能为了获得绿色结果而跳过或弱化待复核项。

确认架构和内置 Core/CLI：

```bash
file "dist/mac-arm64/Rovai-ai.app/Contents/MacOS/Rovai-ai"
file "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core"
file "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai"
```

需要确认本次 release Core 已进入 App 时，可比较 Mach-O UUID：

```bash
dwarfdump --uuid resources/bin/rovai-core
dwarfdump --uuid \
  "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core"
dwarfdump --uuid resources/bin/rovai
dwarfdump --uuid \
  "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai"
```

codesign 会修改签名相关字节，因此不要把签名后文件的逐字节 `cmp` 当作唯一一致性
判断。

真实 App 截图和隔离 `userData` 使用方法见
[桌面 UI 验收](ui-acceptance.md)。
