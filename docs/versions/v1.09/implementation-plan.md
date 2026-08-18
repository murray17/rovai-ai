---
document_type: implementation-plan
version: v1.09
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.09 实施与验收计划

## Checkpoint 0：版本与合同

- [x] 将完成的 v1.08 冻结为 historical，并建立唯一 current v1.09；
- [x] 接受 Camp Conversation Find v1 与 Run Process Detail Surface v8；
- [x] 更新 Camp Read Path、Built-in Runtime、Camp UI、Theme、Contract/ADR current route 与 UI acceptance。

## Checkpoint 1：精确读合同与 Core

- [x] 建立独立 `camp.messages.find`，保持 Agent-facing `camp.search` 不变；
- [x] 只扫描当前 Camp 非墓碑 user/agent Structured Content 的 Human 正文投影；
- [x] 返回 exact count、单个选中 match、Unicode scalar offset 与 read high-water；
- [x] 为大小写、Unicode、非重叠、anchor、wrap 和内容排除建立 Rust/Contract 测试。

## Checkpoint 2：Desktop 查找交互

- [x] 在 CampWorkspace 内注册 `Command/Ctrl+F`，非 Camp 页面不注册；
- [x] 地图状态自动切换会话，保持 Draft、Inspector 与执行台状态；
- [x] 实现 live query、计数、Enter/Shift+Enter、按钮、Esc/关闭与失败重试；
- [x] 旧命中复用 around-window，查找期间阻止 follow-latest 抢走阅读位置；
- [x] 前后导航按精确 occurrence 文字 Range 居中，并避开悬浮查找条；
- [x] 关闭后恢复打开前阅读位置与焦点；
- [x] 使用 Porcelain Day / Steel Night 语义 token、非颜色定位线和 `aria-live` 播报。

## Checkpoint 3：CLI help 与输入失败

- [x] 识别 top-level `oneOf` 中所有分支共有且 const 各异的 discriminator；
- [x] 从 branch Schema 读取 required、properties、const、enum、type、minimum/maximum 与长度约束；
- [x] common field 只在定义和 requiredness 全部一致时提升，`campId` 成为 common optional；
- [x] flattened arguments 仅继续负责合法 flag、field、基本类型与任意顺序解析；
- [x] direct/stdin/input-file 在构造对象后统一执行 canonical Schema validation；
- [x] 字段 issue 按 missing、mode scope、enum/const、type、numeric、length 顺序返回且最多 4 条；
- [x] 保持 `builtin_tool.invalid_input / fix_input`，不回显用户内容和内部身份。

## Checkpoint 4：执行台 Tool 详情

- [x] 删除最后 12 个 Tool 的 Renderer 切片，不增加“较早 N 项”；
- [x] Built-in runtime action 从 Core Envelope `result/error` 提取公共详情，兼容 canonicalResult；
- [x] `camp.read/search` 行在有结果时使用现有 Tool disclosure；
- [x] 长结果在原 disclosure 中有界预览并提供完整复制；
- [x] 删除 standalone“查看完整工具调用”、raw Payload 挂载状态和遗留 CSS；
- [x] 扩展既有 Rust CLI owner test，未增加独立 Rust test 文件或 `#[test]`。

## Checkpoint 5：合并后发布门禁

- [x] TypeScript、Renderer、Rust 定向回归与 Desktop build 通过；
- [x] 文档治理、fmt、Clippy 与差异检查通过；
- [x] macOS package、签名、arm64 与隔离打包 App 验收通过；
- [x] 合并后的 v1.09 提交与同一验收 bundle 具备推送 `main` 和提升至 `/Applications` 的条件。

## 已有分项验收记录

- 会话查找分项已通过 typecheck、61 个 Vitest 文件共 409 项测试、`cargo test --workspace`、定向
  slow-test、fmt、Clippy、文档治理与真实打包 App 键盘/视觉验收；
- CLI/Tool 详情分项已通过 `rovai` 14/14、Renderer `App.test.ts` 94/94、typecheck、Desktop build、
  Clippy、文档治理、macOS package、严格签名/arm64 与真实 Core IPC 打包 App 验收；
- 两次分项全仓入口的唯一失败均为 `current-contract-conformance` 引用已经不存在的旧 Rust 测试名；
  前置提交 `be0b89cf8786c2d085d4de18fbcc313897976e60` 已存在同一失败，相关 benchmark profile 和
  数据库迁移合同不属于两项功能差异。

## 合并后集成验收

- `pnpm typecheck` 通过；`App.test.ts` 与 `camp-conversation-find.test.ts` 合计 98/98 通过；
- `cargo test -p rovai-core --bin rovai` 14/14 通过；`cargo clippy -p rovai-core --bin rovai --
  -D warnings`、`cargo fmt --all -- --check` 与 `git diff --check` 通过；
- 文档测试 21/21、版本/ADR 治理和 ADR HISTORY 检查通过；
- `pnpm package:mac` 重新生成 arm64 bundle；App、Core、CLI 通过严格 codesign 和 Mach-O arm64 检查；
- `pnpm accept:runtime-activity-ui` 通过：长结果仅挂载 11 行有界预览，完整复制取得 8,432 行，未泄露
  Envelope，legacy 完整工具调用控件计数为 0；
- `pnpm accept:conversation-find-ui` 通过：65 条消息中的 4 个公开命中精确显示 `4 / 4`，旧命中有界
  加载、超长消息首尾 occurrence 可见、循环导航、Esc 恢复、地图返回、非 Camp 边界与双尺寸双主题
  均成立。

## References

- [v1.09 版本概览](README.md)
- [Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md)
- [Run Process Detail Surface v8](../../contracts/run-process-detail-surface-v8.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [本地 Runtime 工作流](../../development/local-workflow.md)
- [macOS 打包与验收](../../development/packaging.md)
