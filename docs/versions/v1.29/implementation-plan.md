---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-25
---

# v1.29 Pi resident Runtime revision 1 实施验收计划

本计划逐节对应当前
[Agent Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)和已确认的
[model-context-change revision 1](model-context-change.md)。只勾选实际实现或执行过的路径；Disabled/Unsupported
能力不以“上游存在”冒充产品资格。

## 0. 治理与版本轴

- [x] revision 1 已由 Murray Xue 于 `2026-08-25T10:34:14+08:00` 二次确认；
- [x] Runtime Launch 当前合同升级为 v27；v26 保持冻结历史；
- [x] 保留主线 Runtime entrypoint locator identity Migration 109，在其后新增 Pi Migration 110/111，最终
  Data Contract 升级为 `v1.24 / schema 65 / migration 111`；
- [x] Bootstrap v3/Formatter 3、Context Formatter 21、ContextManifest 21 与 Delivery Profile 4 bytes 不变；
  新增 Bootstrap Evidence v2、`managed_system_prompt` 和 Pi Managed Input Receipt v1。

## 1. 原生认证、模型与启动

- [x] 正式 Host 不读取 Claude settings、不创建 MiniMax overlay、不设置 `PI_CODING_AGENT_DIR` 或 child-only
  token；认证、model catalog 与 default 使用用户原生 `~/.pi/agent`；
- [x] 启动参数删除固定 `--provider/--model/--append-system-prompt/--skill/--tools`，以
  `--no-builtin-tools` + 唯一 `rovai-pi-host-v2` 进入动态门禁；
- [x] `pi://runtime-default` 不写原生设置；显式 `pi://model?...` 通过 list/set/state 精确校验，并记录 Pi 会
  更新全局默认的已确认副作用；
- [x] executable/version/fingerprint/protocol/Extension digest 漂移使 Ready 与 resident compatibility 失效；
- [x] 本机 Pi `0.84.2` 原生默认模型完成真实 managed-input Prompt；未读取或输出认证秘密。

## 2. Resident Host 与 LRU

- [x] Pi Host compatibility 收敛为 exact workspace/execution root + executable/version/fingerprint + protocol/
  qualification + `rovai-pi-host-v2` + platform/process permission；
- [x] Camp、member、Session、identity、Bootstrap、Skills、MCP、model、thinking、attachment、Builtin lease 与 Run
  从 Pi Host key 移出；
- [x] 同 Workspace 串行复用 resident Host；并发 Run 使用不同 Host，跨 Workspace不复用；
- [x] member/camp invalidation 不淘汰 workspace resident Pi Host；进程级 drift 或 poison 仍淘汰；
- [x] cleanup 先 fence Approval/MCP/Builtin lease、验证 Session file，再清空 binding；任何失败不回 LRU；
- [x] Claude Code/Antigravity 保持 one-shot，不进入 resident Fleet；该差异已写入 Contract/说明。

## 3. Session continuation、resume 与身份

- [x] 每 Run 都发布递增 binding generation，然后 exact `switch_session(<canonical file>)` 或 `new_session`；
- [x] prompt 前核对 full Session UUID、canonical file、cwd、provider/model/thinking；
- [x] new Session 允许 Pi 延迟创建 Session file，但成功 release 必须核对 materialized header/full UUID/cwd；
- [x] cold resume 禁止 partial ID、`--continue`、recent/fuzzy scan 和 portable history replay；失败记录 controlled
  continuity loss并 fail closed，不在同一输入中降级新 Session；
- [x] Bootstrap Evidence v2 冻结 full Member Identity/full Bootstrap；profile edit 不热更同 Binding，新 Binding
  才读取新身份；identity 不进入 Host key。

## 4. Managed Bootstrap 与输入接受

- [x] `rovai-pi-host-v2` 的 `before_agent_start` 只构造
  `effectiveSystemPrompt = event.systemPrompt + "\n\n" + frozen Bootstrap`；
- [x] Dynamic Context 仍是 Formatter 21 exact `prompt.message`；Bootstrap 不变成普通 message/Tool output；
- [x] 私有 binding file 使用 `0700/0600`、create-new temp、fsync、atomic rename；版本、owner/mode、digest、
  workspace、Run/epoch/Binding/Session/generation mismatch 全部 fail closed；
- [x] blocking Managed Input Receipt v1 覆盖 base/final prompt digest、Bootstrap、Skills、active Tools、MCP 和
  binding digest；Core commit 后 Extension 才返回；
- [x] Pi Runtime request digest schema 2 绑定 receipt digest；没有 receipt 的 prompt response 不能进入 accepted；
- [x] Pi 不创建 `ROVAI_BOOTSTRAP_REDELIVERY` overlay 或 compaction redelivery Requirement。

## 5. Skills

- [x] `resources_discover` 每次 Session activation 只返回 exact `W/.pi/skills`；home/ancestor/Package/第三方
  Extension discovery 继续关闭；
- [x] 目录同时接纳 Workspace 项目原生 Pi Skills 与 Rovai Reconciler ready Skills；
- [x] `get_commands` + receipt 验证 expected Skill once-only、name、description digest、entry path、canonical
  target 与 Workspace containment；duplicate/collision/escape/missing fail closed；
- [x] A→B→A Session replacement 重建 ResourceLoader，Skill 变化不要求重启 Host，且不保留上一 Session catalog。

## 6. External MCP 与 Approval

- [x] capability 改为 `AdditivePerRun / RovaiWins / CoreManaged / stdio=true / streamable_http=false`；
- [x] Core-owned bridge 完成 stdio spawn、initialize、initialized、分页 tools/list、schema/description validation、
  stable runtimeName 和 tools/call；
- [x] Extension 每 Session 注册当前 MCP proxy Tools，并以七个 native Tools + bytewise MCP names 激活；相邻
  Session 不保留旧 proxy；
- [x] 每次 MCP call（含 readOnlyHint）都形成 durable `mcp_tool` Approval；allow-once 重新核对所有 generation/
  projection/tool/argument digest，deny/timeout/restart/cancel/late response 不调用 Server；
- [x] Text/Image/Resource 有界归一；Audio、未知 content、非法 base64 与超限返回 bounded error；Server secret、
  stderr 和 bridge envelope 不进入模型或公开 Activity；
- [x] 真实 Pi `0.84.2` 已经由 Core bridge 调用两个 assigned stdio Tool，并逐次完成 durable Approval；
  Streamable HTTP exposure 保持 adapter unsupported。

## 7. Final、cleanup、Usage 与 Compaction

- [x] prompt response 只表示 accepted；`message_end.message` 是权威 assistant snapshot；`agent_settled` 是唯一
  success terminal/Missing-Send boundary；
- [x] abort、error、Extension/MCP/cleanup failure、unknown request 与 planned shutdown 都通过 Host process-tree
  Stop fence，失败 Host 不回 LRU；
- [x] Usage/Token/Cache/Cost 保持 Disabled，不从 Session totals、文本或 token 差值推断；
- [x] Compaction 保持 Disabled/unqualified；代码只保证 protected instruction layer 与 no-redelivery，不把未执行
  的 manual/threshold/overflow+retry 实测写成资格证据。

## 8. Migration 与兼容

- [x] Migration 110 从主线 v1.22/schema 63/migration 109 增加 Pi catalog 与 Skill group，升级为
  v1.23/schema 64；
- [x] Migration 111 从 v1.23/schema 64 增加 Evidence v2/receipt table/acceptance trigger，升级为
  v1.24/schema 65；
- [x] nonterminal legacy Pi Runs 以 `pi_managed_context_v1_required` fence，清除旧 Pi locator/compaction state；
- [x] completed Pi 业务历史保持只读，非 Pi Binding/Manifest/Delivery 不失效；
- [x] 启动时旧 Pi session/config root 移入版本化 inactive-data quarantine，不复用旧 approval-v1 Host state；
- [x] 旧 migration synthetic fixture 已适配 schema 65 约束，并保留 Grok 107/108、主线 locator 109 与 Pi
  110/111 逐版本验证。

## 9. 自动化与收尾

- [x] Pi adapter capability、workspace Fleet LRU、Bootstrap Evidence/receipt、Migration 110/111 与 MCP bridge 定向
  tests 通过；
- [x] `--features slow-tests` 的 Pi identity freeze/no-redelivery/receipt acceptance 回归通过；
- [x] 真实 `ROVAI_REAL_PI_EXECUTABLE=/opt/homebrew/bin/pi` managed-input smoke 通过；
- [x] `pnpm smoke:pi-runtime` 通过 Core→Pi→真实 provider 的 cold exact resume、workspace resident warm reuse、
  managed allow/deny 与 cancel/descendant cleanup；
- [x] 合并 `main` 后的 `cargo fmt --check`、Clippy、Core 全量 tests 与 `git diff --check` 通过；
- [x] 合并 `main` 后的 `pnpm typecheck`、完整 `pnpm test`、Desktop build 与文档治理门禁通过；
- [x] 合并后真实 Pi Skill native invocation、stdio MCP bridge invocation，以及 Missing-Send zero-send / accepted-send
  suppression 通过；
- [ ] 合并后完整 Built-in CLI smoke 收敛：source 15-operation Run 与 Gather completion 成功，但 recipient Run 被
  当前 Pi native-default provider 的 concurrent-request budget 拒绝；严格证据保持未通过；
- [ ] 新版 Checklist 要求的 Compaction、Usage、Skill/MCP 完整更新删除隔离、六类 Tool output、Missing-Send
  tool→final 与 shutdown
  Golden Flows 全部闭合并形成不可变资格证据。

## 10. 最终汇报要求

- [x] 最终汇报覆盖 Bootstrap、MCP、Skills、LRU、resume、身份保持、Approval/final 与认证/模型差异；
- [x] 明确 Claude/Antigravity 是 one-shot、因此不进入 resident LRU，而不是存在一个被关闭的 LRU 开关；
- [x] 区分 stdio MCP 已实现、Streamable HTTP 未实现，以及 fixture/真实 Runtime/未资格化能力的证据层次；
- [x] 不输出 key、原始 provider URL、Prompt、Session UUID、locator 或日常用户数据。
