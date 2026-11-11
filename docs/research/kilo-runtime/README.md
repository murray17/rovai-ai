---
document_type: research-record
authority: non-normative-runtime-evidence
status: implemented-preview
last_updated: 2026-11-10
---

# Kilo 原生 ACP 研究与实际探测

当前 MCP 保存、原生权限和共享取消 Warm 的简化，含官方 Core 40 Run、同 PID 后继、新租约、
原生四 RPC 取消与失败对照，见[简化记录](../../versions/v1.72/kilo-simplification.md)和
[白名单证据](simplification-7.8.27-macos-arm64.json)。该批实测限 macOS arm64，当前开放范围见
[Platform Admission](../../contracts/runtime-platform-admission-v2.md#kilo-macos-preview)。

自动阈值/overflow 压缩及逐模型 effort 查询的新验证见[专项核对](../../versions/v1.72/kilo-auto-compaction-and-options.md)。
下方早期手动压缩记录不替代自动验收；模型目录当前实现范围与原生可查询能力分别记录。

结论：采用官方 `kilo acp`，复用共享 ACP/Fleet；单 Binding Host 和原生 instructions 已用于产品实现，
不增加压缩插件、独立进程池、配置镜像、二次审批或 SHA256 校验。
当前 macOS arm64/x64 和 Linux x64 为 Preview，Windows x64 为 NotQualified。
User sequence 4 已确认 [Kilo R1](../../versions/v1.72/model-context-change-kilo-acp.md)；
后续 Core 实施、验证和当前缺失范围见[实施记录](../../versions/v1.72/kilo-acp-implementation.md)，
七个真实 Core Run 的本地 Provider 结果见[Core evidence](core-smoke-7.8.27-macos-arm64.json)。
下文保留实施前原生研究的范围和矩阵，不能将当时的 NotImplemented 当作当前实现状态。

成功 Steer 后的常规 Host 复用与连续验证见[复用记录](../../versions/v1.72/kilo-steer-reuse.md)。
逐模型 effort 的实际目录接线、共同选择器与官方 Core 32 Run 见[模型选项记录](../../versions/v1.72/kilo-model-options.md)和
[白名单证据](model-options-7.8.27-macos-arm64.json)。
前台 task 的共享工具展示、输出截断与当前版本判断见[补全记录](../../versions/v1.72/kilo-subagent-display.md)和
[白名单证据](subagent-display-7.8.27-macos-arm64.json)。Skills 的 DocumentationOnly 仍只表示 Rovai 集成验收深度。
最新边界修正及严格无 Node 的官方 Core 验收见[收尾记录](../../versions/v1.72/kilo-boundary-fixes.md)与
[白名单证据](boundaries-7.8.27-macos-arm64.json)。
早期修正见[复核记录](../../versions/v1.72/kilo-acp-review-fixes.md)；
后续禁后台、文件与 Core Steer 见[实施记录](../../versions/v1.72/kilo-files-steer-verification.md)。
该后续记录包含真实 sub2api 开发 App；下方基线表中的本地 Provider 范围仍只描述早期原生研究。
阶段记录曾使用原生 config 回调覆盖产品权限；当前已移除该权限 Hook，完整继承原生规则与用户插件/pure，
MCP 保存下一 Run 生效和普通取消 Warm 的当前范围见[简化记录](../../versions/v1.72/kilo-simplification.md)。

## Linux x64 目标机验收

2026-11-10，在 Ubuntu 24.04.5 LTS x86_64（glibc 2.39）运行官方 Kilo 7.8.27 Linux x64 二进制。
测试使用隔离 Core、数据目录和 Kilo 原生配置。基线的产品检查返回 `runtime_platform_not_qualified`，
验收构建在 Core 中临时开放 Linux Preview。[验收基线 b5e2e612d](https://github.com/murray17/rovai-ai/commit/b5e2e612d16b25f96fa5b2bee555cbebea594b17)

真实对话验证了 Kilo 发现、队员配置和模型目录。显式选择 `sub2api/gpt-6.1-sol` 后，Run 成功，
创建了 `kilo-verification.txt` 并发布一条会话回复。文件变更显示新增 1 行、删除 0 行。
首轮触发验收驱动的 15 秒启动时限，等待 Core 就绪后复测通过。

同一二进制与受控 Provider 跑完 40 个 Run，37 个成功、3 个按用例取消。覆盖热续接、冷恢复、权限审批、
文件变更、MCP、运行中补充指令、取消后恢复、前台子代理和自动压缩。[ACP 验收脚本](../../../scripts/smoke-kilo-runtime.mjs)

## 基线与证据

| 项目 | 当前事实 |
| --- | --- |
| Rovai 编码基线 | `958784f6e17fc32d8b2753d7f14fd6122dceea9d`，独立 worktree |
| 最近生产参考 | OpenCode ACP 的共享 Host/Fleet/Session；原生独立 system 承载参考已有 managed-system 路径 |
| 官方最新正式版本 | `7.8.27`，2026-11-05 发布；GitHub releases/latest 已复核 |
| 官方源码提交 | `03a6f07d053cd7e6aa88fa1e258e93510335259f` |
| 本机日常 kilo | `7.3.54`，只读版本，没有升级或改其原生配置 |
| 实测二进制 | 官方 release `kilo-darwin-arm64.zip`，解压到本次临时目录 |
| 实测平台 | macOS arm64 |
| 协议 | ACP protocolVersion 1，NDJSON JSON-RPC |
| Provider | loopback OpenAI-compatible fixture、假 token；没有真实账户/付费模型 |
| 原生研究隔离 | fresh XDG config/data/cache/state、owned workspace/skills；该原生探针未启动 App/Core |
| 当前准入 | macOS arm64 Preview；identity 为 kilo-cli、schema 173，见后续实施记录 |

原始网页报告只提供研究线索。此处区分官方源码、真实 Kilo 对本地 Provider 的行为，
以及后续的 Rovai 实现；不直接继承报告中的资格判断或建议的复杂防御机制。

## 关键判断与实测

### Host 与 MCP

官方源码将 ACP MCP 注册到按 directory 缓存的 backend。
实测同一 Host 的 Session A 注册 MCP 后，新建同 cwd、`mcpServers: []` 的 B 仍收到 A 工具。
关闭 Host，再以原 A 的精确 ID resume 且 MCP 空列表，旧工具不再出现。

这不是引入第二套隔离系统的理由：现有
`AcpRuntimeManager::ensure_agent_run` 已用 camp/member/native Binding 兼容键获得共享 Fleet Host。
Kilo 明确采用一个 Native Binding 一个 Host，不实现额外跨 Binding 多 Session 复用。
MCP 保存不主动退役；下一 Run 获取时，真实不兼容配置沿既有机制替换 Host，之后精确恢复旧 nativeSessionId。
名称冲突/投影沿现有 PreparedMcpProjection；native 同名优先级还需生产链路复验。

### Bootstrap 与压缩

`KILO_CONFIG_CONTENT.instructions` 可追加绝对路径；官方 `Instruction.system()`
在普通模型请求中重新读取文件，Core 无需私有 hook。
实际模型请求的 system 含 `Instructions from: <absolute path>\n<file bytes>`。
warm 改变文件后下一请求收到新标记，旧标记从 system 消失。
执行 `/compact` 实际生成一条原生 summary，后继普通请求仍收到完整 instructions；
Host 重启、原 ID resume 后同样成立。

因此建议 Kilo 直接使用现有 `managed_system_prompt`：
B 作为 instructions 文件、user 只发 P、压缩采用 `native_system_prompt_preserved`。
这比 first_payload 再添加原生压缩 observer 的接法更简单。
不凭文件存在或模型复述自证，探针检查的是本地 Provider 实际收到的 system/user。
手动压缩的证据不能证明 threshold/overflow 或真实付费模型已验收。

### 原生会话

`initialize` 广告 load、resume、close、list、fork。
本轮实际 new → 工具/回复 → compact → Host 关闭 → exact resume → 新输入通过，
恢复请求携带同一个完整 Session ID，Provider 收到恢复的历史。
不存在的 Session ID 返回 `-32603 / service=session`，没有静默生成新 ID；
其错误不够精确，不能把任意该类错误解释成历史不存在并自动重放。

### Usage 和命令输出

同一工具轮有两条原生 assistant 消息，各为 input 75、output 20、cache-read 25。
ACP PromptResult 只报告最后一条的 `75 / 20 / 25`；不能将它当作整轮总量。
独立 title 生成也会调用 Provider，却不属于本次根 Session 的两条消息。
Kilo `data/kilo/kilo.db` 的 session/message 元数据形状可复用现有 OpenCode numeric reader，
通过 Prompt 前 baseline 与新消息 ID 去重；不读取正文补猜 Usage。

工具 `call_kilo_bash_*` 的 pending/in_progress/completed identity 保持。
原生分别出现 `KILO_STDOUT`、`KILO_STDOUTKILO_STDERR` 的运行中快照，
终态输出为 `KILO_STDOUTKILO_STDERR`。共享映射需按快照更新，不能重复 append。
stdout/stderr marker 在 ACP tool output 中出现，不是只出现在 final 文本。

### 问卷与权限

spawn 前显式设置 `KILO_CLIENT=acp`，普通请求 tools 未含 question。
原生 MCP echo 已真实调用；本轮许可模式 allow。
原生 ask/deny、迟到批准、取消副作用和用户原生配置兼容尚未实测，
不得由 allow 成功推导这些轴完成。
接入只复用现有审批/Run/Prompt/epoch 生命周期，不加路径 containment 或另一套审批策略。

## 14 轴实施前 Parity Matrix

此表记录实施前的原生研究，彼时 Rovai implementation 均为 `NotImplemented`。
当前各轴的生产实现与真实 Core 证据见[实施矩阵](../../versions/v1.72/kilo-acp-implementation.md#当前实施矩阵)；共享底座存在不能替代 Kilo 真实验收。
Runtime evidence 的 Verified 只指“已实测”列的具体子能力；轴内其余部分仍为 NotObserved。

| 核心轴 | 标准行为及接入策略 | Runtime evidence 与当前边界 |
| --- | --- | --- |
| Auth / Provider / Model | 独立 Kilo 原生 HOME/auth/config；ACP configOptions/default，显式模型原值 | Verified：本地 Provider/目录/默认模型；NotObserved：真实认证、订阅/BYOK刷新 |
| Host / Fleet / LRU | 复用共享 Fleet，一个 Binding 一个 resident Host | Verified：原生 warm/Host restart；NotObserved：Rovai LRU/并发 |
| Native Session / Continuation | 精确 native ID，load replay 走共享 quarantine，优先 advertised resume | Verified：原生冷恢复和缺失 ID 拒绝；NotObserved：Core restart/误绑 |
| Bootstrap / Context | 原生 instructions 承载共享 B，普通 user 只有共享 P | Verified：system/user、warm更新、cold；NotObserved：正式 Evidence 与完整 B/P |
| Compaction continuity | native_system_prompt_preserved，不加 detector | Verified：有真实 summary 的手动压缩；NotObserved：threshold/overflow/cancel |
| Skills | 复用来源/冻结索引，Kilo 原址发现，不创建项目副本 | DocumentationOnly：原生 .kilo/.kilocode/.agents/.claude 来源；NotObserved：调用/更新删除 |
| External MCP | PreparedMcpProjection，Binding Host 隔离，更新时 invalidation | Verified：原生调用、同 Host 残留、fresh Host 撤销；NotObserved：原生重名/Core投影 |
| Tool / Action / Command Output | 共用 ACP ID/lifecycle，输出按原生 snapshot | Verified：bash 与混合输出快照；NotObserved：其他工具及 empty/nonzero/large |
| Narration / Final / Missing-Send | 标准 chunks + stopReason；空成功复用当前合同 | Verified：原生 end_turn；NotObserved：Core公共发送/去重/thinking |
| Permission / Approval / Workspace | 原生 allow/ask/deny 原值，默认已验证最高权限；共享 fence | Verified：allow；NotObserved：ask/deny/cancel/late allow |
| Built-in rovai CLI | 当前 bundled CLI + 每 Run lease | NotObserved：尚无真实 Core/CLI 集成 |
| Usage / Cache / Cost | 逐消息增量去重，session gauge，cost不重复归整Run | Verified：两 step/最后一步差异/原生字段；NotObserved：Core retry/resume/cost |
| Retry / Queue / Cancel / Cleanup | 共用 accepted/unknown/no replay、epoch、进程 owner | Verified：探针进程组退出；NotObserved：生产 cancel/crash/timeout/shutdown |
| Ready / Version / Platform | 机器安装/认证/行为资格独立 | Verified：7.8.27 macOS arm64 ACP；NotObserved：其他平台/完整资格 |

尚无可靠上游 Unsupported 产品差异决定；不以“先不做”将 NotObserved 改成 Unsupported。

## 可复现探针与记录

```bash
ROVAI_KILO_BIN=/absolute/path/to/official/kilo node scripts/probe-kilo-runtime.mjs
```

[探针源码](../../../scripts/probe-kilo-runtime.mjs)只使用 Node 标准库与现有 MCP fixture；
每次创建新的临时根，输出路径与 summary。单 stdout reader 分发 response、notification、
Agent 请求；每个 RPC 有界，finally 结束自有进程组和 Provider。
脚本只用于原生研究，不接入 App，不注册到每次默认回归，不增加 Rust 测试函数。

证据中的 summary/frames/model requests 都只含生成的假 token、owned 路径和测试标记，
没有复制用户凭据或真实模型输入。当前稳定结果使用全新目录，早先夹具调试失败不混入通过证据。
本轮[机器可读结果](native-probe-7.8.27-macos-arm64.json)记录实际原生 Session、数值和进程组清理；
两个自有 Host 的进程组在探针退出后均不存在。
原始记录由执行线程附件保存；仓库记录可复现方式和经过核对的结果，
不依赖本机临时目录长期存在。

本轮验证通过：独立原生探针、Node 语法检查、`pnpm docs:test`（10 项）、
`pnpm docs:check`、指定真实 base 的 `pnpm docs:check:ci`、`git diff --check`。
以上为原生研究阶段门禁；后续生产修改与 Rust/Renderer/Core 门禁单独记录在实施记录，不回写为原生阶段已完成。

## 官方来源

- [7.8.27 正式 release](https://github.com/Kilo-Org/kilocode/releases/tag/v7.8.27)。
- [ACP service](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/service.ts)：
  exact Session、MCP 注册、configOptions、PromptResult。
- [Instruction reader](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/session/instruction.ts)、
  [普通 Prompt 组装](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/session/prompt.ts)。
- [Usage](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/usage.ts)、
  [工具输出](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/event.ts)。
- [MCP directory state](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/mcp/index.ts)、
  [Skills](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/skill/index.ts)、
  [XDG roots](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/core/src/global.ts)。
