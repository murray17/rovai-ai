---
document_type: development-guide
authority: macos-build-and-packaging
last_updated: 2026-07-30
---

# macOS 构建、签名与打包

当前仓库记录的桌面交付目标是 macOS 14+ Apple Silicon。`package:mac` 和 `dist:mac`
固定生成 arm64 产物。

## 构建

构建 Release Core 和 Electron：

```bash
pnpm build
```

只构建一部分：

```bash
pnpm core:build
pnpm build:desktop
```

生成可直接运行的 `.app`：

```bash
pnpm package:mac
```

产物：

```text
dist/mac-arm64/Rovai-ai.app
```

生成 DMG：

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
```

正式分发需要独立配置 Developer ID、Hardened Runtime entitlement 和 Apple
Notarization 凭据，并验证公证结果。不要把证书、密码或 notarization 凭据写入仓库。

## 运行打包 App

从仓库根目录启动：

```bash
open "$(pwd)/dist/mac-arm64/Rovai-ai.app"
```

如果刚完成重新打包，先彻底退出旧的 Rovai-ai 进程再打开新 App；已运行进程不会自动
切换到新 bundle。

打包 App 自身不要求系统安装 Node.js、pnpm 或 Rust。普通启动也不要求九个 Runtime
全部存在。只有实际启动对应 AgentRun 时，才要求所选 Runtime 已安装、认证且探测
Ready。

用户工作区可以是普通目录或无 Commit 的空 Git 仓库。Git 相关功能会按当前目录动态
探测，不是 App 启动或 Camp 创建的全局硬门。

## 产物检查

确认架构和内置 Core：

```bash
file "dist/mac-arm64/Rovai-ai.app/Contents/MacOS/Rovai-ai"
file "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core"
```

需要确认本次 release Core 已进入 App 时，可比较 Mach-O UUID：

```bash
dwarfdump --uuid resources/bin/rovai-core
dwarfdump --uuid \
  "dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core"
```

codesign 会修改签名相关字节，因此不要把签名后文件的逐字节 `cmp` 当作唯一一致性
判断。

真实 App 截图和隔离 `userData` 使用方法见
[桌面 UI 验收](ui-acceptance.md)。
