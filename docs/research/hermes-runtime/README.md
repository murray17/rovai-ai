---
document_type: research-note
authority: non-normative
last_updated: 2026-10-24
---

# Hermes 接入与验证

User sequence 46 提出的原生 Home／共享 Gateway 切换尚未实施。
[2026-10-24 边界实测](native-acp-boundaries-2026-10-24.md) 已确认原生取消／连接退出行为，
同时复现 ACP 环境未传到工具进程、内置 CLI Send 失败；[R2 完整提案](first-input-r2-proposal.md)
待二次确认。下面的生产状态与既有资格证据仍属于此前私有 Home 实现，不用于证明新方案完整协作可用。

`rovai/hermes-runtime` 已切换到**未修改的官方 ACP＋专用官方 Gateway**。macOS arm64 仍为 Preview，
兼容策略为 **>=0.22.4**，没有 commit、dirty 或上界 fence。实际验证安装是 0.22.4，source commit
`4d04303818b61bf3aa09278af48356315515965b`。规范见 [Hermes Managed Runtime v1](../../contracts/hermes-managed-runtime-v1.md)，
当前简化取舍见 [V1.72-D63](../../versions/v1.72/decisions.md#v1-72-d63)。最低版本策略不代表所有新版/平台取得资格。
当前直接 ACP 的验证见[最新实施记录](../../versions/v1.72/hermes-first-input-implementation.md#官方-acp-直连简化2026-10-24)。
[此前脱敏证据](official-production-evidence.json) 属于删除代理前的实现，不用其中的 Diff/usage/reasoning 结果证明新路径。

## 交付与执行边界

本机采用官方 source distribution，入口 `~/.local/bin/hermes`。早期 Brew 0.22.2 已解除链接并保留供回退；
没有安装 Hermes Desktop，也没有连接日常共享 Gateway。独立 worktree 为 `../rovai-ai-hermes-runtime`，
PR 为 [#878](https://github.com/murray17/rovai-ai/pull/878)，交付前合入主线并保留双方版本记录。
当前分支尚未合入 main 或安装到 Rovai 日常 App。Migration 214 / schema 164 扩展 Runtime/Skill 闭集；
215 / schema 165 增加 Hermes nullable 输入证据。后续 user 层投递变更与本页既有系统层验收分开记录，
见[首次输入实施验证](../../versions/v1.72/hermes-first-input-implementation.md)。

验收使用隔离 dataDirectory、project、Skill Library、MCP 文件、Hermes Home 与 Built-in lease；不访问
日常 Electron userData。真实模型按 User 授权使用 Hermes 自身的 Sub2API / gpt-6.1-sol 配置。
Adapter 不借用其他 Runtime 凭据；临时凭据与原始 wire 不进入仓库或交付证据。

## 官方路径的边界

共享 ACP 客户端直接连接官方 ACP；启动器只准备 binding 私有 Home 和专用 Gateway，并运行原生入口。
逐 Run 冷启动、Fleet 树回收和原 Session 冷恢复保留。删除普通消息代理、第二条工具事件流、逐轮 replay/
receipt 门禁、storage flock、原生配置摘要和 reasoning 内部 API。Gateway 启动仍验证实际进程归属。

FirstPayload 与官方 post_compaction 通知后的下一普通输入补发保持不变，原生 system/personality/env
继续由 Hermes 解析。原生模型和权限设置直接用 ACP，MCP 撤销、Steer 和 unknown 处理才按需调用公开 RPC。
官方明确成功不以补充详情为前提；工具内容按原生字段显示，完整 Diff、参数、prompt 用量缺失则为未知。
已有证据可读，删除旧私有文件证据的生产与准入分支。旧路径的数值账单和受管 effort 不再作为当前能力宣称。
原始配置只在受管改写位置兼容 null，不加载完整默认配置。新 Session 不重复绑定 MCP；冷恢复用一次
快照准备一次分配，部分发现失败通过既有诊断告警后继续。RPC 异常或撤销未确认仍报错；下表旧方案的
“坏服务拒绝”不再代表当前部分发现行为。

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

## 图片与 Skills 的额外评估

四色 PNG 的原生缓存已目视确认与发送内容一致。默认 auto 模式走 Hermes vision 预解析，错误描述为单色
magenta，主模型据此回答无法分辨四象限。隔离 config 显式设 `agent.image_input_mode: native` 后，主模型
识别出 cyan/magenta/yellow，但将蓝色象限误判为 white。因此图片运输成立，当前 Provider/模型组合的
识图准确性未通过；保留独立严格图像断言，不把失败改成通过。产品配置继续尊重原生模式，不全局强制 native。

原生 `.env` 的 Skills 路径变量可进入运行时 dotenv 环境；Rust 菜单索引目前仅展开启动环境变量，不能从
这次运行时调整推定菜单完全等价。直接路径、`~`、启动环境变量、create/external、信任和禁用规则已有 owner
覆盖；真实 skill_view 证明实际加载。用户 `~/.agents/skills` 需显式 external_dirs，项目 `.agents` 需受信最近 Git 根。

## 复现与验收归属

- `test-hermes-controller.py`：启动器直接交出 ACP 管道；仅测现存的原生状态/MCP、Steer generation、unknown 精确确认与 Home 保留。旧双通道对账和 Diff 解析测试随职责删除。
- `smoke-hermes-wire.mjs`：官方执行器＋loopback Responses，验证 user 层规则、原生终态、无额外模型调用，以及 env/config/personality 的原生优先级。
- `smoke-hermes-experience.mjs`：官方原生工具真实修改文件，稀疏通知不影响成功；原生 reasoning 配置、问卷排除、Steer、取消、不同 Binding 并发、MCP 增改撤销/同名/失败。
- `smoke-hermes-failed-usage.mjs`：生产 Core＋官方执行器，第一轮有用量和工具、第二轮失败；Run 保持 failed、无自动重放，不把缺失的 prompt delta 或 Session 总数记为消费。
- `smoke-hermes-first-input.mjs`：生产 Core、实际原生请求与接受账本；普通后继/冷恢复/规则更新。`--compression --unprotected` 验证两次完成 Hook 后下一输入补发；`--availability` 验证入口/安装/指纹/Home 漂移、强杀不重放、明确处理 unknown 后同 Session 新任务。
- `smoke-hermes-native.mjs` / `smoke-hermes-core.mjs` / `smoke-hermes-auto-compression.mjs`：可选真实模型验证。已移除旧私有接口和增强 Diff 强制断言；此次未重跑真实付费模型，不将旧路径的通过计为新路径通过。
- `smoke-hermes-official-acp.mjs`：历史官方入口对照 Probe。

以上脚本位于 `scripts/`。native/Core/压缩脚本要求 `ROVAI_HERMES_BIN` 和专用已配置的
`ROVAI_HERMES_SMOKE_HOME`，不发现或复制密钥。受控脚本使用 dummy key；可用
`ROVAI_HERMES_DEPENDENCY_HOME` 复用选中安装的已准备依赖，不让 fixture 隐式安装。

旧路径的 Renderer 验证保留为 UI 证据：effort 保存、原生错误详情、用户/项目 Skill 区分，以及首条输入 ACK
修复后同一 Run Steer。切换未改这些共享 UI，不将旧路径的私有 executor 或完整文件快照结果迁移为新路径证据。

## Rust 测试归属

当前只保留 launcher/原生错误识别的独立纯函数 owner。删除
`hermes::tests::native_patch_requires_a_successful_corroborated_complete_hunk`，因为其唯一拥有的
私有文件解析职责已退役，不再承诺同一行为；不是为通过测试而关闭现行合同。runtime_diff 原 owner
改验旧私有 dialect 不再准入，既有证据投影合同保留；monitoring 稀疏 owner 改验 Session 总数及失败缺失
不会被记为本 prompt 消耗。目录/Ready、恢复和 Fleet 继续扩展现有 owner，不增加平行数据库 fixture。

最低验证：`python3 scripts/test-hermes-controller.py`、`cargo test -p rovai-core --lib hermes::tests`、
`cargo test -p rovai-core --features extended-tests --lib runtime_parsers_emit_sparse_usage_without_antigravity_inference`。
普通 workspace 回归与最新 smoke 结果见[当前实施记录](../../versions/v1.72/hermes-first-input-implementation.md#官方-acp-直连简化2026-10-24)。

以下为简化前的历史验证，不能替代当前实现验证：

本轮最终 wire fixture `rovai-hermes-wire-dsIDWL` 的三个 overlay 与 B 各出现一次；体验 fixture
`rovai-hermes-experience-gUPMcr` 的两个普通 Update、SQL 注释删除和既有 MCP/Steer 矩阵通过。
失败用量 fixture `rovai-hermes-failed-usage-F6FEla` 验证 Run failed，输入 100、输出 10、cache read 40、
reasoning 2 仅入账一次，费用/cache write 未知。账本异步投影完成后核对持久值，不把 Run 终态出现当作
账本队列已落盘。连续冷启动同时暴露原生 daemon storm 退避；专用外部 supervisor 关闭该退避后全组通过。

官方生产路径最终 Core fixture `rovai-hermes-core-dISqud`：首轮同 Run Steer 成功，第二轮实际终端取消，
第三轮终端运行中 SIGKILL 隔离 Core，重启后 Run 失败收敛且未自动增加 Run。第四轮显式输入恢复同一
native Session，读取先前文件并用更新 lease 成功 Send；两次公开 marker 各一条，受管后代全部退出。
原生 MCP/Skill/冷恢复最终 smoke 通过；体验 fixture `rovai-hermes-experience-zKX52V` 包含新增服务、
修改凭据、撤销、同名优先与坏服务显式拒绝，全部通过。图片资格失败独立记录于上节。

## 来源

合入前补修的普通 Rust、受控升级/恢复与真实模型强杀结果见
[实施验证](../../versions/v1.72/hermes-first-input-implementation.md#合入前补修与显式恢复)和
[脱敏摘要](explicit-unknown-recovery-2026-10-23.json)。恢复入口只走 User Automation 的固定操作，
不会将 Agent 的普通聊天输入当作未知执行确认，也不创建隐式业务 Run。

原会话优先、安装与指纹变化、绑定并发和原生状态分离的后续收口见
[可用性实施记录](../../versions/v1.72/hermes-first-input-implementation.md#原会话优先与可用性收口2026-10-24)与
[v6 受控证据](availability-recovery-2026-10-24.json)。该批运行使用同一官方 0.22.4 和受控 Responses，
不替代前述真实模型或压缩证据。

- [官方 ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)与[Gateway local sessions](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-local-sessions)。
- [官方配置](https://hermes-agent.nousresearch.com/docs/user-guide/configuration)与[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)。
- [本次安装源码](https://github.com/NousResearch/hermes-agent/tree/4d04303818b61bf3aa09278af48356315515965b)：acp_adapter/gateway_server.py、gateway/session_local_mcp.py、agent/image_routing.py、gateway/run_inbound.py。
- Logo 来源仍为同 commit 的 website/static/img/apple-touch-icon.png，仅作 Runtime 产品标识。
