---
document_type: version-overview
version: v1.27
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-23
---

# Rovai-ai v1.27：Kimi Code + MiniMax M3 本地 Runtime 接入

> 当前状态：Kimi Code `0.32.0` 已作为第十二种 Product Runtime identity 接入，并在 macOS arm64 上使用
> MiniMax 国内 Token Plan、`MiniMax-M3` 与 OpenAI-compatible endpoint 完成基础 ACP、真实 Approval、
> command-output、Missing-Send、cancel 与进程清理验收。修正 Built-in CLI fixture 的过期退出码断言后，
> 完整资格矩阵通过十五项 operation 并产生 56 条 full-run evidence；macOS arm64 已晋升为 `qualified`，
> macOS x64 与 Windows x64 仍未准入。
>
> 前置版本：[v1.26 Cursor Agent Catalog 接入](../v1.26/README.md)已按冻结时事实转为 historical。

## 版本目标

依据 [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，让 Kimi Code 使用
Rovai 私有、最小权限的 provider 配置运行 MiniMax M3，而不改写用户原有 `~/.kimi` 配置，也不把密钥写入
数据库、仓库、日志或公开 Runtime Evidence。

## 交付范围

- 新增 `AdapterKind = kimi-code-cli`、`SkillDeliveryGroupKey = kimi` 与 Migration 105；Migration 106 扩展
  Compaction policy、Observer 与 Requirement closed kinds，当前 Data Contract 为
  `v1.20 / projection schema 61`；
- 发现 `kimi`，以 `kimi acp` 启动 ACP v1；正式 AgentRun 继承用户原生 Kimi Home，正常完成的兼容 Run 复用
  warm Host/Session，Host 被停止或淘汰后由后继 Host 在同一原生 Home 中精确恢复；显式 Deep Probe 仍使用
  一次性临时 Home；
- 从 `~/.config/rovai/kimi-code.env`（或 `ROVAI_KIMI_CONFIG`）读取严格 allowlist 的六个
  `KIMI_MODEL_*` 字段；Unix 上拒绝 group/other 可访问文件；
- 支持 `default`、`plan`、`auto`、`yolo` 权限模式；新队员 Product default 为原生最高权限 `yolo`，已有
  保存值不自动扩权，Core read-only 强制 `plan`；最高 Runtime 权限不绕过 Rovai 自有安全边界；
- 不强制关闭 Kimi/MiniMax thinking；`KIMI_MODEL_CAPABILITIES=thinking` 只作为能力声明。
  `<think>...</think>` 推理块不进入公开消息，完整闭合块被剥离，未闭合块 fail closed；
- Kimi Skill 投影到 `.kimi-code/skills`；External MCP 通过标准 ACP Session `mcpServers` 以
  `AdditivePerRun / RovaiWins` 启用，stdio、Streamable HTTP 与真实模型 Tool call 已通过；warm Host/Session
  reuse 已启用；Run-local MCP projection/evidence digest 不参与 Host compatibility，完整 Server 定义仍参与。
  Usage/Cost 保持 Disabled。Compaction 通过 Kimi-only Prompt lifecycle correlation 与 idle/detached exact
  completion frame 以 `best_effort` 启用，不安装 Hook 或修改用户配置。capability snapshot 保留真实
  `session.resume/load`，
  Host 停止或淘汰后由新 Host 优先精确 resume，load 只作 replay-quarantined fallback；
- macOS arm64 声明 Built-in transport 并进入普通 discovery、检查、成员配置和执行路径；macOS x64 与
  Windows x64 仍保持准入阻断，不从 arm64 证据外推。

## 明确边界

- ACP Client `fs/write_text_file` 没有匹配的一次性授权时由 Core 拒绝；写文件验收使用会产生结构化
  permission request 的 Shell 路径；
- `.kimi-code/skills` 的真实发现、唯一 marker 调用和 canonical `--to-principal` 教学通过；Kimi 已进入
  `smoke:skills all`；`--to-user` 仅是隐藏兼容 alias，不是当前 canonical 教学；
- allow 与 deny 均已通过真实 Approval roundtrip；deny 的目标 Tool 为 `not_executed` 且没有文件副作用；
- stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 Tool Evidence 已通过；empty 场景中模型未给
  final 时 AgentRun 正确 fail closed，Tool terminal 仍可审计；
- 早期 Built-in CLI `0/15` 来自 fixture 把 legacy stdin 非法输入退出码错误地期待为 `1`；Kimi 实际执行了
  Shell，并在第一项 canonical operation 前被断言终止。修正为当前 CLI 合同的退出码 `2` 后，十五项
  operation、三种输入、Gather、conflict、lease fence、exact successor read 与 logical/native continuation
  全部通过，Kimi 声明 built-in transport capability 并进入默认矩阵；
- 原始 ACP Probe 中，同 Host 多 Session 无串话；新进程复用同一 `KIMI_CODE_HOME` 的 exact resume/load 保持
  Session ID 和上下文，而新隔离 Home 对旧 ID 返回 `Unknown sessionId`。产品正式 AgentRun 不覆盖
  `HOME` / `KIMI_CODE_HOME`，继承用户原生状态根：正常完成后兼容 Run 复用同一 warm Host/Session；显式停止后
  后继新 Host 精确 resume；load 仅作为带 quarantine 的 fallback。v22 旧私有 Home 不自动迁移或删除；
- 产品级 External MCP smoke 经 Core、Assignment、AgentRun Projection、ContextManifest 与真实模型 Tool call
  同时验证 stdio、Streamable HTTP 和 `RovaiWins` 同名整项优先；未写 Runtime 用户级配置；
- 真实用户原生 Home smoke 定位并修复 Kimi Run-local MCP projection digest 误入 Host compatibility：同一完整
  Server 集合的连续 Run 现在复用同一 Host/Session，Server 定义变化仍通过完整结构改变 compatibility digest；
- Kimi 异步 command/config advertisement 只作为私有 metadata 安全路由。当前产品不消费该 catalog，因此
  不再把“缺少权威 async catalog snapshot”列为遗留问题；
- Kimi `0.32.0` 与官方 `main` 把内部 compact lifecycle 降格为同形 `agent_message_chunk`。Active Prompt 使用
  Kimi-only exact state correlation：started 建立 pending，blocked 保持 pending，completed 产生 observation 并
  清除，cancelled 只清除；这些 frame 不进入 final 或 Missing-Send。PromptCompleted/Ready/detached warm Host
  保留 exact 四行 completion detector；宽泛关键词和 token-drop 不参与。确定性 Host 回归已覆盖
  started→blocked→completed、单次 observation 与公开文本隔离；真实自动/手动完整 Core smoke 尚未执行；
- macOS x64 与 Windows x64 没有从 arm64 结论外推资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.26 冻结为 historical；本概览、计划、决定和版本索引建立唯一 current v1.27。 |
| Decisions | 已更新 | [V1.27-D04](decisions.md#v1-27-d04)保留 warm Host reuse、External MCP 与 async catalog 边界；[V1.27-D05](decisions.md#v1-27-d05)记录初始 idle ACP completion frame；[V1.27-D06](decisions.md#v1-27-d06)把正式 AgentRun 切回用户原生 Home并保留 Probe 临时隔离；[V1.27-D07](decisions.md#v1-27-d07)补齐 Active Prompt lifecycle correlation 与 blocked pending 语义。 |
| Contracts | 已更新 | [Runtime Launch and Verification v25](../../contracts/runtime-launch-and-verification-v25.md)继承用户原生 Home、Probe 隔离、warm/cold continuation、Kimi External MCP 与十二种 Runtime 原生最高权限默认，并冻结 Cursor 在 Settings 与普通成员 Runtime selector 中的隐藏边界。 |
| User Automation | 已更新 | [User Automation v1](../../contracts/user-automation-v1.md)补齐 `runtime check/models` 与成员 create/runtime set/clear 的封闭 App CLI；所有写入复用既有 Core Domain Command、显式版本 fence 与幂等 command ID，不开放 generic invoke。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十二种 identity；[Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)记录 Kimi completion frame detector 与无 Hook 边界。 |
| UI | 已更新 | Settings Agent Runtime 目录继续展示已接入 Kimi，并隐藏尚未走通、未准入的 Cursor；现有布局与状态语义不变。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Kimi ACP `run_level` baseline 与真实 Shell Evidence。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 `0.32.0`、MiniMax M3、用户原生 Home、Probe 隔离、warm/cold continuation、External MCP、Built-in 15/15、Kimi Compaction detector 与平台边界。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航路由到 Runtime Launch v25、本版本与 Kimi Research。 |
| Root README | 已更新 | 常青能力更新为十二种 Product Runtime identity。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v25](../../contracts/runtime-launch-and-verification-v25.md)
- [Kimi Code Runtime Research](../../research/kimi-code-runtime-research.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
