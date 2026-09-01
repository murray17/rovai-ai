---
document_type: implementation-plan
version: v1.37
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-01
---

# v1.37 实施与验收

## 实施

- [x] 旧渠道改动先分开 checkpoint，未推送或打包。
- [x] Core 图片表、Run/epoch fence、Blob GC root、Camp-scoped 读取与只读 metadata。
- [x] stable path 只引用；inline 不因 path 存在而丢弃；Run 临时路径在清理前保存；路径允许跨目录和符号链接。
- [x] ACP toolCallId 增量累积与 completed/failed flush；Claude Tool Result；Codex MCP 与原生生成图片。
- [x] 内部图片不进入公开 Evidence、模型输入、CampMessage 或渠道发布。
- [x] 共享 Gallery/Tile/lightbox；保序附件段；运行中图片等待公开消息，终态无消息才兜底；
  展示后位于最后公开消息后、Files Changed 前。
- [x] Chromium 真实解码、坏图局部降级、单列/双列/窄屏与既有双主题。
- [x] 同 Run 的已发送同摘要 Blob 图片展示去重，底层数据不删除；统一 Tool/发送图片内容列与原比例图片框。
- [x] 两种图片均去除文件名、来源/数量标题、projection 说明与系统打开/Finder 菜单，只保留大图预览和关闭。
- [x] Renderer 进程内缓存已解码 Blob payload；附件切回不重读，Runtime 切回先显示再后台刷新，Tile 独立释放 URL。
- [x] 钉钉完整产品链路未验收，合入 main 前隐藏渠道页整个入口；保留实现、已有数据及独立登录组件回归。
- [x] 具体文件点击直接创建临时只读 Preview handle；工作区外文件、五类来源与 symlink 不再自动升级 Root Grant；
  HTML/Markdown 资源限定文档目录并随 Tab 释放，Renderer 删除 `authorization_required → chooseAuthorizedRoot()`。
- [x] 开发者单独确认 revision 1 后实施精确文件帮助与飞书新 Bootstrap 提示；静态资源与其他上下文轴不变。
- [x] 开发者单独确认 Principal 寻址教学 revision 1 后，从 Authority boundary 删除正文 `@Principal`
  寻址暗示；仅 Charter revision 3→4，`rovai send --help`、发送效果与 Agent audience 投影不变。
- [x] 开发者确认多队员 mention cluster revision 3 后，将 Agent `body` help 收敛为 payload 说明；扩展
  Core-only 行首连续有效 alias 解析，未知/歧义/`@Principal` tail 保持 Text，不新增拒绝。
- [x] Antigravity 真实生成图片终态、TRAE/Copilot 专用图片结果 fixture 与适配；本机队员经过隔离 Core 复测。
- [ ] Cursor 非标准生成通知的真实成功 fixture；本机旧 CLI 不支持 ACP，无证据不实现猜测 parser。

## 验证 owner

- `file-preview-access.test.ts` 与 `file-preview-service.test.ts` 拥有具体文件能力边界：默认 containment 仍拒绝越界，
  只有五类可信文件来源显式启用 exact external file；覆盖绝对/Home/file URI/symlink、Attachment、Run Evidence、
  child handle、描述符恢复、reload、系统操作、HTML CSS/图片、Markdown 相对链接、目录 Root Grant 保留与资源释放。
- `pnpm test:file-reference-navigation` 使用生产 `FilePreviewProvider` 的隔离 Electron fixture，强制注入旧
  `authorization_required`，验证点击不会调用 `chooseAuthorizedRoot`，内部授权原因不会进入用户通知；同时保留
  文件定位、阅读锚点、键盘与双主题回归。该夹具不启动 Core、Runtime 或访问日常数据。

- `agent_run_image::tests::published_attachment_replaces_matching_runtime_image_presentation` 拥有跨来源展示过滤，
  使用同一个隔离 SQLite fixture；既有混合存储测试没有消息/附件关系，不能覆盖这个组合读取 seam。
  修复前同 Run 的 Blob 与同摘要附件会同时显示；覆盖内容/来源不匹配、附件失效、消息删除、稳定路径
  可变与底层记录/重放保留。最小命令 `cargo test -p rovai-core --lib published_attachment_replaces_matching_runtime_image_presentation`。
- 既有 `runtime-image-gallery` Electron owner 增加横/竖/方形/小图、单/多图和双主题比例检查；
  `camp-open-projection` owner 在生产 CampWorkspace 中比较 Tool/发送图片的尺寸、对齐和样式，
  防止发送图片因短正文而收缩，并确认图片没有额外文字/菜单；这两个 owner 分别验证组件图片比例与
  会话组合布局，不重复存储矩阵。原图片菜单/系统打开回退随功能一起退出，替换为无入口断言，
  Runtime/发送图片的大图、Escape 关闭、坏图禁用和焦点恢复仍验证。
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
- `ImageGallery.test.ts` 与既有 `App.test.ts`：连续分组、全部20图、解码失败、锚定顺序、
  运行中无消息时延迟与终态兜底；ImageGallery 另覆盖实际 Blob 预算、FIFO 淘汰、附件已完成缓存、
  Runtime 强制刷新与进行中读取复用、正常 `null` 和请求异常的区分；
  `channel-settings.test.ts` 沿用飞书附件独立上传失败/正文不重发的测试。
- `node --test scripts/lib/runtime-image-gallery.test.mjs`：生产组件的隔离 Electron，真实 SVG decode、
  坏图、contain、无附加文字/系统操作、lightbox 与焦点、双主题/窄屏。大图使用可用窗口空间，不得因
  居中定位反而缩小；等待关闭后的焦点恢复完成再断言。无 Core/Runtime/渠道网络。
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
- 扩展并重命名既有 inline parser、Send schema 与 SQLite alias owner：覆盖同一行 display/display、
  canonical/display、重复 occurrence、换行、正文终止、literal invalid tail、两个 Structured Mention/Delivery
  及 PublicOnly 完整旁路；不新增平行数据库 fixture。最小命令分别使用
  `message_delivery::tests::line_leading_display_name_alias_supports_whitespace_separated_clusters`、
  `team_tool::tests::slow_tests::public_send_schema_keeps_inline_fallback_out_of_agent_body_help` 与
  `team_tool::tests::slow_tests::public_send_resolves_line_leading_display_name_cluster_before_delivery`。
- 核对到既有文档漂移：基础不变量曾把 Bootstrap 第三段写成 COLLABORATION_STATE；按既有实现、
  formatter golden 和 Built-in 架构校正为 MEMORY_ENTRYPOINT。仅校正文档，不改变 Bootstrap 格式。

## 证据状态

### 2026-09-01 Principal 教学与多队员 mention cluster

- Principal Authority-boundary 精确 owner、Session Charter 矩阵、Send schema、PublicOnly、display-name parser 与
  两队员 SQLite Delivery 定向 owner 全部通过；`@惠 @Principal` 明确保持 accepted，只路由惠并保留后半正文。
- `cargo clippy --workspace --all-targets --features slow-tests -- -D warnings` 与 `cargo fmt --all --check` 通过；
  `pnpm test:rust:pr` 的 Library 472、CLI 32、slow 297 项全部通过。
- `pnpm test` 通过：133 个 Vitest 文件 / 1356 项、220 项 Node tests，1 项既有 Windows 原生测试按平台跳过；
  文档 9 项、Skill 3 项及对应治理门禁通过。`pnpm typecheck`、`pnpm build:desktop` 和 `git diff --check` 通过。
- 固定 PR base `5384c8e515fbbe468d1fc018afdc0a51c7ff886d` 的 `docs:check:ci` 通过。本阶段未调用模型、
  启动真实 Runtime 或向渠道发件；Applications 打包与非终止安装在 main 合并后执行。

- Principal 寻址教学 revision 1 实施后，两项精确 Rust owner、`cargo fmt --all --check`、文档单测 9 项、
  普通文档门禁及固定 main base `02d5a3c381ae430cef67cf7ae43045c4301058ad` 的 CI 文档门禁通过；
  未启动 Runtime、调用模型、发送消息、安装或重启日常 App。
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

### 2026-09-01 图片展示收口

- 本机最近一次生成的橘猫图片，Runtime Blob 与同 Run 显式发送附件具有相同 SHA-256；问题是展示重复，
  不是生成两次。只读 metadata 过滤后保留发送图片，底层两种记录和稳定路径语义不变。
- 定向 Rust 图片测试 5 项通过；Renderer/App/theme 定向 Vitest 176 项、typecheck 和 Desktop build 通过。
- 使用这张实际 PNG 只读验证生产 Gallery 和完整 CampWorkspace；Tool/发送图片在 1040/1440/2560px
  内容列一致，单/多图均无文件名、来源数量标题或系统操作。双主题、480px 窄窗、横/竖/方/小图
  保持原比例且无补边；大图不缩小，Escape 关闭和焦点恢复通过。未重新调用模型或向渠道发件。
- 沿用现有主题与组件；Impeccable 的布局检查无命中，全局扫描中的既有非图片 CSS 提示不扩大本次范围。
- 文档单测 9 项、普通与固定 main base `cdafec7136f4135fd09ac5bf9592fd8a27b39b9a` 的通用文档门禁通过。
  Applications 安装与重启另按用户后续明确要求进行，不以组件夹具通过代替打包 App 验收。
- 用户明确要求重启后，`package:mac:daily` 的 arm64 ad-hoc 签名门禁和独立临时目录的 packaged 启动
  验收通过（主页、队员、详情、新对话；未发送消息或调用模型）。随后通过安装门替换 Applications，
  原 App 正常退出，新 Main/Core 为 40094/40119，均从规范安装路径启动，继续使用原数据目录。
  App ASAR 摘要与构建产物一致；Core UUID `FBA0FFAD-4D68-34E2-B5BA-D8F0419C9789`，
  CLI UUID `454A050D-6261-35C3-B29F-92910F8BC8A4`，均与构建暂存和打包产物一致。
  旧 bundle 保留为 `/Applications/Rovai AI.backup-before-20260831T163050Z.app`；没有改写或替换日常数据，
  没有 commit、push 或创建 PR。重启后桌面读取仅返回窗口名称、无截图，故最终日常会话的视觉复核未计为通过；
  图片视觉证据来自上述使用实际 PNG 的生产组件/完整 CampWorkspace 隔离验收。

### 2026-09-01 会话切换图片缓存

- 只在 Renderer 内新增 128 MiB Blob payload FIFO，按本次实际 `blob.size` 计量；未增加存储类型、内容版本、
  引用计数、持久化字段或新 Core 协议。每个 Tile 独立创建 Object URL，提交替换或卸载时自行释放；缓存淘汰
  不调用 `revokeObjectURL()`。
- 附件缓存命中后不再读取；任意 Runtime 图片先恢复缓存，再以同一个进行中 Promise 后台调用
  `agentRunImages.read`。请求抛错保留旧图，正常 `null` 或真实解码失败清除旧图，成功候选解码完成后再替换。
- 定向 Vitest 8 项、全量 133 文件 / 1356 项 Vitest、TypeScript 类型检查和 Desktop build 通过；文档单测
  9 项、普通门禁及固定 main base `02d5a3c381ae430cef67cf7ae43045c4301058ad` 的 CI 文档门禁通过。
  隔离 Electron 生产 Gallery 在 StrictMode 下验证冷读去重、附件切回零读取、Runtime 切回首次可见绘制
  无 loading、后台内容替换、临时请求失败保留、`null`/坏图失效，以及卸载和替换 URL 的释放；未启动
  日常 App、Core、Runtime 或渠道连接。

### 2026-09-01 渠道入口发布范围

- 按用户要求，渠道页只保留飞书；钉钉 Tab、计数、连接/发布区域与残留登录弹窗均隐藏。
  旧选中值回退到飞书，只有钉钉的 Snapshot 显示正常空态。没有删除钉钉源码、账号、凭据或 Bot，
  也没有改变 Main/Core 后台生命周期；钉钉完整产品链路仍未验收，不作为本次公开入口交付。
- 既有 `ChannelSettings.test.ts` 覆盖含已发布 Bot 的旧选中值及各连接状态；
  `test:dingtalk-login` 先验证真实渠道页不恢复隐藏入口和残留弹窗，再独立挂载保留的生产登录组件，
  保留扫码、取消、重试、组织选择和原生视图隔离回归，不给产品增加隐藏开关。
- typecheck、133 文件 / 1352 项 Vitest、220 项 Node 测试（1 项既有 Windows 原生跳过）、
  独立 Electron 钉钉登录夹具、Desktop build、fmt、Clippy、文档与 Skill 门禁通过。
  `test:rust:pr` 的 Library 470 项、CLI 32 项、slow 294 项均通过；另跑 Core Main 187 项通过，
  4 项原有真实 Runtime 人工 Smoke 保持显式忽略，没有以单元测试替代外部验收。
  本次没有重新打包、安装或重启日常 App，也没有调用真实 Runtime 或向渠道发件。
- 首次 PR CI 暴露两个跨平台时序问题：Core 子进程的 `exit` 可能先于最后 stdout 帧，导致启动拒绝与
  authority assessment 被丢弃；改为 stdio `close` 后才释放 generation。既有三种 assessment 表驱动
  owner 改用可控 stdout，固定“exit → 最后状态帧 → close”并保留重试参数断言，修复前均明确失败；
  其他真实子进程、关闭与重试回归保留。图片组合夹具则先把鼠标移到中性位置，确保比较相同 hover
  状态；没有放宽图片尺寸或样式断言。CoreClient 16 项、typecheck、Desktop build 和隔离 CampOpen
  夹具修复后通过，等待新的 PR CI 结果。

### 2026-09-01 取消可用性收口

- 沿 [V1.37-D02](decisions.md#v1-37-d02) 与已确认的
  [输入边界修订](model-context-change-cancellation.md) 实施：取消事务直接结算 Run/Turn 业务终态，
  Runtime 清理只写同 Run/epoch 的清理事实，不再通过带 Run version 的 cancellation ACK 命令收口。
  本机只读诊断确认旧卡点是迟到输入观察推进 Run version，使 ACK 被 fence；固定 ACK command ID
  随新版本重试又产生幂等冲突。没有改写日常数据库或借重启掩盖这个问题。
- 只增加 Input `dispatch_started_at`、Channel `retry_suppression_json` 和窄索引，Migration 134 原子升级至
  v1.44/schema85。发送准入和取消以数据库提交排序；未知效果保持 failed/accepted_input_outcome_unknown，
  不自动重发。非终态旧 prepared 保守迁移为 unknown，历史终态不改写。
- 成员离队原样复用两个 affected selector，结算自身 lifetime 和已持久化关联工作的 Run，
  原 pending delivery 原因码、Gather/item、Task 解除 assignee 保留。reconciliation 同事务 completed；
  只重算受影响 Turn，同轮无关 Run 和仍 admitted 的渠道请求不受整轮关闭影响。
- 三秒总清理预算涵盖启动 token、interrupt、flush 和受管进程 reap。超时保留 active/lease，
  后续同 Conversation Run 有界失败；启动任务结束后再次确认 Host 回收，避免第一次没有 handle、
  随后创建进程却提前记为已清理。强制删除保留幂等回放和原 bypassedBlockers，退出 wire protocol 仍为 3。
- 打开 Camp 或渠道准入只补偿该 Camp 的旧半取消对象。Renderer 停止状态只表示请求尚未返回，
  收到 Applied 即应用 Core 终态并刷新；不再等待 Runtime ACK。
- 后续定向复核补正两个遗漏：Run-local、成员 cutover、成员全局移除与旧半取消修复都把精确 Run ID
  带到事务提交后，再复用 terminal delivery pump；整轮取消仍不 pump。Runtime cleanup scanner 改为
  `ActiveExecutionKey` 进程内去重后后台启动，主 scheduler 不等待三秒清理任务，原 Conversation fence 保留。

取消回归 owner 与准入说明：

- `context::slow_tests::cancellation_serializes_with_dispatch_and_late_acceptance_is_evidence_only`
  拥有发送准入/取消两个顺序、迟到 accepted/unknown、错误 epoch 和不推进版本的 cleanup replay；
  同一 Conversation 的 cleanup gate 只在确认后解除。复用既有 Context fixture；旧 ACK 正向 owner
  不覆盖提交顺序，纯 formatter 无法证明 SQLite 与 Conversation watermark 的隔离。
  最小命令：`cargo test -p rovai-core --lib --features slow-tests cancellation_serializes_with_dispatch`。
- `planned_shutdown::tests::cancellation_keeps_an_unbound_launch_isolated_until_cleanup`
  使用内存 coordinator，拥有无 route 时 token 取消和 active 记录保留；旧 shutdown admission 测试没有
  单 Run 取消状态。最小命令：`cargo test -p rovai-core --lib cancellation_keeps_an_unbound_launch`。
- `runtime_fleet::tests::cancelled_run_retains_its_lease_until_a_confirmed_reap` 使用既有 fake Host，
  连续两个超时验证第一次失败不能抹掉 Run 到进程的关联，再确认成功 reap 和重复清理；
  这是全局 shutdown 并发测试没有的定向重试边界。
  最小命令：`cargo test -p rovai-core --bin rovai-core cancelled_run_retains_its_lease`。
- `tests::cancellation_covers_launch_without_a_handle_and_has_one_total_deadline` 替换原只验证 timeout
  常量的测试；复用隔离 Core fixture，增加不结束的 launch 和窗口后才出现的协议夹具 Host。
  该检查必须经过真实 Core 清理入口、launch registry 与受管子进程，内存 timer 测试不能证明 reap。
  它不调用真实 Provider 或模型；超时允许 Unproven，但禁止进程仍在时宣称已清理。
  最小命令：`cargo test -p rovai-core --bin rovai-core --features slow-tests cancellation_covers_launch`。
- `tests::runtime_cleanup_dispatch_is_non_blocking_and_deduplicated` 复用隔离 Core 与 launch registry，
  持有未完成 launch 时验证 scheduler-facing scan 在一秒内返回、重复扫描只有一个 cleanup worker，
  首次三秒清理为 `Unproven` 后释放去重键并保留候选供下轮扫描；release 后重试才写 cleanup ACK。
  最小命令：
  `cargo test -p rovai-core --bin rovai-core --features slow-tests runtime_cleanup_dispatch_is_non_blocking`。
- `team_tool::tests::slow_tests::user_run_cancellation_releases_the_next_target_busy_delivery`
  验证 Run cancel 提交后立即物化同收件人的下一条 A2A Delivery；既有
  `running_outbound_delivery_target_is_reconciled_when_source_membership_ends` 扩展为验证成员 cutover
  终止其派生目标 Run 后，无关来源的下一条 Delivery 继续运行。最小命令分别使用上述两个完整测试名执行
  `cargo test -p rovai-core --lib --features slow-tests <test-name>`。
- `channel::tests::cancellation_preserves_local_output_and_suppresses_only_aborted_turn_retries`
  复用既有渠道 fixture，分别验证单 Run 和整轮边界、pending/attempting/sent、迟到回执与下一请求 FIFO。
  旧发送重试测试没有取消业务事务，纯 outbox reducer 无法证明 Turn/request 的联动。
  最小命令：`cargo test -p rovai-core --lib --features slow-tests cancellation_preserves_local_output`。
- `camp_open::slow_tests::open_repairs_only_cancellation_marked_work_in_the_requested_camp`
  复用 seeded fixture 建两个 Camp，验证只修目标半取消、保留普通 waiting，重复 Open 不写库。
  旧投影 owner 只读，不能证明新增入口补偿的作用域。
  最小命令：`cargo test -p rovai-core --lib --features slow-tests open_repairs_only_cancellation_marked_work`。
- 扩展既有 migration chain/admission owner 验证 134 receipt 失败的完整回滚、重试和历史保留；
  扩展原成员/A2A/Gather/删除/退出 owner 保留全部原边界，删除旧 ACK 测试仅因该命令协议在同次改动退出，
  幂等、User/Camp/version 权限及 Run-local 效果关闭转由事务终态 owner 承担，没有删除支持的升级来源。
  退出 owner 另验证两次业务结算的原 cycle NULL-count 约束，以及业务失败不能计为 Runtime terminal。
- Renderer 复用 `App.test.ts` 取消投影 owner，验证 Core 返回 cancelled/failed 的即时应用和无关 Run 保留；
  benchmark fingerprint 只同步当前 v1.44/schema85 断言。未增加模型可见上下文或测试专用产品入口。

本轮隔离验证：

- 后续 pump/scheduler 补正复跑：Library fast 472 项、slow 297 项、CLI 32 项通过；Core Main
  194 项通过、4 项既有真实 Runtime 人工 smoke 忽略。Clippy、Rust fmt、文档三道门禁、TypeScript、
  133 文件/1352 项 Vitest、220 项 Node 测试（1 项既有 Windows 原生跳过）和 Desktop build 通过。
- Library 全量含 slow 768 项：767 项通过，既有 Runtime 版本探测在并发负载下出现一次超时；
  原条件单独复跑通过，没有放宽 deadline 或跳过该测试。退出/Git 观察/terminal provenance 的后续扩展通过。
- Core Main 193 项和 CLI 32 项通过，4 项既有真实 Runtime 人工 smoke 仍按原规则忽略；
  late-launch 使用拒绝 SIGTERM 的协议夹具，恢复“只查一次进程”的旧收尾会失败，修正后完整 Core 回归通过。
  该 fixture 不接触日常 App；两个 membership affected selector 与 main 的函数正文逐字相同。
- 类型检查、Clippy、133 文件/1352 项 Vitest、220 项 Node 测试（1 项既有 Windows 原生跳过）、
  Desktop build 和隔离 CampOpen Electron 夹具通过。Node 首轮发现的 benchmark 当前版本断言已同步并全量复跑。
- 文档单测、普通门禁及固定 main base `8988f58d624fea076716f79402888a2e5cb943e3` 的 CI 文档门禁通过。
  新合同使用后继版本并更新 current 路由，原 accepted 历史合同保持不变；通用文档门禁没有增加例外。
  本轮没有安装、重启日常 App，也没有向真实渠道发件。

### 2026-09-01 具体文件直接预览

- Main 只在 Core/Attachment/父 handle 已确认来源并最终定位到普通文件后启用 exact external file；外部文件以
  canonical parent 作为临时 watcher/child 边界，不创建 Root Grant。Attachment、Run Evidence、Home/file URI、
  absolute path、symlink、Markdown/HTML child 与不支持格式系统打开的定向回归全部通过。
- HTML/Markdown token 固定到 `dirname(canonicalFile)`，CSS 相对图片可用，Camp root 中但文档目录外的资源返回
  404；释放父 handle 后 token 返回未授权，已打开子 handle 独立保留。显式外部目录 Root Grant 回归仍通过。
- Renderer 删除自动 `chooseAuthorizedRoot` 分支；生产 `FilePreviewProvider` 的隔离 Electron 夹具注入旧授权错误后，
  目录选择调用为零，只显示通用可恢复文案。文件定位、阅读锚点、键盘、双主题和布局夹具均通过。
- 定向 File Preview Vitest 11 文件 / 84 项、`pnpm typecheck`、`pnpm build:desktop`、
  `pnpm test:file-reference-navigation` 与 `pnpm test:file-preview-layout` 通过；Impeccable detector 无命中。
- `pnpm test` 通过：133 个 Vitest 文件 / 1362 项、221 项 Node tests（1 项既有 Windows 原生跳过），文档 9 项、
  Skill 3 项及普通治理门禁通过；固定 base `ea0634631697d40f72bac05df19aeeb694d2481d` 的
  `docs:check:ci` 通过。未启动日常 App、Core、Runtime，未访问或改写真实 Camp 数据。
