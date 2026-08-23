---
document_type: implementation-plan
version: v1.27
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-23
---

# v1.27 Kimi Code + MiniMax M3 实施验收计划

## 1. Research、provider 与秘密边界

- [x] 复核 Kimi provider 配置和 MiniMax Token Plan 官方文档，并与本机 `kimi 0.32.0` 行为区分；
- [x] 建立权限 `0600` 的外部 env 配置，只允许六个 `KIMI_MODEL_*` 键，不回显 token，且不强制关闭
  Kimi/MiniMax thinking；
- [x] 验证国内 MiniMax endpoint 接受该 Plan token，国际 endpoint 拒绝，固定国内 endpoint；
- [x] 保持用户 `~/.kimi/config.toml` 不变。

## 2. Product Runtime 与数据合同

- [x] 扩展 Rust/TypeScript Adapter closed set、Skill group、discovery、health、monitoring 与 shutdown；
- [x] Migration 105 扩展 Runtime closed kinds 和系统 Skill assignment；Migration 106 扩展 Compaction policy、
  Observer 与 Requirement closed kinds，升级 Data Contract v1.20 / schema 61；
- [x] 正式 Kimi Host 继承用户原生 Home，Deep Probe 使用一次性临时 Home；严格 provider 环境、兼容 warm
  Host/Session reuse 和跨新 Host exact continuation 保持不变；含 AgentRun identity 的 MCP projection/evidence
  digest 不进入 Host compatibility，完整 Server 定义仍进入；
- [x] 复核十二种 Product Runtime 的 Core-owned permission default matrix；Kimi 新队员默认由 `default`
  修正为原生最高权限 `yolo`，已有成员不自动扩权，read-only effective mode 仍为 `plan`；
- [x] Renderer catalog、成员参数、Onboarding、侧栏、监控和官方来源图标覆盖 Kimi。
- [x] First-run Desktop 状态升级到 schema 2 并兼容读取 schema 1；零可用 Runtime 或扫描无可靠结果时展示
  统一空结果页，`runtime_deferred` 在 provisioning 前无产品副作用地结束训练，正常配置路径保持原 saga。

## 3. ACP、安全与真实验收

- [x] 真实 initialize、session/new、MiniMax M3 prompt 与 `end_turn` 通过；
- [x] 真实 Shell allow-once、pending→in_progress→completed、固定 command output 通过；
- [x] 真实 `session/cancel` 在有界时间内返回 cancelled，未留下目标进程；
- [x] `<think>` 块不会进入公开输出，未闭合推理 fail closed；
- [x] External MCP 通过标准 ACP Session 字段进入 Kimi capability snapshot；Usage/Cost 保持 Disabled；
  Compaction 通过 Kimi-only Prompt lifecycle correlation 与 idle/detached exact completion frame 以
  `best_effort` 接入；真实 `session.resume/load` 与 Built-in transport 保留；
- [x] ACP Client 文件写入无授权时 fail closed；危险写入无 Tool/Approval/文件副作用时如实记录 Runtime 预拒绝。
- [x] 真实 writable Kimi smoke 直接读取 Core `memberRuntimeDefaults` 得到 `permission_mode=yolo`，固定 Prompt、
  Shell command 和文件写入均完成且没有交互式 Approval；资格用 `permission_mode=default` 的 allow/deny
  矩阵继续独立覆盖审批边界；
- [x] 真实 deny Approval roundtrip 返回 `rovai_approval_denied`，目标 Tool `not_executed` 且没有文件副作用；
- [x] stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 command Evidence 通过；
- [x] Missing-Send zero-send、accepted-send suppression 与 ACP tool→final 三场景通过；
- [x] 原始 ACP 同 Host 多 Session 隔离、同 Home exact resume/load、跨隔离 Home 失败边界通过；产品级回归
  证明正常完成后复用同一 Host/Session 且不调用 resume/load，并证明显式停止后不同 Host 在继承相同用户
  `KIMI_CODE_HOME`/unset 状态时执行 exact `session/resume`、Session ID 不变；
- [x] External MCP 经真实 Core、Assignment、AgentRun Projection、ContextManifest 与模型 Tool call 验证
  stdio、Streamable HTTP、`RovaiWins` 同名整项优先和完整定义投递；真实 Core smoke 证明连续兼容 Run 在
  Run-local projection digest 变化时仍复用同一 Kimi Host/Session；
- [x] 异步 command/config advertisement 保持私有安全路由；当前产品不消费该 catalog，不列为遗留项；
- [x] 复核 Kimi `0.32.0` 安装包、官方 `main` 与 E2E：内部 `compaction.completed` 会确定性转为一个固定四行
  `agent_message_chunk`；Rovai 严格 parser、idle/detached warm-Host route、policy/admission 与普通文本负向
  Rust 验证通过；
- [x] Active Prompt 的 exact Kimi lifecycle 状态机与 Host 级回归通过：started 建立 pending，blocked 保持，
  completed 产生一次 observation 并清除，cancelled 清除且不 observation；lifecycle frame 不进入公开 stream、
  Runtime final 或 Missing-Send，普通 compact 文本不误消费；
- [ ] 在隔离真实 Core 链路分别触发手动 `/compact` 与自动 compact，确认各产生一次 authoritative observation，
  且不触发 ACP protocol violation；
- [x] 完整十五项 Built-in CLI matrix 通过。早期 `0/15` 是验收脚本把 legacy stdin 非法输入退出码错误期待
  为 `1`，Kimi 实际在第一项 operation 前因断言停止；修正为当前契约退出码 `2` 后，十五项 operation、
  56 条 full-run evidence、三种输入、Gather、conflict、lease fencing 与 logical/native continuation 全部通过。

## 4. 最终门禁

- [x] Rust fmt/check、Kimi 配置/ACP/Health/Migration/Platform Admission 回归通过；
- [x] TypeScript typecheck、Renderer 定向测试、Impeccable detector 与 legal asset gate 通过；
- [x] Onboarding 定向测试覆盖 schema v1→v2、deferred 落盘、provisioning fence、零可用结果面和正常 Runtime
  选择面；本地 `file://` 原型因 Browser 安全策略未直接渲染，已用隔离 packaged App 的真实扫描失败分支完成
  `1040×700` Day/Night、安装说明展开、无横向溢出、deferred 落盘与重启不再进入训练营的专项验收；
- [x] docs test/check、benchmark contract 与敏感信息扫描通过；
- [x] 使用持久私有 provider 配置重新运行项目级真实 Kimi smoke，并核对正式 AgentRun 继承用户原生 Home、
  Probe 临时隔离、配置权限与进程清理。
- [x] 审计 Windows 历史证据并在当前树对 Claude Code `2.1.86` + MiniMax M3 1M 定向重跑 Session continuation、
  structured Bash 与 cancellation/descendant cleanup；将同版本 Built-in、Approval、final boundary 与 packaged
  planned-shutdown 证据冻结为独立 digest-bound Windows revision，只晋升 `claude-code-cli`。
- [x] 修复 Windows titlebar overlay 的未缩放 `env(titlebar-area-width)` 在 200% zoom 下撑大根 grid；packaged
  planned-shutdown 的 1040×700 Day/Night 与 200% zoom 对话框、文档尺寸、自然退出和恢复矩阵通过。

Kimi 验收不包含 macOS x64、Windows x64 的平台资格，也没有开启 Usage/Cost；Claude Code 的 Windows x64
资格使用独立 Adapter 证据，不改变 Kimi 或其他 Runtime 的平台状态。Kimi Compaction compatibility
detector 已进入代码和定向 Rust 验证，真实自动/手动完整 Core smoke 仍待执行。warm Host、External MCP 与
native resume 已进入产品，History Restore 只在 load-only 时作为既有 quarantine fallback。
十五项 Built-in CLI matrix 已在 macOS arm64 完整通过，该平台已准入；其他平台仍需独立完成同等级证据。
