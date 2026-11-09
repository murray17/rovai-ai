---
document_type: research-note
authority: non-normative
last_updated: 2026-10-28
---

# Hermes 接入与验证

## 官方 ACP 思考强度（2026-11-08）

生产仅接通现有成员模型选项的 `reasoning_effort` 保存与官方 ACP 下发。模型设置后发送冻结值；
缺字段不覆盖，`none` 与 `default` 分别保留原生关闭与恢复默认语义。共享 setter 的响应处理保持
尽力而为，不检查回显相等，不新增确认 RPC、历史观测、状态机或跨 Run 缓存。
原生档位进入已有参数控件，Session 作用域；恢复默认仍是同一选项的普通原生值。
已知 0.22.4/0.22.5 ACP 空 ACK 不构成支持：有覆盖在 prompt 前失败，无覆盖仍可执行。
当前规则见[Hermes 合同](../../contracts/hermes-managed-runtime-v1.md#模型权限skills-与-mcp)。

验收入口：

```sh
node scripts/smoke-hermes-reasoning-effort.mjs /absolute/official-source /absolute/prepared-python
node scripts/smoke-hermes-reasoning-effort.mjs /absolute/official-source /absolute/prepared-python --real-model
node scripts/smoke-hermes-reasoning-effort.mjs /absolute/legacy-source /absolute/prepared-python --legacy
node scripts/smoke-hermes-reasoning-effort.mjs /absolute/official-source /absolute/prepared-python --deferred
```

`--gateway-source=/absolute/legacy-source` 仅在夹具中预先启动旧 Gateway，验证新 ACP 的混合版本路径。
每次使用独立用户 Home、原生 Profile/Gateway、Core data/Skill Library/MCP 和正常固定 CLI 入口。
官方源码保持干净，安装身份由官方 stamp 生成脚本按实际 tag 创建；没有覆盖日常原生配置。
测试 observer 只记录方法、Session、reasoning 字段及回显；Provider 捕获和真实请求转发只属于测试。
缺回显／旧值回显由既有 ACP 协议进程 owner 覆盖，不把合成回包称作官方原生行为。
0.23.0 与 0.22.6 各 9 个 Run、新 ACP／旧 0.22.4 Gateway 9 个 Run、旧 ACP 2 个 Run、
真实 gpt-6.1-sol 4 个 Run、原生延后应用 2 个 Run 均按预期通过（35 个 Run，含 4 次预期拒绝）。
真实请求字节原样转发，14 次主模型调用均捕获预期强度；恢复默认后的 low 来自测试 Profile 配置。
版本、结果与真实 Provider 参数见[脱敏验收记录](reasoning-effort-2026-11-08.json)。


当前接入是 User sequence 56/60 确认的官方 ACP、原生 Home、原生 Session 定位。
CLI 单次业务请求由 Core 查现有 Conversation/活动 Run/lease，不增加表或模型参数。
已验原生版本 0.22.4，源码 `4d04303818b61bf3aa09278af48356315515965b`，执行证据来自 macOS arm64。
2026-10-28 按 User sequence 126 重新开放 macOS arm64/x64，内部采用 Preview，不恢复资格提示。
Windows x64 与 Linux x64 继续隐藏并拒绝普通执行。Intel 入口开放不代表完成目标机实测，
以下原生执行证据不因平台入口开放而扩展。
当前合同见 [Hermes Runtime](../../contracts/hermes-managed-runtime-v1.md)，取舍见 [D67](../../versions/v1.72/decisions.md#v1-72-d67)。
最新执行结果见 [实施记录](../../versions/v1.72/hermes-first-input-implementation.md)。

### 2026-10-28 上游 steer / Diff 复核

最新稳定版为 [0.22.5](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.5)，提交
`bf0203a794a07aac3ff764972ab9087baa4e4f4e`；另核对当日 main
`aad60e1ac670268aa39b364b16b16dbf06de85df`。以下是源码与受控方法探针，不是完整 Core/真实模型验收，
没有升级本机 Hermes 或修改生产接入能力。

- 官方 ACP 可通过 `session/prompt` 中的 `/steer` 调用原生控制，0.22.4 已有该路径。三个版本的
  `gateway_commands.py` 内容相同。`_steer` 用本连接持有的 admission 查询 receipt，只有 started 才向
  对应 generation 投递；空闲、排队或 generation 已变化会回退普通 prompt，不能把任何 `end_turn`
  都当成同轮插话成功。每版本四个受控方法场景共 12 项通过；该次调查尚未接通生产入口；后续接通见下文 Core 验证，升级本身不改变接线。
  见[官方控制逻辑](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/acp_adapter/gateway_commands.py#L158)。
- 0.22.5 与上述 main 的 `tools.py` 相同：普通 `patch` / `write_file` 完成仍投影摘要，并抑制 rawOutput。
  带合法 unified diff 的 patch 结果在两个版本的方法探针中均只生成文本内容；没有完成态 Diff。
  部分审批路径可提供拟议编辑预览，不能宣称每次成功修改均交付完整 Diff。Rovai 的现有结构化映射限制未变。
  见[完成格式化](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/acp_adapter/tools.py#L675)
  与[Gateway 投影](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/acp_adapter/gateway_reply.py#L20)。

### 0.22.4 原生 ACP Steer 实测（2026-10-28）

按 User sequence 128，在不改接入方式的前提下验证 `/steer` 能否接入。当时按严格原生同轮要求判断：
正常文字插话可用，但结束竞争会自动接续，因而尚未开放生产 Steer。**User sequence 130–134 后明确
接受同 Session 紧接着执行；这项早期准入判断已被下文 Core 接通取代，原生观测事实仍保留。**
这次没有修改上游、用户配置、Core Runtime、Run 生命周期或 Gateway 管理方式；新增的是
[可复现原生探针](../../../scripts/probe-hermes-steer.mjs)与[脱敏证据](steer-acp-2026-10-28.json)。
默认 Rust 回归另外发现 macOS 开放后的兼容登记摘要未同步，本次按现有文件字节更新了该摘要，
没有改变 Runtime 准入规则或把 Hermes 提升为已完成平台资格验证。

原生版本固定为官方 tag `v0.22.4` / `4d04303818b61bf3aa09278af48356315515965b`，macOS arm64。
每个夹具使用一个新建测试用户 Home 和一份原生 `.hermes`，Session 共用该夹具 Gateway；
启动普通官方 `hermes --profile default acp`，未启动生产 Core 或桌面。
最终受控 Provider 验证 5 项；最终真实模型 `gpt-6.1-sol` 验证接口拒绝与 2 个同 Session 原生任务，
后者共 6 次主模型调用，分别把文件输出从 RED 改为 GREEN、冷恢复后改为 BLUE。
每轮使用不同指导标记，模型请求从未包含该轮标记变为包含，避免把上一轮历史误认为本轮接受。

| 场景 | 实际证据 | 对接含义 |
| --- | --- | --- |
| 直接 `session/steer` | 返回 `-32601`，没有原生 admission | 该版提供 slash 路径，没有该专用 ACP 方法 |
| 活跃工具期间 `/steer` | 插话响应早于原 prompt 终态；原生仅一条 admission；后续模型请求收到指导 | 正常文字插话可用，真实模型文件结果也通过 |
| 关闭 ACP 后 resume 同 Session，再次插话 | 原 Session 不变；每个原 prompt 各一条 admission，插话没有新增 admission | 冷连接本身不阻止插话 |
| 原任务已结束，但客户端尚未处理终态 | 延迟向测试调用方交付原响应后提交 `/steer`，原生生成 generation 2 的新 admission | 本地提交前检查活跃状态不能消除竞态，原生会自行启动后继任务 |
| 上述后继开始后关闭 ACP | 共享 Gateway 仍执行工具、写出完成文件，第二 admission 正常结束 | 退役 ACP 连接不能阻止或撤回已经发生的后继执行 |
| 活跃期间提交 `/steer` + ACP image block | 第一 admission 为 started 时第二条已 queued，保留一张图片，随后独立执行；没有 steer notice | 图片块绕过 ACP slash 处理；不能把原生图片 prompt 当成同轮插话 |

结束竞态使用测试客户端延迟交付原终态，确定性模拟“调用方仍认为目标活跃，但原生已经结束”的运输窗口；
没有修改 Hermes 代码。原生 `state.db` 只在夹具中只读核对 admission／generation；不是生产查询通道。
图片案例是原生协议边界；当前 Rovai 共享 ACP Steer 提交文字及文件引用，并不直接提交 image block，
因此不能把这项原生媒体限制直接说成现有文件引用路径必然失败。

成功回执只有 `{"stopReason":"end_turn"}`，通知为无 requestId／generation 的普通 agent 文本
`⏩ Steer queued for the active turn: …`。它可作为探针中的已知通知观测，但 generic `end_turn`
不能证明同轮接受；事后识别提示也不能取消原生已自动创建的下一轮。
官方 [ACP prompt](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L621)
与 [slash 控制](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_commands.py#L158)
没有暴露“目标结束就拒绝、禁止转普通 prompt”的 ACP 选项。

早期方案要求目标结束就拒绝，官方 ACP 没有该语义；本地多查一次或关闭 ACP 也不能补齐。
后续按可用性优先接受原生接续，由 Core 延后同一 Run 的收尾；无需等待上游改变，也不新增私有
Gateway 控制通道、插件或映射表。原探针 JSON 的 verdict 记录当时结论，不覆盖现行合同。

复现命令见[测试说明](../../development/testing.md#hermes-原生-steer-边界探针)。证据保留两次探针自身的
错误断言及修正原因：首次误读持久化媒体字段，第二次误认为 slash 字面量会一直保留到模型输入。
最终原生媒体判定依据实际 queued admission 与缺少 steer notice，不依赖该字面量。
早期真实模型通过记录也保留；最终用逐轮唯一标记与不同文件值补强验证。以上均不是完整 Core/CLI/桌面
Steer 验收，不把原生成功路径扩大为生产能力声明。

### Core Steer 接通（2026-10-28）

按 User sequence 134，保留官方 0.22.4 ACP、原生 Home、精确 Session resume 和原生 Session CLI。
通过已有 Steer 输入口提交 `/steer`；Core 已知结束时改走普通队列。原生恰在提交期间结束并接续时，
原 Run 保持活动，待原请求和已发出的补充请求全部返回再收尾。只在现有 ACP prompt 状态保存未决
数量和待发布终态，没有表、文件映射、查询握手、插件、上游修改或额外执行服务。

[可复现生产 Core 探针](../../../scripts/smoke-hermes-steer.mjs)与[脱敏结果](steer-core-2026-10-28.json)
覆盖如下；macOS arm64，未运行 Desktop UI 或 Intel 硬件验收。

| 场景 | 受控 Provider | 真实 `gpt-6.1-sol` |
| --- | --- | --- |
| 活跃工具期间连续两次插话、显式文件引用 | 两条独立 accepted 回执，文件 BLUE，原 Run 的一次 CLI Send | 同样通过 |
| 冷恢复同 Session、原生先结束但 Core 尚未收到终态 | 延迟真实原响应，补充成为下一项原生任务；期间 Core Run 保持 running，CLI Send 归原 Run | 同样通过 |
| 上述期间再发送普通消息 | 等原 Run 完成后，普通消息才成为新 Run 并 Send | 同样通过 |
| 续接执行中取消 | 原生 cancel 发出，业务 Run cancelled；不重放，普通新消息恢复同 Session 成功；共享 Gateway 保持原生命周期 | 未另跑 |
| 原生已执行 Send 后丢失补充回执 | 原 Run failed，输入 delivery_unknown，无自动重放 | 未另跑 |
| 明确协议拒绝补充 | 输入 not_accepted 回普通队列，新 Run 正常完成 | 未另跑；拒绝由验收传输层注入 |

最终受控验收 5 个场景、8 个 Core Run（6 成功、1 显式取消、1 预期断线失败）；真实验收 2 个组合场景、
3 个成功 Core Run、12 次主模型请求（共 18 次 Provider 请求，含原生辅助请求）。主 Session 的只读
验收核对均是 3 个 Core Run 对应 4 项已完成原生 admission，证明接续没有被误记为新的 Core Run。
Core 的身份定位不读取原生数据库；上述核对仅用于测试证据。

扩展原 ACP 回执 owner 验证原终态前后两种顺序、多个未决请求、原生已接受但执行失败、明确拒绝、
取消与未知；扩展既有 Delivery owner 验证无配置摘要的 Hermes 资格及 Run/epoch/终态检查。无新增
Rust 测试函数，最小命令见[测试入口](../../development/testing.md#hermes-原生-steer-边界探针)。
首次探针遗漏审批回答，后续探针误用清理方法名；两次测试器问题及两处 Rust fixture 修正在 JSON 中
保留，最终重新验证全部场景。真实 Provider 字节原样转发，凭据只在 relay 内存，不写入公开记录。

插话不等于中断正在运行的工具。只取消/回收自有 ACP，不能以连接退出证明共享 Gateway 的已提交
效果停止。取消输入不重发；普通明确未接受回队列。现有 Diff、压缩观测、逐 Run 用量和 MCP 清空边界不变。

此前 [原生会话定位验收](native-session-acceptance-2026-10-25.json)记录两个真实成员、12 个受控 Run、
两次原生压缩、原 Session 冷恢复、MCP 部分失败/恢复、取消隔离及 Core 强杀不重放。
此前 [真实模型验收](real-model-acceptance-2026-10-25.json)在生产 `37f017b68` 上通过 5 个 Run、
18 次主任务请求：两成员 Send、精确原 Session 冷恢复、目录外真实模型切换、相同模型/模式省略设置，
以及固定 Skills 菜单与显式文件使用。实际使用 `gpt-6.1-sol`、`gpt-5.6-sol`，没有伪造模型工具调用。
初次夹具对 Provider ID 稳定性的错误假设，以及依赖检查误触发日常 bootstrap 准备，均在实施记录中保留。
最新 [custom ID 兼容验收](model-id-compatibility-2026-10-25.json)在 `34dd2e2f9` 上再次完成 5 个真实 Run、
17 次主任务请求：原选择保持完整命名 ID，原 Session 冷恢复与后继轮均零重复设置；真实改选时完整 ID
原样发送，实际请求切到 `gpt-5.6-sol`。不同命名 Provider 的拒绝相等由定向单测覆盖。

## 原生 ACP 观测验证（2026-10-25）

按 User sequence 100，尝试沿当前官方 ACP 接通压缩观测与逐 Run 消耗。生产基线 `376f3c22e`，
官方源码仍为上述未修改的 0.22.4；这次只增加既有 smoke 的 `--observations` 分支与白名单 stdio
记录器，不改生产入口、用户配置、B/P、共享 Gateway 生命周期或其他 Runtime。
结果见[观测证据](acp-observations-2026-10-25.json)。这是生产 Core/CLI + 官方 ACP/Gateway + 本地
受控 Responses 的协议验证，**不是新增一次真实付费模型验收**。

压缩实际完成，但当前官方 ACP 没有实时完成通知。正常两次自动压缩的 native committed telemetry
与摘要请求可互证；ACP 恢复历史出现 `_meta.hermes.compactionSummary`，属于重放内容，不能按出现
次数计新压缩，也不能归入恢复后的 Run。`sessionProvenance.compressionDepth` 表示物理会话链深度，
这次原地压缩仍为 0，不能代替压缩次数。原生日志只用于隔离验收，生产没有新增日志读取。
补充原生客户端显式发送 `clientCapabilities.session.compaction: {}`，再执行一次 `/compress`；
实际新增一次摘要请求并正常返回，但仍没有生命周期事件。最终矩阵共 15 个 Core Run：
12 succeeded、1 cancelled、2 failed（Core 强杀与工具后模型失败），均符合场景预期。
额外维护命令没有创建 Core Run；两次自动压缩与一次手动压缩分别计数。

官方 [Issue #137752](https://github.com/NousResearch/hermes-agent/issues/137752) 与
[PR #137950](https://github.com/NousResearch/hermes-agent/pull/137950) 在本次查询时仍 Open。
[标准 ACP 压缩通知](https://agentclientprotocol.com/rfds/session-compaction)已经定义，但 v1 的
`clientCapabilities.session.compaction: {}` 同时承诺 ID、状态、摘要 patch/chunk 和 replay 语义。
本轮没有为未发送的事件添加只认 completed 的接收器，也没有宣称 Rovai 已实现完整标准通知能力。
现有“不补发规则”是产品选择；“无法实时展示压缩”是当前协议接线缺口，两者分别记录。

消费计数确实存在，但不能用简单映射得到可靠的本 Run 用量：

| 受控场景 | 本轮 Provider 已报告 input / output | ACP 终态 input / output | 含义 |
| --- | --- | --- | --- |
| A6 → A7：保留原生客户端并切换模型 | A7 为 1100 / 20 | A6 为 500 / 50；A7 为 1100 / 20 | 原生 Agent 重建后计数从零开始，不能一律减上一轮 |
| A8：保留另一客户端，再续一轮 | 200 / 20 | 1300 / 40 | 驻留 Agent 没有重建，结果包含 A7，不能直接当本轮 |
| B4：Core 强杀后恢复 | 200 / 20 | 400 / 40 | 可能包含前一未知执行已经产生的计数 |
| B5：一次模型调用与工具成功，下一调用失败 | 100 / 10 | error -32603，无 usage | 失败前已知计数没有穿过官方 ACP 错误响应 |

`usage_update` 只包含 `used` / `size`，没有消费基线、计数代次或逐调用用量。上述返回由官方
[`turn_usage`](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_session_meta.py#L106-L124)
将原生计数投影；[prompt 失败分支](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/acp_adapter/gateway_server.py#L696-L704)
在 usage 返回前抛错。计数是否重置取决于原生 Agent 生命周期，不能从 Core 每轮关闭 ACP 推导。
测试核对 Core 的消费字段保持 null；“未知”不等于没有消耗。没有费用字段就不估算费用。

本轮没有可靠的仅改 Rovai 映射的生产修复；若保持当前边界，需要官方 ACP 提供可归属当前 prompt
的用量（包含失败前已知计数），或具有明确计数代次的完整基线。压缩需要官方实际发送对应事件。
不新增 Gateway 第二通道、隐藏 `/usage` 调用、文本猜测、文件采集或 Hook。

复现命令为 `node scripts/smoke-hermes-native-session.mjs <official-source> <prepared-python> --observations`。
该分支延伸既有矩阵，覆盖两成员、计数保留/重置、失败前 usage 和未知执行，不增加 Rust 测试 owner。
第一轮附加案例的 ModelSelection 测试参数写成字符串，12 个既有 Run 后夹具报错；修正为正式 DTO 后重跑，
不把夹具错误归为 Hermes 缺陷。完整执行次数、补充订阅验证与实际检查记录在上述 JSON。

## 原生问卷识别（2026-10-26）

原生配置启用 `clarify` 时，官方 ACP 会将选择题和开放题都投递成 `session/request_permission`。
本次在既有分类器识别官方 `clarify-*` 卡片，复用共享问卷不支持处理；不再把选择答案或开放题的
唯一 Skip 当作执行审批。已识别但字段损坏的问卷也取消，不回落授权。没有新增表单、修改配置或改变接入方式。

[隔离验收证据](clarify-unsupported-2026-10-26.json)使用生产 `b2d963618`、未修改的官方 0.22.4，
通过既有 smoke 的 `--questionnaires` 分支完成 16 个 Run：11 成功、4 预期失败、1 预期取消。
其中 3 个真实原生问卷均收到精确 `cancelled` 回执，Core 记录 `runtime_questionnaire_unsupported`，
没有问卷 Approval 或自动重试；发送后提问保留已发消息，Core 冷恢复后新任务仍在同一 Session 成功。
发送命令本身的一次正常执行审批照常保留。默认排除 clarify 的行为没有改变。

原生工具在这次验收中报告 `unanswered` / `user_response: null`，其 outcome 是 `timed_out`，
并附带原生超时文案；这不代表实际等待了文案中的 60 分钟，也不是用户选择了 Skip 或提交了答案。
本轮验证的是生产 Core/CLI 与真实官方 ACP/Gateway、本地受控 Responses；没有新增真实付费模型或桌面 UI 验收。

原生 fixture 与官方 `build_clarify_permission` 输出比对一致。既有 Rust owner
`approval_selects_the_exact_native_option_id` 覆盖正常/损坏问卷、普通审批和其他 Adapter 的隔离；
共享终态与免审批 owner 各通过。合流后 workspace 480 项通过、1 项既有忽略，相关 Renderer 199 项通过。
首轮夹具错误拒绝合法命令审批，第二轮四个问卷场景通过但总收尾缺少规则统计字段；修正测试后第三轮全程通过。
两次夹具失败与最终结果均记录在上述证据中，不将失败尝试表述为完整通过。

复现：`node scripts/smoke-hermes-native-session.mjs <official-source> <prepared-python> --questionnaires`。
仅隔离测试配置启用 clarify，用户日常安装、配置和 Gateway 未参与；测试自有进程已退出。

## 交付与执行边界

独立分支 `rovai/hermes-runtime`，PR [#878](https://github.com/murray17/rovai-ai/pull/878)。
生产代码直接替换未上线实验，无旧 Home 导入/回退；日常 App 数据不参与验收。
验收使用同一测试用户 Home 下的原生 `.hermes`、预先启动的共享 Gateway、独立 Core data/Skill Library/MCP，
未补丁官方源码。原生会话定位矩阵的 Provider 是本地受控端点，不能算真实付费模型或平台资格矩阵；
真实模型分支与该矩阵分开记录。

## 官方路径的边界

关闭 ACP 仅关闭连接，不强杀共享 Gateway；原生取消不承诺已经产生的外部效果可撤销。
MCP resume 空列表不是已确认撤销。原生 memory/Skills/system 配置继续生效，共享 Home 不隔离成员记忆。
首次/真实规则更新仍用 user 层；压缩不补发，不保证完整规则永久保留。
逻辑 chat_id 可定位 ACP Session，物理 session_id 可能旋转；跨轮后台 CLI 按调用时 Run 归属。

此前[客户端环境修复](client-env-feasibility-2026-10-24.md)、[中间件研究](middleware-feasibility-2026-10-25.md)
和[原生边界探针](native-acp-boundaries-2026-10-24.md)均为历史探索，不参与当前生产路径。
其旧逐执行身份目标不再是本方案约束；原 [R2 提案](first-input-r2-proposal.md) 的迁移/插件探索被
[已确认 R2](../../versions/v1.72/model-context-change-hermes-first-input.md)替代。

## 与 Command 简化原则及 Checklist 的当前对照（2026-10-25）

按 User sequence 93，读取参考 Thread `rvcamp_01m5pwm8ptf0rarmhgg3ckegm0` 的相关记录，
重点采用 sequence 45/46 的内存直传替换和 48 的收口结论；Command 当前实现已合入本分支基线
`1028095f6`。此次核对 Hermes `34dd2e2f9`，不把参考 Thread 早期已删除的正文文件、恢复前 list
或旧更新时机继续算作 Command 当前行为。对应[Command 收口记录](../../versions/v1.72/command-code-native-simplification.md)。
随后同步主线 `4d8625c94`，保留 Command 的 Windows 进程所有权修复；本表所述 Hermes 接入边界未变。
主线迁移编号整合及合流后回归见[实施记录](../../versions/v1.72/hermes-first-input-implementation.md#主线集成)。
再同步 `3425e7c1e` 的 Command macOS/Windows Preview 开放；Hermes 仍仅 macOS arm64 Preview。
观测验证后同步 `c99db24da` 的 Command Linux Preview；保留主线 D61，未合入的 Hermes 决策引用顺延为 D62–D67。

结论：Hermes 原私有 Home、启动器、第二事件通道、配置解释器、Hook/压缩补发、context.json
投影、配置兼容摘要及逐 Run CLI 安装均已退出生产。当前没有发现需要再次重构的 Hermes
专属锁、池或常驻配置监听。模型 ID 简写造成的重复设置已在上述提交局部修复。

仍有成本的地方应区分用途：

- 每 Run 重建 ACP 客户端、重新 new/resume 和交付 MCP；共享 Gateway 保持原生生命周期。
  相比 Command/Codex 的 warm 复用，确有重复连接成本，但本轮没有耗时数据，不把它升级成 warm 改造。
- user 层首次/更新规则需读取接受账本、比较 B 摘要并保存冻结输入。它用于跨重启不重复首次规则、
  真实变更才更新、未知输入不重发；不是已删除的 Host 配置摘要，也不是 Bootstrap 中转文件。
- CLI 在一次业务请求中解析 Session → Conversation → 活动 Run/lease。它替代逐 Run 环境投递，
  没有第二次握手或新映射表；删除会失去内置 CLI 的准确业务归属。
- 模型 ID、原生终态接受状态和连接清理范围仍有小型适配。每项都对应现有原生协议差异；
  没有重建 Gateway 事件流来证明补充信息齐全。

参考 Thread 提到的“普通文本先取得工具配对锁”仅发生在当前 Cline/Command/MiniMax 的
`enrich_paired_tool_message` 路由，Hermes 不进入该分支。不能把它复制成 Hermes 的新问题。
共享 MCP 投影、输入证据、Fleet、Blob 和进程退出观察仍有普通 I/O/同步成本；不为 Hermes
另造绕过路径，也不把源码存在一次读取等同已测得性能问题。

下表按 [Checklist 的 14 轴](../../development/runtime-integration-checklist.md#2-实现前必须完成-parity-matrix)
对照当前代码，是实现/产品差异清单，不是新增的完整资格验收。

| 能力轴 | Hermes 当前实现 | 与其他接入的具体差异 |
| --- | --- | --- |
| 1. Auth / Provider / Model | 原生默认交原生；菜单缺失不阻止执行；显式模型经 set_model，局部兼容 custom 简写；无额外登录探针 | Codex 按 Turn 配置模型；Command/Cline 的共享显式选模仍使用原生目录验证。Hermes 的菜单与执行门槛已解耦 |
| 2. Host / Fleet / LRU | 共享 Fleet、Native Binding 身份；无 Host/Binding/runtime 配置摘要；每 Run 关闭 ACP | Command 同样不用配置摘要但可 warm；Codex/Cline 等仍有配置摘要。Hermes 当前付出重连成本，不管理共享 Gateway 的 LRU |
| 3. Session / Continuation | 原 ID 直接 resume/load；共享 replay 隔离；失败不自动新建 Session 冒充恢复 | 与一般 ACP 一样直接恢复；当前 Command 也已去掉恢复前 list。Hermes 不使用版本/指纹相等作为 resume 前提 |
| 4. Bootstrap / Context | 首次 B+P、真实规则变化 B 更新+P，其余 P；user 层；接受账本跨重启保持 | Command 用小 Mod 和已有 ACP 控制请求逐轮更新内存中的 System；Codex 用 developerInstructions；Claude 用启动参数文件。Hermes 没有 Mod/ready/正文中转文件，但指令层级较低 |
| 5. Compaction | 原生压缩照常；已验官方 ACP 无实时完成通知；历史摘要标记不是当前事件；Core detector 关闭，无补发或永久保留承诺 | 实时展示缺口与不补发的产品选择分开；Command/System hook 与 Codex/Claude 的原生高权限指令路径不同，同样关闭 detector 不代表保留保证相同 |
| 6. Skills | 用户/当前项目各 .hermes/skills 与 .agents/skills；公共扫描、预览、显式文件引用 | 与 Command 的固定目录发现方向一致；不还原原生启用/信任结果，不列任意 external_dirs。真实读取已验证，文件候选不等于原生启用 |
| 7. External MCP | 共享分配随 ACP new/resume 交付；原生部分发现失败可继续；不改配置 | Command 自定义 cwd 需要包装且有原生优先策略；Hermes 未传自定义 cwd、同名优先级未知，空 resume 列表不能宣称撤销。没有第二次绑定或额外发现 |
| 8. Tool / Action / Output | 直接消费官方 ACP 工具、输出、路径；原生终态决定任务结算 | Codex 有更丰富的结构化 item，Command 可映射部分编辑片段；Hermes 当前无结构化 Diff，缺详情不会反改明确成功的任务 |
| 9. Narration / Final / Missing-Send | ACP 当前请求结果，加共享 Explicit Send/收尾规则；不按自然语言判断成功 | 与其他 ACP 共用产品收尾；没有第二条 Gateway 事件流、receipt 对账或全证据收齐门槛 |
| 10. Permission / Approval / Workspace | 原生文件编辑模式；权限请求经共享审批桥；不把 dont_ask 当作所有命令自动允许 | 不同于 Codex 的 sandbox 或 Command 的 bypass；Hermes 无已接通的 Core read-only 保证，不能从模式成功推导工作区隔离或问卷支持 |
| 11. Built-in CLI | 固定安装入口、实例端点、原生逻辑 Session 一次定位当前 Run；无 context.json | Command/Codex 等主要使用逐 Run context/环境。Hermes 明确采用调用时归属：旧后台程序到下一 Run 才首次调用，会归入下一 Run，不追溯来源执行 |
| 12. Usage / Cache / Cost | Session 上下文观测可用；终态原生计数会累计/重置，失败响应可缺已知 usage；无法可靠归属本 Run 时未知 | Command 消费 result._meta.usage；Codex/Claude 有各自结构化计数。Hermes 已做真实原生协议探针，不是没有检查字段；不取累计总数/盲目差分，也不加采集器补账 |
| 13. Retry / Queue / Cancel / Cleanup | 官方 ACP slash Steer、cancel、共享去重/队列；原生接续仍在原 Core Run 内收尾，只清理自有 ACP | Hermes 接受当前原生轮或紧接下一轮，已知结束不投递；共享 Gateway/已提交工具可能继续，未知不重放。Command 保持现有普通队列；其他 Runtime 按各自原生通道处理 |
| 14. Ready / Version / Platform | 官方 >=0.22.4、正常发现与 ACP 探测；无旧实验快照黑名单；macOS arm64/x64 Preview（Intel 尚未实测） | Command 最低稳定版 1.88、一次 Mod ready，macOS 两架构、Windows x64 与 Linux x64 已开放 Preview；Hermes 无插件 ready，其余平台未获资格。Preview 均不代表全部能力已验收 |

这次没有为比较其他 Runtime 重跑它们的真实模型。实际检查入口为
[ACP](../../../crates/rovai-core/src/acp.rs)、[Hermes 局部适配](../../../crates/rovai-core/src/hermes.rs)、
[规则接受账本](../../../crates/rovai-core/src/context/hermes_rules.rs)、
[能力目录](../../../crates/rovai-core/src/agent_runtime_adapter.rs)、
[Core CLI 解析](../../../crates/rovai-core/src/application.rs)、
[用量映射](../../../crates/rovai-core/src/monitoring.rs)与当前合同。

2026-10-26 补齐原生提问分类与共享不支持处理，见[问卷验收](#原生问卷识别2026-10-26)；
支持的是准确取消和提示，不是让 User 在 Rovai 填写原生问卷，不能用文件审批通过替代问卷验收。
原生记忆、画像、后台能力按用户配置保留，与部分适配器关闭原生自动记忆的策略有差异；共享 Home
不承诺成员长期记忆隔离。完整 Diff、逐 Run 用量、MCP 自定义 cwd/明确撤销和其他终端后端属于
能力缺口，不应包装成“必须再增加封装”的整改理由。

当前 [D67](../../versions/v1.72/decisions.md#v1-72-d67) 和 Hermes 合同明确接受 user 规则、共享 Gateway
及调用时 Run 归属等产品选择；这些优先于 proposed Checklist 的通用默认。通用清单里的高权限
Bootstrap、压缩连续性、全部执行树回收和旧执行来源隔离不能在 Hermes 行勾成已通过。
保持 Preview，不把局部简化和一次真实恢复验收表述为 First-Class 全部闭合。

## 此前实现的能力与证据（历史记录）

| 能力轴 | 官方路径验证 | 保留边界 |
| --- | --- | --- |
| Auth / Provider / Model | 原生配置和目录，命名 endpoint/model ACK，effort 设置进入真实请求 | 仅已测 Sub2API；OAuth refresh 并发矩阵未执行 |
| Host / Fleet / LRU | 独占 Gateway/ACP 树，binding 持久 Home，正常退出和取消回收 | 未跑满 20 Host LRU / 30 分钟 TTL |
| Native Session | 精确 cold resume、缺失 Session 结构化拒绝；正常重启原 ID 不重复规则；unknown 经用户 CLI 精确确认后原 Session 接受新任务 | 不自动重放或换 Session；原任务仍失败/结果未知；见[显式恢复证据](explicit-unknown-recovery-2026-10-23.json)，[此前失败](first-input-core-recovery-2026-10-23.json)保留 |
| Bootstrap / Context | user 层首条、后继、冷恢复、身份更新与接受账本；原生 env/config/personality 各生效一次 | 不提供 system/developer 优先级；不改共享 B/P 文案和 Formatter |
| Compaction | 原生 272000/204000 窗口/阈值，真实模型两次自动压缩与冷恢复请求观察；Core 验证通知→下一输入→ACK | 不承诺同 Run 立即恢复；历史/摘要可能仍含旧规则，补发不清理原生历史；取消压缩矩阵未验收 |
| Skills | 原生 skill_view 实际读取，用户/受信项目索引规则保留 | `.agents` 用户目录需 opt-in；`.env` 独有目录变量的菜单索引不等价 |
| External MCP | 实际 tool_search/describe/call，精确原 Session 增加、改配置、撤销，同名 Rovai 优先，坏服务拒绝 | HTTP/SSE/OAuth 全矩阵未执行；直接 tools 数组不是全部工具 |
| Tool / Action / Output | 原生 raw input/result，成功文件片段和 Core runtimeDiff 入库，失败/空/移动/二进制/大文件边界 | 无完整 before/after 承诺；terminal 任意写入无自动全量 Diff |
| Narration / Final / Missing-Send | 共享 Explicit SendOnly；实际公开 Send 及修正后唯一 marker | 异常恢复全部组合未穷举 |
| Permission / Workspace | 原生 edit policy ACK；命令审批经 ACP/Core 保留；clarify 不出现在模型工具列表 | 无 OS sandbox；read-only 无法保证则拒绝 |
| Built-in CLI | 真 terminal 的 rovai --help / send，冷 Run 更新 lease | 非全部 CLI 操作验收 |
| Usage / Cache / Cost | Session 累计转 prompt delta；cache read 计入 input；真实暖轮、受控数值与 context gauge | 无原生费用/cache write 时保持未知 |
| Queue / Cancel / Cleanup | 真实终端取消；Core SIGKILL/重启清理全部已记录后代，已接受输入不重放，无重复 Send | 完整 LRU/TTL/多会话竞态矩阵未完成 |
| Steer | 原生 queued＋精确 generation ACK，同一 Core Run 接受修正并实际 Send；错轮/迟到拒绝 | 未知运输不重发；不用并发 prompt 排后继轮 |
| Image | 图片 bytes 到达官方 Gateway 原生缓存，未被 controller 改写 | 本次模型识图不通过，不能从 ACP image=true 推定结果质量 |
| Ready / Version / Platform | >=0.22.4、受管 revision/PID、官方能力探测；FirstPayload 与 signal-driven/best-effort，旧 Ready 升级刷新 | macOS arm64 Preview；其余平台 Not Qualified；无 system 保留保证 |

## 此前图片与 Skills 的额外评估（历史记录）

四色 PNG 的原生缓存已目视确认与发送内容一致。默认 auto 模式走 Hermes vision 预解析，错误描述为单色
magenta，主模型据此回答无法分辨四象限。隔离 config 显式设 `agent.image_input_mode: native` 后，主模型
识别出 cyan/magenta/yellow，但将蓝色象限误判为 white。因此图片运输成立，当前 Provider/模型组合的
识图准确性未通过；保留独立严格图像断言，不把失败改成通过。产品配置继续尊重原生模式，不全局强制 native。

原生 `.env` 的 Skills 路径变量可进入运行时 dotenv 环境；Rust 菜单索引目前仅展开启动环境变量，不能从
这次运行时调整推定菜单完全等价。直接路径、`~`、启动环境变量、create/external、信任和禁用规则已有 owner
覆盖；真实 skill_view 证明实际加载。用户 `~/.agents/skills` 需显式 external_dirs，项目 `.agents` 需受信最近 Git 根。


## 复现与验收归属

当前入口为 `node scripts/smoke-hermes-native-session.mjs <official-source> <prepared-python>`。
使用一次性完整用户 Home，实际官方 ACP/Gateway 与同包 Core/CLI，记录原生逻辑标识、模型请求和发送归属。
不连接日常用户 Gateway，不用修改上游或逐 Run wrapper 帮助成功。

显式授权真实模型后可追加 `--real-model <second-model-id>`，使用当前原生配置的 Responses Provider。
真实分支复用 Core 启动与用户命令入口；测试 relay 原样转发模型响应，测试 stdio observer 仅记录
方法与模型/模式等元数据。它们不参与生产运行，不向模型提供 CLI 包装路径。具体隔离、记录与边界见
[测试入口](../../development/testing.md#hermes-首次输入与历史证据)。

旧 controller Python fixture 和私有 Home 的 wire/native/experience/first-input/core/failed-usage/auto-compression
脚本随对应生产路径退役；Git 与已有 JSON/研究文档保留历史证据。旧官方入口对照脚本仍是历史探针。

## Rust 测试归属

扩展现有 Hermes 入口、Adapter Ready、上下文接受账本、compaction policy、lease registry、CLI 断线与
ManagedProcess 取消 owners：初始/真实更新、旧 pending 停止消费、字段/身份、一次派发、根进程清理。
删除 host.py 的 Python tests 与私有维护 CLI tests，因为对应产品功能本轮删除；不删除数据库迁移或历史读取测试。
不新增等价测试 fixture、表、锁或恢复框架。

最小命令：`cargo test --workspace`；`cargo test -p rovai-core --features slow-tests,extended-tests --lib hermes`。
原生真实身份与两个成员调用的跨模块语义由上面的隔离 smoke 拥有，不能仅靠纯函数证明。

## 来源

- [官方 ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/)
- [原生终端 Session 环境](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/tools/environments/local.py)
- [原生压缩调用方上下文](https://github.com/NousResearch/hermes-agent/blob/4d04303818b61bf3aa09278af48356315515965b/agent/compression_facade.py)
