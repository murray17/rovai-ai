---
document_type: implementation-plan
version: v1.26
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-22
---

# v1.26 Cursor Agent Catalog 接入实施验收计划

## 1. Research、identity 与准入边界

- [x] 复核 Cursor 官方 ACP/Skill 文档和仓库 Research，不把文档能力写成行为通过；
- [x] 隔离探测当前候选 `2026.08.11-e8db854`，记录 initialize 成功、authenticate 超时和 Session 阻断；
- [x] 识别本机 `/opt/homebrew/bin/agent` 为 Grok Build，固定 `cursor-agent` canonical command 与严格别名校验；
- [x] 三个平台均保持 `not_qualified`，qualified evidence revision 为空。

## 2. Product Runtime 与数据合同

- [x] 扩展 Rust/TypeScript Adapter closed set、显示名、环境变量、discovery 与 launch policy；
- [x] Migration 104 扩展 Installation/Profile closed kind 与 Cursor Skill group，保留旧数据和自定义 Skill assignment；
- [x] Ready validator 只接受 initialize/authenticate/session-new 的同一强合同；
- [x] Runtime Activity registry、diagnostics、monitoring、planned shutdown、Camp 删除与 App shutdown 覆盖 Cursor。

## 3. ACP、安全与能力收窄

- [x] 实现 bounded authenticate、private ask/plan 唯一 Prompt 路由与 private notification 隔离；
- [x] 权限 argv、read-only plan、附件/Run tmp `--add-dir` 与 External MCP 拒绝有确定性回归；
- [x] 禁用未经验证的 History Restore、warm reuse、Missing-Send、Usage 和 Compaction；
- [x] Skill delivery 只拥有项目 `.cursor/skills`，Runtime load/invocation 保持 DocumentationOnly。

## 4. Renderer 与文档

- [x] 设置、Onboarding、成员参数、侧栏和监控加入 Cursor identity 与官方图标；
- [x] macOS `not_qualified` 使用平台中性文案，Windows 保持 Windows-specific 文案；
- [x] 更新 Runtime Contract、Architecture、Activity、Compatibility、Research、UI brief 与版本轴；
- [x] Impeccable detector、Renderer 定向测试、typecheck 与 build 全部通过。

## 5. 最终验证

- [x] Rust fmt/check、Adapter/Discovery/Health/Activity/Platform Admission 定向测试通过；
- [x] Migration v104 专项回归与当前 schema gate 通过；
- [x] workspace Rust/TypeScript/Renderer 适用门禁通过；
- [x] `pnpm docs:test`、`pnpm docs:check` 与 diff-aware docs gate 通过；
- [x] 最终 diff、敏感信息、临时路径与未准入能力声明复核完成。

验证说明：`cargo clippy --workspace --all-targets -- -D warnings` 仍命中
`antigravity.rs` 中既有的 `large_enum_variant` 与 `collapsible_if` 基线；允许这两项既有 lint 后严格 Clippy
通过。本版没有扩大或豁免新的 Cursor lint。

## 后续平台 Qualification（不属于本版完成条件）

只有用户明确授权并完成 Cursor 登录后，才开启新的 qualification 版本，按 checklist 运行 authenticated First
run、command output、Approval allow/deny、cancel、private requests、terminal、Built-in CLI、process cleanup、
Session strategy 与 MCP isolation Smoke。届时必须生成新的不可变 compatibility evidence revision；不得直接
修改本版未准入记录为“已通过”。
