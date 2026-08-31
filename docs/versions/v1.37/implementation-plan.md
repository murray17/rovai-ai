---
document_type: implementation-plan
version: v1.37
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-31
---

# v1.37 实施与验收

## 实施

- [x] 旧渠道改动先分开 checkpoint，未推送或打包。
- [x] Core 图片表、Run/epoch fence、Blob GC root、Camp-scoped 读取与只读 metadata。
- [x] stable path 只引用；inline 不因 path 存在而丢弃；Run 临时路径在清理前保存；路径允许跨目录和符号链接。
- [x] ACP toolCallId 增量累积与 completed/failed flush；Claude Tool Result；Codex MCP 与原生生成图片。
- [x] 内部图片不进入公开 Evidence、模型输入、CampMessage 或渠道发布。
- [x] 共享 Gallery/Tile/lightbox；保序附件段；Run 图片在最后公开消息后、Files Changed 前。
- [x] Chromium 真实解码、坏图局部降级、单列/双列/窄屏与既有双主题。
- [x] 开发者单独确认 revision 1 后实施精确文件帮助与飞书新 Bootstrap 提示；静态资源与其他上下文轴不变。
- [x] Antigravity 真实生成图片终态、TRAE/Copilot 专用图片结果 fixture 与适配；本机队员经过隔离 Core 复测。
- [ ] Cursor 非标准生成通知的真实成功 fixture；本机旧 CLI 不支持 ACP，无证据不实现猜测 parser。

## 验证 owner

- `agent_run_image::tests`：新独立存储/协议边界，无可扩展的旧图片 owner；覆盖增量顺序/重放/failed、
  结构化来源正反例、混合生命周期、epoch/Camp fence、Run 删除/Blob GC、跨目录和 symlink；
  最小命令 `cargo test -p rovai-core --lib agent_run_image`。
- `claude::tests::structured_tool_images_stay_internal_and_are_fenced_by_session_and_replay`：
  Adapter 出口的 Session/replay fence 与内部图片/公开 action 分离，纯 parser fixture，不启动 Runtime。
- 扩展 `execution_evidence::tests::provider_packets_are_reduced_to_public_evidence_fields`：
  Codex 原生图片及 MCP 混合结果的图片 bytes/path 不进入公开 Evidence，只保留文字；开始/终态共用该边界。
- 扩展既有 `db::tests::current_migration_state_admission_matrix`、旧 schema downgrade helper 与
  `v127_preserves_saved_bindings_and_introduces_no_fast_override` 已有完整升级链；133 receipt 故障时
  新表/marker 一起回滚，修复后可继续。current marker 缺 133 必须拒绝，v1.42/schema83 是明确升级源，
  不降低过去的 receipt 判定，不额外创建完整 workspace fixture。
- `ImageGallery.test.ts` 与既有 `App.test.ts`：连续分组、全部20图、解码失败、锚定顺序；
  `channel-settings.test.ts` 沿用飞书附件独立上传失败/正文不重发的测试。
- `node --test scripts/lib/runtime-image-gallery.test.mjs`：生产组件的隔离 Electron，真实 SVG decode、
  坏图、contain、lightbox 与焦点、菜单、附件系统打开回退、双主题/窄屏。无 Core/Runtime/渠道网络。
  同一 decoder 验证 PNG/JPEG/WebP 和缺失 MIME 的二进制输入；不新增图片 codec。
- Runtime compatibility 文档追加本次“协议 fixture ≠ 图片端到端”说明后，同步其既有 SHA-256 evidence revision；
  不改变任何平台/Adapter 的 qualification status、Session 输入或历史资格 artifact。
- 扩展既有 `context::slow_tests::session_charter_publishes_one_cli_only_builtin_contract`：实际 Schema 上
  ordinary/Feishu/DingTalk、active/closed、Quick Chat/Project 与未绑定 Camp 的查询矩阵；全 Adapter 精确拼接。
- 扩展既有 `newly_bound_session_bootstraps_on_its_current_generation` 与
  `replacement_binding_bootstrap_excludes_self_output_from_the_old_generation`：同 Binding 关闭/新增渠道后
  Charter 不变，正常替换才重新选提示，历史 Blob 可读且未重写，Dynamic Context 无新增提示。
  复用已有完整 fixture，不新增独立数据库测试；该持久化/代次边界不能用纯格式化测试替代。
  最小命令为 `cargo test -p rovai-core --features slow-tests --lib <上述测试名> -- --exact`，
  `<上述测试名>` 必须包含 `context::slow_tests::` 前缀。
- 扩展既有教学、CLI help 和 `context_contract::tests`：三条示例、精确文件帮助、旧无 revision / revision 2
  的 digest 失配；现有纯正文/纯附件发送测试保持。最小命令 `cargo test -p rovai-core --lib camp_message_send_teaching`、
  `cargo test -p rovai-core --lib context_contract` 与 `cargo test -p rovai-core --bin rovai`。
- 核对到既有文档漂移：基础不变量曾把 Bootstrap 第三段写成 COLLABORATION_STATE；按既有实现、
  formatter golden 和 Built-in 架构校正为 MEMORY_ENTRYPOINT。仅校正文档，不改变 Bootstrap 格式。

## 证据状态

- 图片实施阶段的 `pnpm typecheck`、`pnpm exec vitest run`（132 文件 / 1280 tests）、`pnpm build:desktop`
  通过；revision 1 实施后再次运行 `pnpm typecheck` 通过，本轮未改 Renderer。
- `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --features slow-tests -- -D warnings`
  通过；图片 focused Rust 4 tests 通过。
- 生产 Gallery 的隔离 Electron 测试通过；独立 Impeccable finish-review 的菜单/回退/焦点三项均 resolved，
  最终 disposition 为 ship。保留既有主题，不改全局设计。
- `pnpm docs:test` 9 tests、普通及显式 main base `cda0585233b1a8957e5aada34335f879ecde7af8` 的
  decision governance 检查通过；`git diff --check` 通过。
- revision 1 二次确认后，`pnpm docs:check`、同一固定 main base 的 `docs:check:ci` 均通过；无治理例外。
- revision 1 实施后 `cargo test --workspace --quiet -- --test-threads=2` 再次通过：lib 468、CLI 32、Core 185，4 项人工 Runtime
  smoke 按既有规则 ignored。此前高并发一轮出现 Runtime discovery 超时，以及文档更新后摘要未同步；
  摘要已按实际文档更新，降低测试并发后全部通过，没有放宽任何测试超时阈值。
- `cargo test -p rovai-core --features slow-tests --lib context::slow_tests:: -- --test-threads=2`
  全部 43 tests 通过，包含三项扩展 owner、纯附件 Current Input、历史 evidence 与 redelivery 冻结。
  确认文案与实现的逐字比对也通过；未新增独立 Rust 测试函数。

上述是初始实施阶段的验证。后续真实 Runtime 补齐与结果见[图片验收](runtime-image-acceptance.md)：
Antigravity 原生生成、TRAE/Copilot 专用图片结果已接入，六种 Runtime 已经过隔离 Core 的图片链。
不是十三 Runtime 全部原生生图成功；没有真实飞书发件或 Windows 图片 UI 实测，不提升平台资格。
后续 main 合并、完整回归与日常 App 安装结果见[本机交付记录](main-merge-and-daily-app.md)。
