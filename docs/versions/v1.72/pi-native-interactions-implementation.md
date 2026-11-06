---
document_type: implementation-record
version: v1.72
status: completed
last_updated: 2026-11-05
---

# Pi 原生交互桥接

Work item: Pi 四类原生问答，共用待处理区域。
Branch: `rovai/pi-native-interactions`。
Base: `origin/main`，`46274cb412717b4a27ee92e19f1a8d2e05a1c41c`。
Worktree: `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-pi-native-interactions`。
Governance: none；本次无须主线先行的治理变更。

## 范围与实现

[Native Interactions v1](../../contracts/native-interactions-v1.md)拥有协议；
[会话 UI](../../ui/components/conversation-workspace.md)拥有展示。

PiRuntime 维护局部内存记录，使用已有读流、owner、Session、Run/epoch、stdin 和停止通道。
确认、选择、单行输入和多行 editor 只做请求转换、共用待处理展示和原路回传。
同一队员可有多个请求；公屏与私聊按可见 Run 过滤。执行审批和问答的提交路径分离。

按 User 确认采用 v12 的布局、选项行和直接操作；不复制原型中的任意文本直接回复 select 分支。
真实 select/input 接续不识别英文标签、不预造下一题。发送只表示原生通道已写入，不增加 ACK、
新 Run、问卷表、后台重试或答案日志。其他 Runtime 的禁用和运行终态不变。
这是现有 Pi RPC 的局部桥接；当前协议和 UI 合同已覆盖取舍，不另造通用问卷框架或 Version Decision。

## 测试归属

- 扩展原 `pi::tests::unsupported_native_extension_ui_is_cancelled_without_managed_interpretation` owner，
  更名为 `native_extension_ui_preserves_answers_and_expires_without_default_answers`；
  保留未识别请求的取消边界，退役 confirm 的自动否兜底，新增原生映射、空白与空文本、跳过、选项标识、editor/期限和重复入站矩阵。
  修复前四类请求均被自动取消，无法等待和原路回传。使用纯内存状态，不新建数据库或进程 fixture。
- 扩展 `pi::host::tests::active_input_receipts_and_late_abort_keep_exact_rpc_correlation`，
  复用其 resident writer owner 验证并发只写一次、停止先释放对话、迟到答案及 abort 等待期间的迟到问题。
  测试用 abort/get_state 回执排列协议进程的文件观察，不把管道 flush 误当作 Pi 答案 ACK。
- 沿用 `approval-dock` 隔离 Electron fixture，验证生产组件的混合队列、焦点、草稿、单/多行、
  点击提交、跳过能力、失败、未知、超时、断线和日夜布局；只模拟 transport。
- `scripts/smoke-pi-native-interactions.mjs` 使用隔离 Core、官方 Pi 和受控本地 Provider；
  与普通单元测试分开运行，不调用外部模型。可选 `ROVAI_PI_QUESTION_PLUGIN=/absolute/index.ts`
  接入已安装的真实问卷扩展，不修改用户原生配置。

Rust 独立测试函数新增/删除均为零；最低命令为
`cargo test -p rovai-core --features extended-tests --lib pi::`。
默认 workspace、TypeScript、文档、Desktop/Web transport 和生产组件回归在集成阶段统一运行。

## 验证记录

macOS arm64，官方 Pi **1.1.0**，已安装 `@juicesharp/rpiv-ask-user-question` **2.15.0**。
[机器可读证据](evidence/pi-native-interactions-2026-11-05.json)记录版本、范围、结果及源文件 SHA256。

| 验证 | 实际结果 |
|---|---|
| 真实 Core → Pi RPC → 扩展 | 四类对话、真实 select/input 接续、前后空白/中文/换行/空文本和原生结果精确相等 |
| 真实已安装问卷扩展 | 单选、自行填写与多选文本通过；插件自行发出后续 input，Host 不解析插件文案 |
| 同一队员/多个队员 | 同一 Run 同时两题、两个队员并行等待、双提交和 epoch 围栏通过 |
| 私聊隔离 | 私聊问题只出现在对应投影，公屏列表为空；原私聊 Run 正常完成 |
| 期限与停止 | 原生超时、期限不重置、迟到回答拒绝、停止解除等待通过；原始 Run 继续而非重跑 |
| Rust | `cargo test --workspace`：484 通过、1 ignored；Pi 定向：25 通过、1 ignored |
| Renderer/Web | `TZ=UTC pnpm test`：269 个 Vitest 文件通过，3126 通过、2 skipped；Node 尾段 377 通过、2 skipped |
| 新增回归与构建 | App/SingleChat/Web 恢复定向 214 通过；typecheck、Desktop 构建和隔离世界 bridge 通过 |
| 生产待处理组件 | 审批/问答混合、草稿、焦点、点击即提交、单/多行、跳过能力、失败/未知、双击、断线和超时通过 |
| 视觉 | 五套配色、200% 缩放、1040×700、窄会话列及手机几何通过；已查看生产组件截图 |

Core/data、Skill、MCP、Pi 配置和 workspace 均在独立临时目录；没有调用外部模型或修改日常 App/原生配置。
Provider 是受控本地 stream，Pi 进程、SDK、RPC、扩展和 Core 是真实实现；不能把它写成真实付费模型验收。
Renderer 使用受控 transport，与真实 Core/Pi 回路分开记账。未单独进行等待中强杀 Core 重启、Windows/Linux 原生 UI
或真实手机键盘验收；Core 问答记录不持久化，协议不能观测的原生局部取消边界见当前合同。

## 反馈回归修正

首轮验收遗漏了 Web 不同问题同时提交、公屏/私聊交叉清理草稿和 `timeout: 0` 三个组合。
沿用同一 worktree 最小修正：Web 冲突按 interactionId；发送前拒绝标记为普通失败，真正未知仍禁止重发；
公屏外层、ApprovalDock 与输入组件的保存/清理统一按可见范围；零超时不生成期限，正数期限规则不变。
无新增队列、恢复服务、存储层或 Core 问答协议。

回归归属：Web recovery owner 覆盖不同题并发、同题防重复、明确未准入和原未知提交不可被后续拒绝覆盖；
drafts owner 以同 Thread 三个范围及重载验证隔离；原生产卡片 fixture 验证发送前拒绝可再次操作、真正未知禁用、
公私聊分别清理后重挂载不丢草稿；原 Rust Pi owner 增加 confirm/select/input 零超时矩阵，不增加 Rust 测试函数。
真实 Pi probe 的首个 confirm 使用 timeout: 0，验收要求没有期限、等待后仍可原路回答。

[补充验证证据](evidence/pi-native-interactions-followup-2026-11-05.json)单独保存本次结果与源文件 SHA256，
不覆盖首轮证据。修复前新增 Web/draft 回归及原 Rust owner 的零超时输入均失败；修复后：

| 验证 | 实际结果 |
|---|---|
| 真实 Pi 1.1.0 / rpiv 2.15.0 | 六组 RPC 验收通过，含零超时等待后作答、正数超时和迟到回答 |
| Rust 默认 / Pi 定向 | workspace 484 通过、1 ignored；Pi 25 通过、1 ignored |
| 完整前端回归 | 270 个 Vitest 文件通过，3132 通过、2 skipped；Node 尾段 377 通过、2 skipped |
| 生产卡片 | 未发送失败可重试、未知禁用、两队员提交独立结束、公私聊清理后重挂载草稿完整 |
| 编译与门禁 | typecheck、Desktop 构建、Core binaries 构建、Desktop bridge、Rust 格式检查通过 |

Status: ready。代码与证据完成；按 User 既有约定提交并推送任务分支，不自动创建 PR，保留同一 worktree 后续复用。
Next: 后续明确要求 PR 时继续使用本分支；不关闭 #1012。
