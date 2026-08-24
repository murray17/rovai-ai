---
document_type: implementation-plan
version: v1.28
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-24
---

# v1.28 Pi Coding Agent Runtime 实施验收计划

本计划逐节对应当前
[Agent Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，不把上游候选能力
冒充产品实现。

## 0. 现有行为对齐硬门

- [x] 正式 Host 与 Claude/Kimi 一样继承通用 `HOME`；Pi-specific config 必须隔离以禁止自动 Extension，已由
  V1.28-D01 和 Runtime Launch v26 明确例外；Probe 使用独立临时 config/session root；
- [x] continuation 使用公共顺序：compatible warm Host/Session → cold exact native resume → new Session；
  Pi 不使用 fuzzy recent Session 或 replay History Restore；
- [x] provider secret 复用本机 Claude settings 来源但不复制 key；MCP、Skill、权限与 Built-in 按 Pi 实测重新
  定界，没有从 ACP、Claude stream-json 或第三方 Extension 猜测；
- [x] Product permission default 为唯一 `approval_mode=managed`；Settings、成员选择与平台可见性继续由
  Admission 决定。

## 1. 接入记录

- [x] Runtime=`Pi Coding Agent`，wire `AdapterKind=pi`，上游版本 `0.84.2`，协议 `pi-jsonl-rpc-v1`；
- [x] executable `/opt/homebrew/bin/pi` 的 canonical identity/fingerprint、Claude 本机 MiniMax
  Anthropic-compatible model/provider 和 safe compatibility fingerprint 已记录；
- [x] 目标平台逐项记录：macOS arm64 qualified；macOS x64/Windows x64 qualification evidence missing；
- [x] 已知限制明确：无原生 sandbox/permission、External MCP Unsupported、Usage/Compaction Disabled、
  首版一 Host 一 Session。

## 2. 发现、检查与启动

- [x] 定义 command/display/env override/常见路径；`pi --version` 有界 light discovery 不发模型请求；
- [x] Discovery、behavioral Probe 与 AgentRun 使用不同 launch purpose；path/fingerprint/schema drift 使旧
  Ready 与 Host compatibility 失效；
- [x] Claude settings loader 校验普通文件、owner、`0600`、exact keys、HTTPS/no credentials；token 只进入
  child env，不进 argv、DB、Evidence、diagnostics 或 Git；
- [x] 私有 `PI_CODING_AGENT_DIR` 写 env-ref `models.json`；自动 Extension/Skill/Context/Prompt Template/Theme
  与上游 auto-approve 均关闭，只显式加载 managed Extension/Skill；`PI_TELEMETRY=0`；
- [x] stdout/stderr/config/session root 有界、私有且可清理；normal/error/cancel/probe timeout/App shutdown 的
  ManagedProcess tree cleanup 已覆盖；
- [x] Host compatibility 绑定 executable、protocol、provider schema、Extension、cwd/access、permission、
  model、Skill exposure、Builtin lease 与 attachment generation；per-Prompt delivery/execution epoch 单独 fencing。

## 3. 协议、事件与 Command Output

- [x] strict LF JSONL reader 覆盖 split read、oversize、EOF 与 `U+2028/U+2029`；banner/log 不能进入 stdout；
- [x] request ID response 只表示 accepted；`toolCallId` 提供唯一 started→terminal，update 按 cumulative result
  处理，重复/partial event 不创建重复 Action；
- [x] 固定 Bash marker 进入公开 Action output；empty/nonzero、敏感 Extension envelope 与 provider secret 的
  正负边界由 fixture/真实 smoke 覆盖；
- [x] Runtime Activity descriptor/registry 使用 `fine_grained`，只从结构化 event 分类，不从正文补猜。

## 4. Session Continuation 与 Resume

- [x] Fleet LRU 使用 per-member 20/global 200/idle 30m/sweep 60s；Pi 首版一 Host 一 Native Session；
- [x] first Session 保存 full UUID 与 canonical file；warm Host 只在 compatibility 全等、healthy、quiescent 时
  复用；
- [x] cold Host 只用 exact `--session <file>`，随后核对 full UUID/file/provider/model；禁止 partial ID、最近
  Session、目录扫描、`--continue` 和 replay History Restore；
- [x] Core restart 后新 Host 保持 Native Session identity；host instance、binding generation、execution epoch
  与 Built-in lease 分别轮换/fence；resume 失败只记录 continuity lost 并至多新建一次 Session。

## 5. 权限、Approval 与 MCP

- [x] 受管 Extension 在 Session start/before-agent handshake；`bash/write/edit` blocking Approval，unknown
  mutating Tool、Extension error、timeout 与 restart fail closed；read/search 不弹 Approval，且诚实记录 Pi
  本身没有 sandbox；
- [x] allow-once 绑定 exact toolCallId/action digest；deny/no-side-effect、durable Action terminal、output privacy
  与 recovery fixture 通过；
- [x] External MCP 声明 `Unsupported`，不接收 Assignment projection、不写用户配置；第三方 Extension 不晋升；
- [x] bundled `rovai` CLI 经 managed Bash、当前十五项 catalog/help 和 per-Run lease 验证，不冒充 MCP。

## 6. Narration、Final、Missing-Send 与错误

- [x] narration/final 只使用 authoritative completed assistant message；thinking、stderr、Extension UI 和历史
  Session 内容保持私有；
- [x] `agent_settled` 是唯一成功 terminal 与 `pi_agent_settled` Missing-Send boundary；response、
  `agent_end`、process exit 不代替；
- [x] zero-send publication、accepted-send suppression 通过；cancel/error 不发布成功 candidate；
- [x] provider/auth、protocol/compatibility、environment、cancel 与 cleanup 错误按稳定 code 分类，公开 detail
  经过脱敏和有界化。

## 7. Usage、Token、Cache 与 Cost

- [x] 上游 message/session usage 候选已记录，但 Session cumulative totals 不能证明当前 Run attribution；
- [x] 首版 `usageEligibility=0`、Usage/Token/Cache/Cost Disabled，不从文本、context ratio 或 provider/model
  名称推断；这不是基础准入阻断。

## 8. Compaction 信号

- [x] 上游 compaction start/end 候选已记录，但 occurrence/dedupe、abort/retry 与 cold resume 重放尚无完整
  产品矩阵；
- [x] `CompactionDetectorPolicy::Disabled`，不从文本、token drop 或 Session history 推断，不阻断基础准入。

## 9. 必过真实 Smoke

- [x] `pnpm smoke:pi-runtime`：first、warm reuse、Core restart/cold exact resume、allow/deny、cancel、秘密隔离、
  Skill/MCP capability 边界通过；
- [x] `ROVAI_SKILL_SMOKE_ADAPTERS=pi pnpm smoke:skills`：`.pi/skills` private marker、CLI help、restart 和
  projection lifecycle 通过；
- [x] `ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=pi pnpm smoke:missing-send-recovery`：zero-send 与 accepted-send
  suppression 通过；
- [x] `ROVAI_BUILTIN_CLI_ADAPTERS=pi pnpm smoke:builtin-cli`：十五项 operation、三输入、Gather、conflict、
  initial/resumed lease fence、successor read 与 logical/native continuation 通过；
- [x] macOS arm64 qualification 证据完成；macOS x64/Windows x64 未运行且保持 not qualified。

## 10. 自动化与证据

- [x] Adapter/Health/Migration/Platform/Activity/LF/Approval/provider privacy 的 Rust tests 已建立；历史 Migration
  fixture 排除未来 Pi group，Migration 107 保留 custom Skill 权限边界；
- [x] Renderer 目录、参数、Onboarding、Sidebar、Camp、Monitoring 与 523 个 Vitest 通过；官方 Pi logo、asset
  notice、TypeScript typecheck 和一次 Impeccable detector `[]` 通过；
- [x] Rust fmt、Clippy 与全量 Core tests 最终通过；
- [x] docs test/check/CI、compatibility digest 与敏感信息门禁最终通过。

## 11. 硬性阻断条件

- [x] macOS arm64 的 secret isolation、managed Approval handshake/deny、reliable final、cancel/cleanup、exact
  resume、Built-in CLI 与 Skill 均已闭合，因此该行可 qualified；
- [x] External MCP、Usage/Compaction 未满足声明门槛，分别保持 Unsupported/Disabled，不伪造 capability；
- [x] macOS x64 与 Windows x64 缺少独立完整矩阵，保持
  `runtime_platform.qualification_evidence_missing`，不因共享代码或 arm64 成功自动准入。

## 12. 最终汇报要求

- [x] 汇报包括 Worktree/Branch/Base/Governance、实现范围、真实版本/model/provider 安全边界与全部验证命令；
- [x] 对比说明 Pi 与 ACP、Codex app-server、Claude stream-json、Antigravity one-shot 在 LRU、MCP、Skills、
  resume、身份保持、Approval/final、Usage/Compaction 与平台准入上的区别；
- [x] 事实分为已确认、基于代码/证据的推断与仍未知；不输出 key、原始 provider URL、Prompt、Session UUID、
  locator 或日常用户数据。
