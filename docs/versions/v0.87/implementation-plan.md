---
document_type: implementation-plan
version: v0.87
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.87 实施与验收计划

## Checkpoint 0：P0 启动权限收口

- [x] 新增中央 `RuntimeLaunchPurpose`，TRAE 仅允许真实 `AgentExecution`；
- [x] discovery、check/ensure、managed/custom refresh、health/deep probe 与 dispatch preflight 静态化；
- [x] 低层 version、health 与 ACP execution 入口分别加不可绕过的 purpose guard；
- [x] 后台仍可定时检查 TRAE，但只刷新路径、fingerprint 与静态版本，不启动 CLI。

## Checkpoint 1：P1 状态与同进程验证

- [x] 增加 `installed_unverified` snapshot、Availability、Readiness 与 Renderer 状态；
- [x] 只允许 Runtime default model 与安全默认权限保存未验证 TRAE 配置；
- [x] 复用真实 AgentRun 的 `initialize` / `session/new|load` 结果升级 Ready；
- [x] Session 建立失败时禁止 replacement/diagnostic 第二进程，并从首个进程错误记录失败分类；
- [x] unchanged Ready 在静态复扫中保留，复扫周期按最近静态身份校验计时。

## Checkpoint 2：P2 静态版本

- [x] 进程内读取 `.app` 的 `Info.plist`，优先 `CFBundleShortVersionString`；
- [x] 进程内解析 modern inline Go build information，只接受 TRAE main module 的非-devel 版本；
- [x] 没有可信静态来源时保持 `reportedVersion = null`，不把 fingerprint/mtime/任意字符串当版本。

## Checkpoint 3：回归与治理

- [x] 用 tripwire 覆盖 TRAE version enrichment 与 health probe 零进程；
- [x] 用 fake ACP Host 覆盖首次真实任务恰好一个进程、无 `--version`、同进程证据升级 Ready；
- [x] 覆盖静态 Installation → 成员原子配置 → frozen binding → live Ready 生命周期；
- [x] 覆盖 Renderer 状态、说明、按钮文案和其他 Runtime 不变；
- [x] 完成 Rust fmt/test/strict Clippy、TypeScript/Vitest、文档治理与 UI detector；
- [x] 完成 macOS package、签名/架构检查、隔离启动验收和 `/Applications` 安装；
- [x] 提交并推送 `main`。

## Rust 测试退役说明

旧的 ignored `real_trae_active_health_smoke` 要求 health check 主动启动 TRAE；该行为现在被
[ADR-0192](decisions.md#adr-0192)禁止，继续保留会把
已废止行为误写成准入要求，因此移除。替代责任由三个层次共同承担：静态/health tripwire 证明检查零启动，
fake ACP execution 证明真实任务只启动一次，AgentProfile lifecycle 测试证明同一执行证据可升级 Ready。

## 自动验收证据

- Rust：`cargo fmt --all -- --check` 与 `cargo clippy -p rovai-core --all-targets -- -D warnings`
  通过；`cargo test -p rovai-core` 在干净的 `720e3b7f` 快照通过 lib 471/471、CLI 12/12、
  Core 79/79，另有 3 个仅手工真实 Runtime smoke 按设计 ignored；首次全量运行中一个 2 秒 Codex
  version fixture 在系统高负载下超时，隔离连续 5 次和无并行打包负载的完整重跑均通过。
- Frontend 与脚本：同一干净实现快照通过 `pnpm typecheck` 和 `pnpm test`；其中文档单测 21/21、
  Vitest 342/342、Node 脚本测试 186/186。后续同 `main` Composer 提交另行通过其新增测试，不改变
  本版本 Runtime 验收范围。
- 文档治理：`pnpm docs:adr:generate`、`pnpm docs:test`、`pnpm docs:check` 通过；ADR history、
  version pointer、Contract/Architecture/UI 路由一致。Impeccable detector 按规则执行一次，仅报告
  `styles.css` 中既有 side-tab/layout advisory，本版本新增 Renderer 规则无命中。
- macOS：在干净的 `44757673` 快照运行 `pnpm package:mac`，生成
  `dist/mac-arm64/Rovai-ai.app`；App、`rovai-core` 与 `rovai` 均通过 strict codesign 检查并确认为
  arm64，内置二进制 UUID 与 release 产物一致。
- 隔离验收：以 `ROVAI_ALLOW_ISOLATED_INSTANCE=1` 和一次性 `--user-data-dir` 启动打包 App，Desktop
  与 Core 到达 `core_ready`；进程参数证明 SQLite 和 managed Skill Library 均位于该隔离目录。
- 安装提升：旧日常 App 正常退出后，以已验收产物替换 `/Applications/Rovai AI.app`，未修改
  `~/Library/Application Support/Rovai-ai`；安装位置的 codesign、arm64、UUID 与 `app.asar` SHA-256
  复核一致，并从 `/Applications` 重新启动确认 Desktop、Helper 与 Core 均不再指向仓库 `dist/`。
