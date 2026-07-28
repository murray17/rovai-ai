---
document_type: implementation-plan
version: v0.18
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-28
---

# Rovai-ai v0.18 实施计划与验收清单

> 状态：生产代码、自动验证与打包 App 双尺寸视觉验收完成；
> 键盘和真实 Runtime 验收待完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0064](../../adr/0064-default-on-bounded-automatic-partner-memory.md)

## 检查点 1：Policy、Migration 与 Contracts

- [x] Migration v29 替换旧 policy shape，fresh/upgrade 默认开启。
- [x] Contract 改为 `automaticPartnerMemoryEnabled`，删除 acknowledgement。
- [x] Main allowlist 与 Core dispatch 删除 `memory.autoApply.undo`。
- [x] 设置命令保持 expected-version CAS 和 body-free audit。
- [x] provisional count 泛化为 Companion/Relationship scope key。

## 检查点 2：自动形成矩阵与权威

- [x] Companion Preference/Agreement/Lesson 可自动形成。
- [x] Relationship Agreement/Lesson 的 mutual 与 directed 可自动形成。
- [x] Hearth add 和所有 revise 保持 pending。
- [x] 每 Run 最多 1 条，跨 Companion/Relationship 共享。
- [x] 每 Companion 与每无序 Relationship pair 最多 8 条。
- [x] Relationship pair 的 mutual/双向 directed 共享额度。
- [x] 容量或策略条件不满足时合法建议保持 pending。
- [x] Secret、重复、非法、stale 与 fenced 请求继续拒绝。
- [x] Confirm/Revise 提升 Authority；Retire/Reactivate 正确释放和重查额度。

## 检查点 3：Runtime、Projection 与 Skill

- [x] Tool Schema 和主进程描述覆盖完整非家园自动矩阵。
- [x] Memory Guide 允许 provisional 内容低优先级指导协作。
- [x] Guide 明确 provisional 不是用户授权、批准或安全决定。
- [x] `memory-stewardship` Skill 更新 receipt 与 Authority 语言。
- [x] 自动事件包含深链需要的 scope/kind/identity。

## 检查点 4：长期记忆一级页面

- [x] 图标轨增加长期记忆入口并承载 pending 数量点。
- [x] Settings 删除记忆分区。
- [x] 概览条、固定策略文案与默认开启 Switch。
- [x] Scope 与 Governance 分层，增加当前 Scope 搜索。
- [x] 自动形成显示为有效 Memory，不显示“未确认”。
- [x] pending Proposal 使用可访问 Radix 右侧抽屉。
- [x] 1440 与 1040 宽度保持列表/固定详情双栏。
- [x] 可选标记确认、修订、Review、Supersede、Stop、Reactivate、Forget。
- [x] 自动形成通知支持关闭与 Memory 深链。
- [x] Scope、过滤、搜索、选择和列表滚动位置在 App 会话内保留。

## 检查点 5：自动验证

- [x] DB fresh 与 pre-v29 shape migration。
- [x] 全部合法非家园组合自动形成。
- [x] 每 Run 额度与 Companion/Relationship 额度。
- [x] 关闭只影响未来 Proposal。
- [x] 可选 Confirm 保留 Revision history。
- [x] Core 全库测试。
- [x] TypeScript typecheck。
- [x] Renderer 与主题 Token 测试。
- [x] production Renderer build。
- [x] 隔离数据目录 `smoke:memory`。
- [x] Smoke/acceptance 脚本语法检查并更新为新 Contract。

## 检查点 6：真实 App 验收

- [x] 打包 macOS App 并启动打包产物。
- [x] Meridian Day `1440×920` 截图。
- [x] Meridian Night `1040×700` 截图。
- [x] 1040 宽度保持列表/详情双栏且无横向溢出。
- [ ] 键盘进入一级记忆入口、Scope、治理过滤、搜索和详情操作。
- [ ] 提案抽屉 focus trap、Escape 和关闭后焦点恢复。
- [ ] 默认开启 Switch 的成功 Toast 与关闭后已有记忆不变化。
- [ ] 真实 Runtime 自动形成 Companion 和 Relationship 各一条并显示通知深链。

## 当前验证证据

截至 2026-07-28：

- `cargo test -p rovai-core --lib`：189 tests；
- `pnpm typecheck`；
- `pnpm test`：20 files / 101 tests；
- `pnpm build:desktop`；
- `pnpm smoke:memory`；
- `pnpm package:mac`；
- `node scripts/accept-memory-ui.mjs dist/mac-arm64/Rovai-ai.app`：打包产物的
  Renderer-to-Core IPC、默认开启、v22→v29 升级、Lifecycle、Projection、
  重启持久化和双尺寸视觉验收通过；
- `node --check` 覆盖 Memory smoke/runtime/packaged UI acceptance 脚本。

键盘焦点、提案抽屉完整可访问性和真实 Runtime 自动形成场景尚未执行，不能把上述
证据描述为最终发布验收。
