---
document_type: implementation-plan
version: v1.09
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.09 实施与验收计划

## Checkpoint 1：精确读合同与 Core

- [x] 建立独立 `camp.messages.find`，保持 Agent-facing `camp.search` 不变；
- [x] 只扫描当前 Camp 非墓碑 user/agent Structured Content 的 Human 正文投影；
- [x] 返回 exact count、单个选中 match、Unicode scalar offset 与 read high-water；
- [x] 为大小写、Unicode、非重叠、anchor、wrap 和内容排除建立 Rust/Contract 测试。

## Checkpoint 2：Desktop 交互

- [x] 在 CampWorkspace 内注册 `Command/Ctrl+F`，非 Camp 页面不注册；
- [x] 地图状态自动切换会话，保持 Draft、Inspector 与执行台状态；
- [x] 实现 live query、计数、Enter/Shift+Enter、按钮、Esc/关闭与失败重试；
- [x] 旧命中复用 around-window，查找期间阻止 follow-latest 抢走阅读位置；
- [x] 关闭后恢复打开前阅读位置与焦点。

## Checkpoint 3：视觉与可访问性

- [x] 使用 Porcelain Day / Steel Night 语义 token 表达普通与当前命中；
- [x] 当前消息提供非颜色定位线，状态由 `aria-live` 播报；
- [x] 在 `1440×920` 与最小 `1040×700`、Day/Night 和 reduced-motion 下验证；
- [x] 查找条与会话/地图切换器、历史加载、Inspector 和 Composer 不冲突。

## Checkpoint 4：发布门禁

- [x] TypeScript typecheck、Vitest、Rust 定向/全量、fmt、Clippy 与文档治理通过；
- [x] 构建 Desktop 并用隔离 `userData` 对打包 App 完成真实键盘与视觉验收；
- [x] 完成 Impeccable finish review 与文档收口；
- [x] 全部实现与验收证据成立，本计划与概览标记 complete，已验收产物具备推送 main 与提升到 Applications 的条件。

## 验证记录

- `pnpm typecheck`、61 个 Vitest 文件共 409 项测试、`cargo test --workspace`、定向 slow-test、`cargo fmt --check` 与 Clippy 全部通过；
- 文档版本、ADR diff freeze、ADR HISTORY 和文档测试通过；
- 打包 App 专项验收覆盖完整历史、旧命中有界加载、循环导航、瞬时播报、Esc 恢复、地图焦点、非 Camp 边界和双尺寸双主题布局；
- 仓库总入口 `pnpm test` 唯一失败是 `current-contract-conformance` 引用已经不存在的旧 Rust 测试名；同一失败存在于前置提交 `be0b89cf8786c2d085d4de18fbcc313897976e60`，本版未修改该 benchmark profile 或数据库迁移合同，不把它误记为 v1.09 回归。

## References

- [v1.09 概览](README.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)
- [macOS 打包与验收](../../development/packaging.md)
