---
document_type: implementation-plan
version: v1.28
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-26
---

# v1.28 实施计划

本计划把 [Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)应用到 Grok Build；
Checklist 仍拥有完整通用步骤，本页只记录本版本的具体状态和证据入口。

## 接入步骤

- [x] 阅读 Grok Build Research、Runtime checklist、当前 Runtime Architecture/Contracts、Kimi/Cursor/TRAE
  研究与本地开发工作流；
- [x] 在 `codex/grok-build-runtime` 独立 worktree 中建立 `grok-build` identity、命令发现、权限 descriptor、
  platform admission 与 Runtime Activity mapping；
- [x] 支持官方 `$GROK_HOME/config.toml` custom-model schema 与 mode-0600 `.env` 引用密钥，正式 Host 继承原生 Grok Home；
- [x] 完成 ACP initialize/auth/session、动态模型目录、标准 `session/set_model`、权限、generic ACP agent-text、vendor metadata 路由与
  Missing-Send 边界；
- [x] 完成 Migration 107 catalog 与 Migration 108 compaction closed sets，Data Contract v1.22/schema 63、
  Skill group、Desktop catalog、logo provenance 与 scripts closed set；
- [x] 完成 Rust、TypeScript、Renderer、Migration、文档和 asset 自动化检查；
- [x] 完成 Fleet LRU warm Host/同 Session 复用；初始 `0.2.118` 的 exact `session/load` HistoryRestore、replay
  quarantine 与错误 ID fallback 作为历史验收保留；
- [x] 完成真实 Deep Probe、两轮 AgentRun、命令/权限、cancel、Built-in CLI、Skill、Missing-Send，并将
  ACP Session MCP 的负向结果收敛到已实测的 process `--plugin-dir`，通过 native preservation、同名 skip、
  不同名追加、ContextManifest 与真实 Tool call；
- [x] 把 Runtime、HistoryRestore 与 External MCP 通过结果写回 macOS arm64 adapter-scoped evidence；最终 digest 随
  自动化门禁冻结；
- [x] 验证 BYOK；实现 cached-token 非交互 auth 分支与原生 Home 保留。当前机器未登录 Grok，account-auth
  端到端保持 `Unverified`，不阻断已声明的 BYOK 资格；
- [x] 取得 [model-context revision 2](model-context-change-grok-native-rules.md) 二次确认；保持 Bootstrap bytes
  不变，把新 Grok Session 改为 `session/new._meta.rules` native append，禁止 `systemPromptOverride`，并以
  compatibility revision fence 旧 `first_payload` Binding；
- [x] 准入 exact structured `auto_compact_completed` + event ID，启用 Grok `best_effort` observer；真实 debug-arm
  产品两轮证明 next-input Redelivery revision 1 accepted 且 ACK 收敛；
- [x] 将三个宿主平台的 Grok 最低版本合同统一为 `>= 1.0.0`；light/Deep/Ready 均 fail closed，Deep/Ready
  要求 `sessionCapabilities.resume` 且真实调用同一 ID 成功；Grok continuation 改用标准 ACP `session/resume`，
  Resume 固定使用空 `additionalDirectories`，并移除 load-only fallback；
  `session/new._meta.rules` 与 creation-only / resume 不重注入语义保持不变；
- [x] macOS arm64 使用 `grok 1.0.5` 完成真实 Deep Probe、cold resume、AgentRun、Built-in CLI/attachment、
  External MCP 与 Skill smoke，并更新 adapter-scoped v2 evidence；
- [x] Windows x64 客户端以 `grok 1.0.5` + BYOK 完成同等目标主机验收，并新增独立 digest-bound evidence；
- [x] Windows x64 BYOK Camp 验收发现 Core 已成功持久化终态但 Renderer 未消费 `agent_run.terminal`；补齐通用
  Camp invalidation、Camp ID 过滤、single-flight + trailing refresh，以及事件 → `camps.open` → `succeeded`
  页面投影链路回归，macOS/Windows 和全部 Runtime 共用修复；
- [x] macOS x64 使用原生 x86_64 `grok 1.0.5` 完成同等目标主机矩阵，并更新独立的 adapter-scoped v1 evidence；
- [x] 以重启前后仅 `st_dev` 漂移的回归输入修复 macOS Runtime Files 启动失败；root/Entry identity 改用稳定
  volume UUID，schema-1 marker 在已准入私有实例根内原子 rekey，旧物理 receipt 由受控 rebuild 收敛；
- [x] 以历史 `message_attachment` 保留但 Authority 目录缺失的真实输入修复 startup 全局退出；只有已完整
  rollback、`integrity_failed` 且没有 active/nonterminal operation 的 Camp-local rebuild failure 可被隔离，
  先按 D08 让受影响 Camp 拒绝 Runtime、其他 Camp 与 Core 正常启动；该临时边界随后由下方 D10 附件局部降级取代；
- [x] 修复零附件 Camp 在 root rekey 后的空集 controlled rebuild：只为 controlled rebuild 接受零 Entry completion，
  同一 View 提交写回当前 root identity、空 catalog receipt 并推进 physical generation；
- [x] 把已成功 resolved 附件的后置 Authority/digest 故障收窄为附件局部 `recovery_required`：startup 与
  pre-dispatch reconciliation 省略异常项、重建健康 catalog 并保持 Camp `ready`；新 Context 不投影 stale path，
  exact Authority 恢复后自动复活，unresolved writer intent 与 root/containment 安全错误继续 fail closed；
- [x] 把同一 Run 内最大连续 Tool 收成 Renderer-only 摘要，保留 chronology 与 identity，活动态显示最后一条
  非终态操作和已结算总数，终态不追加结果文字；组内有成功即使用绿色状态、仅全部失败使用红色；精确 Tool
  首次展开前不挂载完整结果，并覆盖失败、停止、仅记录、双主题、Inspector 与换位性能；
- [x] 补齐 Windows Runtime rescan 的 HKCU/HKLM PATH hydration、Codex installer known location、
  `.exe/.cmd/.bat` closed discovery、npm/pnpm native target resolution、受控 command-shim launch/identity、
  resolved locator evidence 持久化与 snapshot/Host fencing、PATH 传播、Job cleanup 与 Windows 回归；`.ps1`
  保持关闭；
- [x] 运行 Impeccable detector，整理 worktree 交接，并通过 PR 交付 `main`。

## Command output 持久化优化

- [x] 逐项核验 13 个 Adapter：仅 Codex 产生 `command.output.delta`；十个 ACP Adapter、Claude Code 与
  Antigravity 都已有完整 terminal semantic output，当前无需 spool；
- [x] 对未来 Codex delta 保留 Host/Run/epoch/Thread/Turn/route/Run-state fence 后直接丢弃，停止 Evidence、
  Canonical、Managed Blob 与 Renderer live-state 写入；历史 Evidence/Blob 保持原样；
- [x] 保留 terminal Command 的 command/status/exitCode/aggregatedOutput，大输出继续进入精确 Tool 的 Managed Blob；
- [x] 将 Runtime interruption 投影为 terminal/unsettled + `runtime_interrupted`，Renderer 显示
  stopped/interrupted，不伪造 cancelled；
- [x] 覆盖 100,000 delta 零 DB/Renderer 项、cancel/terminal/Host/epoch/route fence、terminal aggregate/blob、
  interruption 与 PR #63 Tool chronology/grouping/lazy disclosure 回归。

## 验收原则

- 任一真实模型、权限、Tool、Session、进程清理或数据迁移门禁失败时，对应平台不得保持 `qualified`；
- API Key、完整 Native ID、原始 Prompt 与本机绝对私有路径不得进入证据；
- Usage/Cost 不因任一平台结果自动启用；三个宿主平台只凭自身独立证据晋升，不互相继承资格。
