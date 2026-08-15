---
document_type: implementation-plan
version: v0.87
authority: implementation-plan-and-acceptance
status: in_progress
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
- [ ] 完成 Rust fmt/test/strict Clippy、TypeScript/Vitest、文档治理与 UI detector；
- [ ] 完成 macOS package、签名/架构检查、隔离启动验收和 `/Applications` 安装；
- [ ] 提交并推送 `main`。

## Rust 测试退役说明

旧的 ignored `real_trae_active_health_smoke` 要求 health check 主动启动 TRAE；该行为现在被
[ADR-0192](../../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)禁止，继续保留会把
已废止行为误写成准入要求，因此移除。替代责任由三个层次共同承担：静态/health tripwire 证明检查零启动，
fake ACP execution 证明真实任务只启动一次，AgentProfile lifecycle 测试证明同一执行证据可升级 Ready。

## 自动验收证据

最终门禁完成后在这里回填命令、通过数量、package 路径和安装验收结论；在此之前不得把本版本标为 complete。
