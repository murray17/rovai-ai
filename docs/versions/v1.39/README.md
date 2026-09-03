---
document_type: version-overview
version: v1.39
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-03
---

# Rovai-ai v1.39：Pi Runtime 安全重接入

前置：[v1.38](../v1.38/README.md)。本版本基于
`main@aae13734669c363e7b307a6407e6868eda1e6b8e` 重新接入 Pi Coding Agent；旧 Pi 分支只作为协议与负向
边界参考，没有 merge、rebase 或 cherry-pick。实现使用独立 `pi-jsonl-rpc-v1` Adapter，不把 Pi 伪装成 ACP。

## 范围与当前状态

- Product Runtime closed set、Migration 135、Core optional subsystem、Fleet、Desktop 配置、模型目录、Skill group、
  MCP projection、Activity、Usage 与 smoke 已加入 Pi；旧 Runtime、渠道、附件存储/发布、membership、取消和
  planned shutdown 分支保持原样。
- 当前版本另收敛 Renderer 附件展示：用户消息按图片/文件/正文分区，Agent 按正文/图片/文件分区；Runtime 图片
  并入来源 Agent 消息，Agent 文件使用十类主题 token。该项不改变附件数据、Open wire、读取授权或渠道发布。
- Pi executable 不存在时只有 `runtime.pi` optional subsystem degraded；Core、Skills、MCP 与其他 Runtime 继续启动。
  安装存在性不替代独立的 version、Machine Ready、capability 与 platform admission。
- 正式 AgentRun 继承 Pi 官方 `PI_CODING_AGENT_DIR`/原生默认配置；Core 不读取 Claude Home、不建立 Pi 私有
  provider 真源，也不把 secret 写入 argv、SQLite、Prompt、Evidence、diagnostics 或公开事件。
- Host 策略为 workspace/process-compatible 的 `resident_multi_session`：同一 Host 串行服务多个 Session，并发 Run
  获取不同 Host；Pi 的复用 identity 是 canonical workspace + process digest，当前独占 lease 的 Camp/member 则单独
  保留用于删除失效，其他 Runtime 的 Camp/member 复用语义不变。动态 Session/model/Bootstrap/Skill/MCP 不进入 process
  digest；只有 healthy、quiescent 且无 pending command/tool/MCP/lease 的 Host 才进入统一 LRU。
- Native Session 只用完整 Session ID 与 Core 私有 canonical session file 精确恢复。Availability Probe 在临时
  `--session-dir` 中用 private `--session` seed 创建、切换、验证并清理空测试 Session，不发送 Prompt、不调用模型，
  也不污染用户 Pi 历史；Prompt/final、receipt、Approval、Tool/MCP 与 Usage 只由显式 smoke 验证。
- Bootstrap 通过官方 extension `before_agent_start` 进入高权限 system prompt；每轮由不可变 managed-input receipt
  证明 exact binding、Bootstrap、Skills、MCP、Tool 集与 session digest，并与 input acceptance 原子提交。
- Pi 没有内建 MCP，但官方 extension Tool API 足以建立 Core-owned bridge；因此 External MCP 是
  `AdditivePerRun / RovaiWins / CoreManaged`，支持 stdio 与 Streamable HTTP，不写 Pi 全局配置。stdio 接受 bare、
  cwd-relative 与 absolute command，每次按当轮 Runtime PATH/cwd 解析；单个用户外部 Server 激活失败只让该 Server
  unavailable，不阻断 Pi Session 或 AgentRun。
- Pi 结构化 assistant `message_end.message.usage` 进入当前稀疏 Usage；只记可证明的 model-call delta，未知 reasoning
  与无法归因的 cost 保持 `NULL`。
- macOS arm64、macOS x64、Windows x64 都没有 Pi 专属 immutable qualification artifact，Admission 均为
  `preview / runtime_platform.qualification_evidence_missing / evidenceRevision=null`。三平台开放普通 discovery、检查、
  成员选择和 AgentRun 供主动测试，UI 明确标记实验性；这不把本机 smoke 或其他平台能力改写为正式资格。
- 执行台、Inspector 与局域网只读执行台的活动 Tool 组优先展示已有公开证据中的具体当前指令；稳定 Tool 行标题、
  渠道卡片和 Activity 分类不变，文件路径与 Web query 继续遵守 typed/Canonical Evidence 边界。
- Camp 消息中的完整 inline-code 文件候选只有在同一来源工作目录可解析为现存普通文件时才成为链接；共享资源类型
  定义统一候选已知类型、会话图标和普通文件 Tab 图标，但不改变 Main 既有 Preview／系统打开 classifier。
- 通用设置的世界地图对不存在偏好文件的新 profile 默认关闭；schema v4 已保存值保持权威，schema v1–v3 仍迁移为
  开启，不在升级时覆盖既有用户的有效行为。关闭后的时间线回退与地图入口隐藏语义不变。

## 已接受的差异与未关闭证据

- Pi 原生没有 sandbox 或 permission popup；所有 mutation 由 managed extension 在执行前阻塞，并交给 Core Durable
  Approval。Shell Action 保存 Pi 实际解析出的 shell path、args 与 command transport，不伪造成 `/bin/zsh -lc`。
- Pi system prompt 独立于 Session message compaction，策略固定为 `native_system_prompt_preserved`；Pi 不加入
  Bootstrap redelivery requirement 或 compaction observer lease closed set。
- Images、结构化 Web Search 与 Camp Fast 没有可靠 Pi 0.84.4 evidence，保持明确 unsupported/hidden；不从正文、
  path、MCP 名或普通 query 猜测。
- 当前 macOS arm64 + Pi 0.84.4 + MiniMax M3 已取得 first run、cold exact resume、warm Host reuse、allow/deny、
  cancel、Action output、结构化 Usage、真实 Skill 调用、stdio/HTTP MCP、三类 Missing-Send 与 Built-in CLI 15-operation
  smoke；本机又完成 A→B→A、跨 Camp workspace Host 复用、真实并发 Host、六类 shell output、Skill
  update/disable/re-enable/unassign/delete、MCP update/disable/unassign/delete/deny/cancel/no-leak，以及 Core planned
  shutdown 的完整子进程回收。完整 compaction、idle eviction、packaged App shutdown、故障注入、安全 workspace
  边界及另外两个平台仍需各自真实验收，所以本版尚不宣称 Pi 为任一 shipped platform 的 First-Class Runtime。

## 数据合同

Migration 135 只接受 `Data Contract v1.44 / Projection Schema 85`，原子升级到
`Data Contract v1.45 / Projection Schema 86`。它从当前 v1.44 DDL 扩展五个 closed set，新增
`runtime_input_delivery_pi_binding_unique`、禁止直接改删且允许父 Delivery cascade 的
`pi_managed_input_receipt` 及三类 guard；失败整体回滚，提交后执行 `foreign_key_check`，重开数据库不会重复应用。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.38 冻结为 historical；本概览、实施计划、确认说明和版本索引建立唯一 current v1.39 |
| Decisions | 已更新 | [v1.39 决定](decisions.md)记录独立 JSONL Host、私有 exact resume、managed receipt、MCP bridge、portable child command、逐 Server optional 降级、消息文件存在性与视觉类型分离，以及 Pi 三平台可运行 Preview；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Launch and Verification v31](../../contracts/runtime-launch-and-verification-v31.md)保留 Pi wire/安全合同并开放三平台实验性执行；[Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)拥有 portable application 的逐 launch Runtime PATH/cwd 解析；[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)拥有 Preview 准入语义；[Run Process Detail Surface v30](../../contracts/run-process-detail-surface-v30.md)拥有活动 Tool 组的具体当前指令；[File Preview v4](../../contracts/file-preview-v4.md)拥有消息文件存在性探测 wire；[Runtime Images v4](../../contracts/runtime-images-v4.md)拥有作者感知图片分区与几何 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)和[基础不变量](../../architecture/foundational-invariants.md)加入 Pi 的独立 transport、Fleet、隐私、managed input 与 bridge 边界；[File Preview](../../architecture/file-preview.md)拥有消息引用准入与既有 classifier 边界；[Runtime 图片](../../architecture/runtime-images.md)同步消息内来源合并与两种 Gallery variant |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)补充活动 Tool 组的具体当前指令、稳定 Tool 行、渠道边界和世界地图首次默认，定义 Composer、用户消息与 Agent 交付的附件分区；[Camp 文件预览区](../../ui/components/file-preview.md)拥有真实文件链接和共享图标语义；[Porcelain Day](../../ui/themes/porcelain-day.md)和[Steel Night](../../ui/themes/steel-night.md)加入十类 Agent artifact token；Pi 在既有 Runtime、成员与 onboarding 表面标记“实验性开放” |
| Runtime Activity | 已更新 | [Activity Registry](../../runtime-activity/registry.md)与维护指南加入 Pi verified tool lifecycle 映射，未知 shape 继续 fail closed；当前指令只改共享 presentation，不增加分类映射 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 Pi 0.84.4 本机证据、三平台实验性 Preview 与剩余 Golden Flow |
| Documentation routing | 已更新 | [文档导航](../../README.md)、Contract/Architecture 索引和当前决定导航指向 Runtime Launch v31、Platform Admission v2、File Preview v4、Runtime Images v4、Pi research 与 parity matrix |
| Root README | 已更新 | Supported Runtime 表增加 Pi，并明确标记 experimental preview，避免暗示 First-Class qualification |

## References

- [实施与验收](implementation-plan.md)
- [模型上下文变更 revision 1](model-context-change-pi-managed-system-prompt.md)
- [Parity Matrix](../../research/pi-runtime-reintegration-parity-matrix.md)
- [Runtime Launch and Verification v31](../../contracts/runtime-launch-and-verification-v31.md)
- [Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)
- [Run Process Detail Surface v30](../../contracts/run-process-detail-surface-v30.md)
- [File Preview v4](../../contracts/file-preview-v4.md)
- [Runtime Images v4](../../contracts/runtime-images-v4.md)
- [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md)
