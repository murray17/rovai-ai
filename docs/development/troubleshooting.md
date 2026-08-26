---
document_type: development-guide
authority: local-development-troubleshooting
last_updated: 2026-08-26
---

# 常见问题排查

## `pnpm dev` 启动了旧 Core

先单独重建 Debug Core：

```bash
pnpm core:build:debug
```

确认 `resources/bin/rovai-core` 的修改时间已更新，再重新启动 `pnpm dev`。开发窗口已经
运行时，重新复制二进制不会替换现有 Core 进程。不要改用裸 `electron-vite dev`；标准入口还负责
隔离开发 `userData` 和拒绝重复开发实例。

## `target/` 占用异常增长或磁盘不足

根 `Cargo.toml` 的日常 `dev` profile 不生成原生调试信息；`cargo test` 使用的 `test` profile
继承该设置。增量编译保持启用，以优先保证编辑、构建和测试反馈速度。因此 `target/debug/incremental`
仍会随活跃开发增长，而工具链、feature、`RUSTFLAGS`、分支或包名变更产生的旧编译指纹也可能长期保留。

不要按日或在 `pnpm dev`、测试脚本中自动清理，这会持续破坏增量编译收益。出现以下任一情况时再清理：

- 磁盘开始紧张，或 `target/` 明显高于一次干净构建后的基线；
- Rust 工具链、feature、`RUSTFLAGS` 或包名发生较大变化；
- `target/debug/deps` 中仍有当前 `cargo metadata` 已不存在的旧包名前缀；
- 增量编译异常、指纹反复失效，且普通重建无法恢复。

先停止所有 Cargo、`pnpm dev`、Rust 测试和打包进程，再只读检查范围：

```bash
du -sh target
du -sh target/debug/deps
du -sh target/debug/incremental
cargo clean --dry-run --profile dev
```

文件数量很大时，`du` 和 dry run 也可能需要数分钟。若只需丢弃增量状态、保留已编译依赖：

```bash
rm -rf target/debug/incremental
```

若 `deps` 也包含大量历史产物，清理整个 Debug/Test profile，同时保留 Release：

```bash
cargo clean --profile dev
```

只有确认 Release 也无需保留时才运行完整清理：

```bash
cargo clean
```

这些命令只删除 Cargo 生成物，不触碰源码或 Electron `userData`；代价是下一次对应构建需要完整重编。

## Core 报告数据目录已被占用

这表示另一个 Core 已经持有相同 `--data-dir` 的操作系统独占锁。新 Core 会在打开 SQLite 和执行
startup recovery 前退出，因此不要删除 `.rovai-core-instance.lock`，也不要反复重启绕过失败。

先只读检查报错中记录的 PID、可执行文件路径和两个 App 的 `--user-data-dir`。日常安装版保留原目录；
开发、打包验收或截图进程改用新建的隔离目录。确认原拥有者已经退出后，同一目录可以直接重新启动，
不需要删除保留的锁文件。

## `electron-builder` 下载 Electron 时报告 `ENOTFOUND github.com`

这表示 Electron 归档或校验信息的 GitHub DNS/网络访问失败，不表示 Rust、TypeScript 或 Electron Vite
构建失败。即使 `~/Library/Caches/electron/` 中已有 ZIP，当前打包链仍可能联网读取校验信息。

- 本地没有通过 checksum 验证的目标版本 arm64 归档时，不要在同一个无 GitHub 网络的执行环境反复
  运行 `pnpm package:mac`；第一次尝试就改用可访问 GitHub 的执行环境。
- 本地归档存在时，按[打包文档的受限网络流程](packaging.md#electron-下载与受限网络)使用 Electron 包
  自带 checksum 验证后，通过 `electronDist` 直接读取该 ZIP。
- 若失败日志表明前置 `pnpm build` 已成功，恢复时不要再次执行 Release 编译，只重跑文档中的
  `electron-builder` 命令。
- 不要删除有效缓存，也不要通过关闭 TLS、关闭 checksum 或使用未审核镜像来消除错误。

## 打包后仍看到旧行为

确认打包命令成功结束，并使用独立 `userData` 启动新产物：

```bash
pnpm package:mac
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai AI.app"
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai AI" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

可按[打包文档](packaging.md)比较 release Core 与 App 内 Core 的 Mach-O UUID。

## 日常 App 正在从 `dist/` 运行

这是开发/日常通道混用，不是支持的安装方式。先停止新的构建和 Runtime 投递，确认目标工作区没有
未结副作用，再彻底退出该 App。完成隔离验收后，由用户显式把确认过的 `.app` 安装到仓库外位置；
开发循环继续使用 `pnpm dev`，打包产物继续使用临时 `userData`。不要在 App 运行时移动或覆盖 bundle。

## 投递期间出现 startup recovery 或 `delivery_unknown`

先检查是否存在两个 Core 共享同一数据目录，或是否有开发/验收命令误用了日常 `userData`。只读检查
进程和事件；不要为读取数据再启动一份 Core。若输入已经 `prepared` 但没有 accepted ACK，Runtime
可能已经执行，不能用普通 Retry 假定“未投递”。先检查 Native Session、目标工作区副作用和事件时序，
再按恢复合同处理。

新版本若检测到第二个 Core，会在 recovery 之前拒绝启动；已经产生上述事件时，还应确认实际运行的
App/Core 是否为旧构建，以及冲突 Core 是否曾在升级前打开过该目录。

## Runtime 未找到或未 Ready

1. 在“设置 → 执行引擎”执行重新检测或深度检查；
2. 查看诊断页报告的路径、版本、认证和 blocker；
3. 从登录 Shell 验证对应 Runtime 是否可执行；
4. 仅在 PATH 无法表达目标时，临时使用
   [Runtime override 环境变量](environment.md#agent-runtime-是按用途选择的能力)；
5. 不要通过复制用户级 Runtime 配置到 fixture 来绕过探测。

一个 Runtime 缺失不应阻止普通 App 启动，也不意味着其他 Runtime 不可使用。

## 普通目录或空 Git 仓库被误判

产品工作区不要求 Git 或首个 Commit。先确认报错来自哪一层：

- 路径安全检查要求目录存在、可读且通过 canonical 边界；
- Git capability 可以是 `not_git`、空仓库或有效仓库；
- 某个 Smoke 可能自行要求系统 Git 来创建 fixture。

不要为了通过普通目录准入而自动执行 `git init` 或创建无意义 Commit。

## Smoke 超时、产生授权请求或费用

真实 Runtime Smoke 继承上游账户、模型和权限策略。先查看
[测试表](testing.md#真实-runtime-smoke)，确认命令是否调用模型以及支持哪些 selector。

超时排查顺序：

1. 对应 Runtime 的 Discovery/Deep Probe 是否 Ready；
2. 上游认证、额度、网络和模型名是否有效；
3. 是否有未处理的 Runtime 原生 Approval；
4. 临时 fixture 是否被保留并包含 Core stderr；
5. 重跑时是否会产生第二次费用或重复外部副作用。

不要把扩大预算、关闭审批或重复真实副作用作为默认重试策略。

## `codesign` 校验失败

先确认目标是本次生成的 `dist/mac-arm64/Rovai AI.app`，再运行：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Rovai AI.app"
codesign -dv --verbose=4 "dist/mac-arm64/Rovai AI.app"
```

本地 `package:mac` 是仅供隔离验收的 ad-hoc 签名，不会产生 Notarization 票据，也不得替换日常
`/Applications`。日常安装构建使用 `pnpm package:mac:daily`；它同样使用 ad-hoc 签名，但会在打包后验证
App、Core、CLI 的签名、架构和 Bundle ID，再由 `install:mac:daily` 完成受控替换。GitHub Release 的固定
证书导入、指纹校验和正式产物验证是独立路径；正式证书或公证问题按[打包文档](packaging.md)单独处理。

## SQLite 被占用或验收修改了日常数据

立即停止相关 App/Core 进程，不要在运行中的数据库上直接复制文件或执行修复 SQL。
从诊断页确认真实路径，使用 SQLite Backup API 创建副本，并在隔离目录复现。具体步骤
见[桌面 UI 验收](ui-acceptance.md#从明确来源创建只读隔离副本)。

## 文档与命令不一致

优先检查 `package.json#scripts`、目标脚本和当前版本实施计划。若常青文档与它们不一致：

1. 不要把历史版本说明当作当前命令；
2. 在同一改动中修正文档入口和交叉链接；
3. 不记录个人绝对路径或即时工具版本；
4. 新增或删除 `smoke:*`、`accept:*`、`package:*` 命令时同步更新开发文档表。
