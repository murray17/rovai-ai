---
document_type: version-overview
version: v1.28
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-08-24
---

# Rovai-ai v1.28：Pi Coding Agent Runtime 接入

> 当前状态：Pi Coding Agent `0.84.2` 已作为第十三种 Product Runtime 接入。macOS arm64 使用本机
> Claude Code 的 MiniMax Anthropic-compatible 配置完成 JSONL RPC、受管 Approval、真实 Tool、cancel、
> warm Host、Core restart 后 cold exact resume、Missing-Send、managed Skill 与十五项 Built-in CLI 验收；
> External MCP 明确 Unsupported，Usage/Cost 与 Compaction 首版 Disabled。macOS x64 与 Windows x64 没有
> 独立资格证据，保持 not qualified。
>
> 前置版本：[v1.27 Kimi Code + MiniMax M3 本地 Runtime 接入](../v1.27/README.md)已按冻结时事实转为
> historical。

## 版本目标

依据 [Pi Runtime Research](../../research/pi-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，使用 Pi 官方 JSONL RPC
直接接入，而不是 TUI 抓屏或第三方 ACP shim。Provider 使用与 Claude Code 相同的本机 MiniMax key 来源，
但秘密只进入 Pi 子进程；Pi 缺少原生 sandbox/permission 的差异由 Rovai 受管 Extension fail closed 补齐。

## 交付范围

- 新增 `AdapterKind=pi`、`SkillDeliveryGroupKey=pi`、Runtime Activity descriptor、Renderer 目录与官方 Pi
  logo；Migration 107 扩展所有 Runtime/Skill closed kinds，Data Contract 升级为 `v1.21 / schema 62`；
- 发现 `pi` 并使用独立 `pi-jsonl-rpc-v1` Host；严格 LF framing、request correlation、稳定
  `toolCallId`、`message_end.message` 和 `agent_settled` final boundary 全部进入 typed reducer；
- 只从权限收窄的 `~/.claude/settings.json` 读取 exact MiniMax 三字段；正式 Host 继承通用 `HOME`，使用
  Rovai 私有 `PI_CODING_AGENT_DIR`、env-ref `models.json` 和 child-only token，禁止自动用户/项目 Extension；
- 受管 TypeScript Approval Extension 对 `bash/write/edit` 建立 blocking durable Approval；read/search 类
  Tool 不弹 Approval，沿用进程 OS 用户与既有 Workspace/attachment 边界；未知 mutating Tool、握手失败、
  timeout 与 restart 均阻断；Pi 本身不提供 sandbox；
- 使用公共 Fleet LRU：per-member 20、global 200、idle 30 分钟、sweep 60 秒；首版一 Host 一 Session，
  compatible warm reuse 后才是 exact `--session <canonical file>` cold resume，禁止最近会话和 fuzzy scan；
- `.pi/skills` 作为受管 Skill group，Session 启动时以 exact `--skill` 投递，exposure digest 参与
  compatibility；Built-in `rovai` CLI 通过受管 Bash Tool 与 per-Run lease 工作；
- External MCP 为 Unsupported；Usage/Cost、Compaction 与 Pi advertised command catalog 没有进入首版产品
  consumer。Missing-Send 使用 `pi_agent_settled` 并已通过 zero-send、accepted-send suppression；
- macOS arm64 使用 digest-bound evidence qualified；macOS x64、Windows x64 保持 qualification evidence
  missing，不从 arm64 外推。

## 真实验收

项目级 `smoke:pi-runtime` 在隔离 Core data-dir 和 Git workspace 中完成：

- first Prompt 返回固定结果，写入私有 marker 后不把 marker 公开；兼容后继 Run 复用同一 Host/Session；
- Core restart 后新 Host 用持久 exact Session file 恢复同一 Native Session UUID；删除源 marker 后仍能只从
  Session 记忆返回 marker，证明不是文件重读或 portable history 伪恢复；
- allow-once 写入成功，deny 目标文件不存在；cancel 终止延迟写入，等待窗口后仍无文件；
- 公共 trace、Runtime state、Evidence 与 host log 不包含 Claude 配置名、token 或私有 Session 内容；
- `.pi/skills` 返回私有 marker，并在 Core restart 后保持 managed projection 与 Runtime discovery；
- Missing-Send 的 zero-send 与 accepted-send suppression 均通过；
- Built-in CLI 当前十五项 operation、三种输入、Gather、conflict、initial/resumed lease fencing、successor
  exact read、logical/native continuation 全部通过。

## 明确边界

- Pi 不是 ACP Runtime；Pi RPC response 只证明 prompt accepted，`agent_settled` 才是成功 terminal；
- Pi 没有原生 sandbox 或 permission mode catalog；`approval_mode=managed` 是唯一产品值，不允许把 Extension
  关闭或把 read-only narrowing 解释为 Runtime 自有权限；
- 正式 Host 覆盖 `PI_CODING_AGENT_DIR` 是阻止不受管 Extension、固定 provider overlay 与 Session locator 的
  Version Decision 例外；它不覆盖通用 `HOME`，不复制 Claude/Pi 用户配置，也不把 Probe Home 带入 AgentRun；
- cold resume 保存 canonical Session file 与 full UUID，恢复后还核对 provider/model；locator 只在 Core
  私有 binding 中存在。失败时记录 continuity lost 并至多建立一个新 Session，不做 history replay；
- Skill 在 Session start 扫描，未证明 live refresh；exposure 变化必须轮换 Session/Host compatibility；
- 上游有 MCP Extension、Usage 与 Compaction 候选并不等于当前产品已验证。External MCP Unsupported；Usage
  与 Compaction Disabled，Session cumulative totals、文本或 token 差值不参与推断；
- 当前只准入 macOS arm64。Windows 依赖 Bash 与 Job Object，macOS x64 也需要独立完整矩阵。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.27 概览与决定冻结为 historical；本概览、计划、决定和版本索引建立唯一 current v1.28。 |
| Decisions | 已更新 | [V1.28-D01](decisions.md#v1-28-d01)记录 Pi 独立 JSONL RPC、Claude 本机 MiniMax provider overlay、受管审批、warm/exact resume 与首版保守能力边界；当前决定导航同步。 |
| Contracts | 已更新 | [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)冻结 Pi identity、launch、Ready、Approval、final、LRU、Session、Skill/MCP 与平台语义，v25 转为历史。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)扩展为十三种 Product Runtime，并增加 Pi 独立 Transport、provider、Session 和能力边界。 |
| UI | 已更新 | Settings、Onboarding、成员参数、侧栏、Camp 与 Monitoring 使用既有视觉系统展示 Pi，Cursor 隐藏和平台 Admission 过滤不变。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 Pi JSONL RPC `fine_grained` descriptor、Tool identity 与真实 smoke 证据；维护指南更新十三种计数。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 `pi 0.84.2`、本机 Claude MiniMax provider、Approval、warm/cold continuation、Skill、Missing-Send、Built-in CLI 与 macOS arm64 准入。 |
| Documentation routing | 已更新 | 文档导航、Checklist、合同索引和当前决定导航路由到 Runtime Launch v26、本版本与 Pi Research。 |
| Root README | 已更新 | 常青 Runtime 表加入 Pi，并诚实标注 External MCP 不支持、managed Skill 与 native exact resume。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v26](../../contracts/runtime-launch-and-verification-v26.md)
- [Pi Runtime Research](../../research/pi-runtime-research.md)
- [Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
