---
document_type: implementation-plan
version: v1.28
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-25
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
- [x] 完成 Fleet LRU warm Host/同 Session 复用，以及 Core/Host 重启后的 exact `session/load` HistoryRestore、
  replay quarantine、恢复后 Tool/Approval/cancel 和错误 ID fresh fallback；
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
- [x] 以重启前后仅 `st_dev` 漂移的回归输入修复 macOS Runtime Files 启动失败；root/Entry identity 改用稳定
  volume UUID，schema-1 marker 在已准入私有实例根内原子 rekey，旧物理 receipt 由受控 rebuild 收敛；
- [x] 运行 Impeccable detector，整理 worktree 交接，并通过 PR 交付 `main`。

## 验收原则

- 任一真实模型、权限、Tool、Session、进程清理或数据迁移门禁失败时，macOS arm64 不得保持 `qualified`；
- API Key、完整 Native ID、原始 Prompt 与本机绝对私有路径不得进入证据；
- Usage/Cost、macOS x64 与 Windows x64 均不因本版本的 arm64 结果自动启用。
