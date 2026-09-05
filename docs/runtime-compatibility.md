---
document_type: runtime-compatibility-register
authority: runtime-validation-evidence
last_updated: 2026-09-05
---

# Agent Runtime 兼容性清单

本文件维护 Agent Runtime 的本机实测证据和复核条件。它不是产品 Runtime Registry、
Roadmap 或用户可见能力来源；正式目录以代码中的 `AdapterKind`、Migration、健康探测和
测试为准。跨版本边界见
[Runtime Catalog 与 Installation 不变量](architecture/foundational-invariants.md#runtime-catalog-installation)与
[Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md)。

兼容性清单中的自然语言结论本身不会自动创建产品类型。v0.42 起，Rovai-owned built-in
operations 的正式准入基线是 [Built-in 运输不变量](architecture/foundational-invariants.md#skills-builtin-transport)：
Runtime 必须能执行 bundled `rovai` CLI，经 private local IPC 调用 Core Router。旧 Team、
Context、Memory MCP transport、Bridge、Plugin 与 Runtime-native built-in MCP config 已完全
退出当前架构；用户 External MCP 是另一条独立能力，不参与 built-in tool 准入判断。

## 当前 Product Runtime Catalog

当前 closed `AdapterKind` 包含十四种 Product Runtime：Codex CLI、OpenCode、GitHub Copilot、
Claude Code、Antigravity、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE CLI CN、Cursor Agent、Kimi Code、
Grok Build 与 Pi Coding Agent。
Cursor 在三个目标平台均为 `not_qualified`；Pi 在三个目标平台均为可运行但未正式资格化的 `preview`。Kimi 在 macOS arm64、macOS x64 与 Windows x64 均为
digest-bound `qualified`。
Grok Build 在 adapter-scoped 证据分别覆盖的 macOS arm64、macOS x64 与 Windows x64 均为 `qualified`；
三个宿主平台各自绑定独立 evidence digest，不互相外推。
Cursor identity 仅保留内部兼容与历史读取，默认不进入 discovery/check/AgentRun；Settings 的 Agent Runtime
目录不展示该项。设置页的
DeepSeek Harness “待支持”行是 Renderer-only Preview，不在这个目录中，也没有 Installation、
Probe、成员选择、诊断或 AgentRun 语义。

### 2026-09-03 Pi 0.84.4 macOS arm64 开发证据与实验性开放记录

本机把 `@earendil-works/pi-coding-agent@0.84.4` 安装到一次性目录，未替换 PATH 上的 0.84.2。Pi 官方
`auth.json/settings.json` 使用 `minimax-cn / MiniMax-M3`，直接官方 Pi 请求返回固定 marker；凭据值没有进入仓库、
测试输出或公开 Runtime trace。Core 的行为 smoke 复制所需官方配置到 0700 临时 `PI_CODING_AGENT_DIR`，并在结束
时连同 Session 一起删除。

| 能力 | 0.84.4 实际证据 | 当前产品结论 |
| --- | --- | --- |
| Ready / Probe | managed extension handshake；创建 Session 后取得 full UUID/canonical file；创建 replacement；实际 `switch_session(exact file)`；`get_state` 核对 ID/file/cwd；Probe session root 未污染 | Pi 专属 Machine Ready 已实现；这些行为仍不是平台 qualification |
| Auth / Model | 官方 native default MiniMax M3 请求成功；Core catalog/default 与 explicit set/get validator 有 deterministic coverage | 正式 Run 只继承 Pi 官方配置；不借 Claude provider/Home |
| Session / Host | First Run 后停止 Core，重启后同 full Native Session ID cold exact resume；下一 Run 复用同 Host/Session；跨 Camp A→B→A 使用同 workspace Host、两个 full Session ID 严格分离并准确切回；两个并发 Run 使用不同 Host | `resident_multi_session` 实现成立；复用 identity 是 workspace/process，当前 Camp/member invalidation scope 单独更新；公共 Fleet 用计入容量的 Starting reservation 在锁外并发 spawn，同 Run 等待同一结果；Core planned shutdown 后 descendant 与 Host config 为零 |
| Bootstrap / lifecycle | 历史 smoke 的首次、cold resume、warm reuse 曾通过 managed-input receipt；公开 events/stderr 不含 `sessionFile` 或 `nativeSessionFile` | 当前 v7 每轮重新读取 binding 并追加 `managed_system_prompt`，失败只诊断；新 Run 不生成或读取 Receipt。首个 owner-fenced `agent_start` 接受 Delivery 并发布 started，`agent_settled` 结算 |
| Action / cancel | 历史受管 smoke 覆盖 stdout、stderr、mixed、empty、exit 7、>50KB/2500 行、allow/deny 与 sleep cancel；这些仍是 wire/lifecycle 证据，不再证明当前审批产品能力 | 当前所有 Built-in/Extension Tool 按 Pi 原生语义执行；无 Rovai Approval、shell envelope、permission option 或 sandbox。Action 继续由原生结构化 Tool events 归一，cancel 仍使用 correlated `abort` |
| MCP | 上游没有原生 External MCP；通用 Extension Tool API 不作为产品 MCP transport | `Unsupported`；Pi 静默忽略已保存 Assignment，不读取配置、不投影或启动 Server、不注册 proxy Tool，MCP 变化不参与 Host/LRU/resume |
| Skills / Built-in | 历史真实 smoke 调用过 `.pi/skills` projected Skill，并覆盖导入、Revision update、disable/re-enable、unassign/restore、hard delete、重启、project-owned 同名 shadow 与同 Host 相邻 Session no-leak；Built-in CLI 15-operation full Run 与 resumed/new-lease Run 通过 | Skill 文件投递保持 Implemented，但当前 Runtime discovery 为 `DocumentationOnly`：只由 Pi 原生 ResourceLoader/workspace trust 决定，Rovai 不追加 path、不读取 `get_commands`、不做 catalog attestation；Built-in 既有 Verified 证据不变 |
| Final / Usage | `agent_settled` 后唯一成功；terminal assistant `message_end.message.usage` 在 Monitoring 得到 input/output；cancel 不触发成功 | streamed update/session totals 不计量；reasoning/cost 缺失保持 unknown |
| Compaction | 上游源码与 wire 定义显示 system prompt 独立于被压缩 message history，且有结构化 compaction lifecycle | 策略为 `native_system_prompt_preserved`；manual/threshold/overflow+retry/cancel 的完整真实产品 smoke 待完成 |

Pi executable 缺失时，独立 optional subsystem 只把 `runtime.pi` 标成 degraded；Core、Skills、MCP 与其他 Runtime
仍可用。这个安装存在性检查不等于 Ready 或平台资格。

本记录只形成 `macos-arm64` 开发证据，不是 `Runtime Platform Admission` artifact。Pi 在 macOS arm64、macOS x64、
Windows x64 均为 `preview / runtime_platform.qualification_evidence_missing / evidenceRevision=null`；普通 discovery、
检查、成员选择、Diagnostics 与 AgentRun 已开放供主动测试，但不宣称 First-Class/qualified。Pi Prompt message 原样
使用 Formatter 22，不解释 `/...`；Prompt images 从结构化 ContextManifest attachment refs 接入原生 RPC。
Pi-specific structured Web Search 与 Camp Fast 当前明确 unsupported/hidden。完整差异和
未闭合项见 [Pi Parity Matrix](research/pi-runtime-reintegration-parity-matrix.md)与
[Runtime Launch v34](contracts/runtime-launch-and-verification-v34.md)。

### 2026-08-31 Camp Fast metadata 边界

macOS arm64 上只运行原生版本/auth/schema 检查，没有创建模型请求：

| Runtime | 本机观察 | Camp Fast 结论 |
| --- | --- | --- |
| Claude Code 2.1.220 | `auth status` 返回 loggedIn、firstParty、authMethod 为 `oauth_token`、subscriptionType 为空；进程环境无自定义 Key/Base URL/云 Provider | 原生官方 OAuth 身份通过 Fast 入口认证门禁；不要求套餐字段，实际用量/组织资格由 Runtime 判断，未发起付费模型请求 |
| Codex CLI 0.147.0 | 标准及 `--experimental` app-server schema 仅有持久 `serviceTier`，没有 `serviceTierForTurn`；模型字段为 `serviceTiers` / `defaultServiceTier` | 不支持所需单 Turn 覆盖，隐藏；禁止用持久字段代替 |

Claude inline settings、默认模型切换及 cooldown 边界参考[原生 Fast 文档](https://code.claude.com/docs/en/fast-mode)。
官方订阅组织也可使用 `setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`，见[官方迁移说明](https://support.claude.com/en/articles/14128775-claude-code-on-console-to-enterprise-migration)。
套餐字段只作可选 metadata，不以缺失代表认证未知；未知认证方式、自定义 Provider/endpoint 仍拒绝。
离线 native 协议 fixture 验证后续合格版本的精确字段、实际 cwd、分页与未知拒绝；隔离 Electron 验证生产
成员浮层。它们不等于本机 Fast 付费执行成功，也不扩大既有平台准入。合同见
[Camp Member Fast v1](contracts/camp-member-fast-v1.md)。

### 2026-08-27 ACP 文件操作与 Diff pre-fix 真实观测

对日常 App 最近三个隔离 Camp 的 append-only Execution Evidence 做只读核验，确认问题不是三个 Runtime 都没有
文件修改事件：

| Runtime | 真实终态观测 | pre-fix 缺口 | 当前代码边界 |
| --- | --- | --- | --- |
| Kimi Code `0.38.0` | 成功 `edit` terminal，`locationCount=1`，没有标准 ACP Diff | 普通 `Edit` 行没有收敛为文件操作 presentation | 同 terminal 唯一标准 location 生成 `修改 kimi-code-cli.txt`；没有 `+ / −` 或 inline diff |
| Qoder `1.1.28` | 成功 Write 可只有可靠 path；后续成功 Edit 可提供完整 old/new，但没有标准 ACP Diff；另一个 Read 的 terminal 曾错报 `edit` | 稀疏 terminal 丢失路径，且冲突 kind 可能把 Read 误分类 | 同 ToolCall 累计先前 location；首次可信结构化 kind 优先，Read 不伪造成写；path-only Write 保留操作计数但不渲染空 Diff，同文件可靠 Edit 正常显示内容并参与 `+ / −` 聚合 |
| Kiro `2.18.1` | 成功 `edit` terminal 同时有唯一标准 location 和标准 ACP Diff | Diff 被归一化为 `runtime_diff_path_outside_root`；持久 Evidence 没有保留被拒绝的原始 path | 对 Kiro 已知 rooted-relative wire shape，单 entry Diff 仅在去根锚路径与同 ToolCall location 完全相等时对齐，随后同 Activity 同时具有文件操作行和 inline Diff |

上述观测冻结的是修复前真实 wire 的能力与失败点；当前代码已建立定向 fixture，但修复后的打包 App 真实复测尚未
执行，不能把 fixture 写成 post-fix Runtime smoke。当前每 Run 文件变化卡片只归约该 AgentRun 已落库的可靠
Runtime Evidence，不使用 Git 或工作区扫描；因此 path-only、标准 Diff 与 exact mutation 的实际覆盖直接决定卡片
细节，未被 Runtime 报告的 shell 或外部写入不进入卡片。

### 2026-08-24 Kimi Code macOS x64 准入晋升

维护者确认 Kimi Code 的 x86_64 macOS 平台验收已经完成，并明确批准开放该平台。`kimi-code-cli × macos-x64`
因此从 `not_qualified / runtime_platform.qualification_evidence_missing` 晋升为 digest-bound `qualified`，与
macOS arm64 一样进入普通 discovery、检查、成员配置和 AgentRun 路径。

本次晋升只改变 Runtime Platform Admission 行，不新增 Adapter、权限、provider、Session、External MCP、Usage
或 Compaction 语义；现有 Kimi `0.32.0` + MiniMax M3 能力边界继续由下方完整资格复核拥有。当前提交所在主机
是 macOS arm64，未在本提交内重跑 x86_64 真实模型 Smoke；x86_64 资格依据是维护者已完成验收后的明确发布
确认，而不是把 arm64 结果静默外推。Windows x64 已由独立 Windows 资格证据准入，不受本次变更影响。

### 2026-08-24 Kimi Code `0.38.0` ACP Client Terminal macOS arm64 产品 Smoke

本机通过 Homebrew 将 `/opt/homebrew/bin/kimi` 从 `0.32.0` 升级到 `0.38.0`。Rovai 隔离开发 App 使用独立
`userData` 与 managed Skill Library，Runtime Discovery 解析到 0.38.0 Cellar executable，Deep Probe 返回
`authenticated / ready`。随后经 User Automation 创建专用 Kimi 成员、directory Camp 并投递真实 AgentRun；
Runtime 建立新的 ACP Session，两次结构化 Bash 均以 `shell.execute / succeeded` 结束，实际返回 canonical
workspace cwd 与 `ROVAI_KIMI_038_TERMINAL_OK`，AgentRun 最终为 `succeeded` 并发布 Camp final。

该 workspace 除 Runtime 受管 Skill projection 外没有测试命令产生的写入；Run 结束后进程检查没有 Kimi 或
Terminal 子进程。Kimi 0.38.0 在 `terminal=false` 时会走已确认的 capability-unavailable 分支，因此本次真实
Shell 成功与标准 wire fixture 共同证明 `LocalBridged` negotiation 和 Client callbacks 的产品路径。此证据只属于
macOS arm64，不替代 macOS x64 或 Windows x64 的独立资格证据，也不改变其他 ACP Runtime 的内部 Shell 路径。
v1.28 合并验收又以当前 `0.38.0` 重跑 Missing-Send 三场景：zero-send 正常发布、accepted send 抑制 fallback、
真实 tool→final fixture 通过并形成 6 条 ACP Tool event；generic agent text 仍不经过 provider 清洗。

### 2026-08-22 Kimi Code `0.32.0` + MiniMax M3 macOS arm64 完整资格复核

本机 `/opt/homebrew/bin/kimi` 报告 `0.32.0`。Rovai 没有改写用户 `~/.kimi/config.toml`，而是从
权限 `0600` 的仓库外私有文件向目标子进程注入 MiniMax provider。真实 token 未进入仓库、fixture、数据库、
diagnostics 或本文。国内 `https://api.minimaxi.com/v1` 接受该 Token Plan；国际 endpoint 对同一 token 返回
未认证，因此本次只使用国内 OpenAI-compatible endpoint。

`KIMI_MODEL_CAPABILITIES=thinking` 只声明 provider 能力；Rovai 不强制关闭 Kimi/MiniMax thinking，也不再
按 provider 或 `<think>` 标签清洗返回文本。Runtime 作为普通 `agent_message_chunk` 发出的内容原样进入执行台
Evidence、terminal final 与 Missing-Send candidate。

| 能力轴 | 本次证据 | 当前产品边界 |
| --- | --- | --- |
| Identity / launch | `kimi --version` 为 `0.32.0`；`kimi acp` 完成 ACP v1 initialize/session-new | canonical executable 为 `kimi`，wire identity 为 `kimi-code-cli`，覆盖键为 `ROVAI_KIMI_BIN` |
| Provider / model | 私有配置注入 `MiniMax-M3`、`openai` provider、国内 endpoint；真实 Prompt `end_turn` 成功 | 六个 `KIMI_MODEL_*` 键严格 allowlist；Unix group/other 可访问、未知/重复/缺失键均 fail closed |
| Prompt / final | 隔离 ACP 和项目级 Core AgentRun 都返回固定答案；v1.28 generic fixture 证明 `<think>` text 原样保留 | Kimi streamed text 走普通 `agent.text.delta`；terminal 与 Missing-Send candidate 不做 provider 清洗 |
| Tool / permission | 显式 `permission_mode=default` 的 Shell allow-once、deny 与六类 terminal output 矩阵通过；另一个真实 smoke 直接读取 Core `memberRuntimeDefaults` 得到 `permission_mode=yolo`，固定 Prompt、Shell command 和文件写入均成功且产生 0 次交互式 Approval | 新队员默认原生最高权限 `yolo`，descriptor recommendation 保持 `default`，已有保存值不自动扩权，read-only effective mode 强制 `plan`；最高 Runtime 权限不绕过 Core 自有路径、凭据、Binding 与 execution fence |
| Deny / filesystem | 独立 Camp 中真实 deny Approval 返回 `rovai_approval_denied`，Tool 为 `failed/not_executed`，目标文件不存在；旧 Core 曾另以 one-time authorization 拒绝 Client FS 写入 | 当前 Client FS/Terminal 权限由 Runtime 拥有，Core 不再把 permission response 映射为文件 token，也不做 execution-root containment；Runtime Tool 前的原生预拒绝仍可单独如实记录 |
| Cancel / cleanup | `sleep 30` 获准后发送 `session/cancel`，约 6 ms 返回 `cancelled`，无目标残留进程 | cancel、terminal、planned shutdown、Camp 删除与 App shutdown 都停止私有 Host/进程树 |
| Session / Home | 同 Host 同 Session 多轮精确回忆通过；同 Host 两个 Session 的 marker 无串话；新进程复用同一 `KIMI_CODE_HOME` 时，`session/resume` 与 `session/load` 都保持精确 Session ID 并回忆 marker；换用隔离 Home 后 resume 返回 `-32602 Unknown sessionId`；用户原生 Home 的真实 Core smoke 证明固定 command、allow 写入与 deny 三个连续兼容 Run 复用同一 Host/Session，显式停止后新 Host exact resume 且 Session ID 不变 | 正式 AgentRun 不设置 `HOME` / `KIMI_CODE_HOME`，继承用户原生状态根；Deep Probe 使用一次性临时 Home。含 AgentRun identity 的 Run-local MCP projection/evidence digest 不进入 Host compatibility，完整 Server 定义仍进入；停止或淘汰后新 Host 优先 exact resume，load-only 时进入 replay quarantine；v22 旧私有 Home 不自动迁移或删除 |
| Catalog | `session/new.configOptions` 报告 synthetic env model、thinking `on/off` 与四种 mode；Idle `available_commands_update` 报告内建 command 和 Skill command | Runtime advertisement 为 Verified；Host 安全路由为私有 async metadata。当前产品不消费该 catalog，不建立产品 snapshot，也不列为遗留问题 |
| Skill | `.kimi-code/skills` 两次都被发现并返回唯一 marker，且正确选择 canonical `--to-principal` 但不触发当前用户注意力 | managed Skill discovery/invocation 与消息局部注意力教学均为 Verified |
| External MCP | 原始 ACP stdio 与相邻空 Session 隔离通过；产品 smoke 经 Core、Assignment、AgentRun Projection、ContextManifest 和 MiniMax M3 真实 Tool call，同时返回 Rovai stdio、Streamable HTTP 与额外 stdio 三个 marker，项目同名 native 定义均未覆盖 Rovai 定义 | `AdditivePerRun / RovaiWins`；标准 ACP `session/new/resume/load.mcpServers`，三项 Manifest exposure 均为 `ready`，不写 Runtime 用户级配置 |
| Missing-Send | zero-send publication、accepted-send suppression、ACP tool→final 三场景通过；v1.28 generic agent-text fixture 覆盖 Kimi/Grok 原样 `<think>` text | `IfNoAcceptedSend` 使用通用 ACP assistant suffix 与既有 suppression gate，不做 provider 清洗 |
| Usage / compaction | 多轮 Prompt、resume/load 与 MCP 调用均未观察到 `usage_update`；Kimi `0.32.0` 安装包与官方 `main` 证明 compact lifecycle 会降格为同形 text chunk，自动 compact 可与 Active Prompt 重叠；确定性 Host 回归已覆盖 started→blocked→completed | Usage/Cost Disabled；Compaction `best_effort`，Active Prompt 使用 Kimi-only exact lifecycle correlation，idle/detached 保留官方四行 completion detector；blocked 保持 pending，frame 不污染 final/Missing-Send；无 Hook、用户配置或 token heuristic；真实自动/手动完整 Core observation smoke 待执行 |
| Built-in CLI | 早期 `0/15` fixture 把 legacy stdin 非法输入的当前退出码 `2` 错写为 `1`，Kimi 实际已执行 Shell 并在首项 canonical operation 前退出；修正后十五项 operation、三种输入、Gather、exact successor read、conflict、initial/resumed lease fencing、logical/native continuation 全部通过，共 56 条 full-run evidence | macOS arm64 Built-in transport 为 Verified；snapshot 声明 capability，默认 Built-in 与 Skill 资格集合包含 Kimi |

项目级最终固定输出为 `ROVAI_KIMI_ACP_OK`，命令 output marker 为
`ROVAI_KIMI_CODE_CLI_PRINTF_OK`，allow 与 deny 都完成真实 Approval roundtrip。基础 AgentRun 可用于隔离诊断，
修正过期 fixture 后 Built-in hard gate 已通过，所以 macOS arm64 为 digest-bound `qualified`；snapshot 声明
Built-in transport，普通产品与默认资格 Smoke 包含 Kimi。External MCP 与兼容 warm Host 已由独立产品矩阵
启用；Kimi Compaction compatibility detector 独立以 `best_effort` 启用。该次 2026-08-22 arm64 结论当时
没有外推为 macOS x64 或 Windows x64 产品资格；两者后来分别通过自己的发布准入。native resume 使用用户原生 Kimi Home，History Restore 只作为 load-only
fallback。异步 command catalog 没有当前产品消费者，不再作为
功能空缺跟踪。

### 2026-08-22 Cursor Agent `2026.08.11-e8db854` 隔离探测与未准入记录

本机 `/opt/homebrew/bin/agent` 实际是 Grok Build `0.2.118`，不是 Cursor；用户现有
`~/.local/bin/cursor-agent` 为 `2025.09.18-7ae6800` 且没有 ACP 子命令。为避免修改用户安装与认证状态，
本轮只把 Cursor 最新候选下载到临时隔离目录，记录版本 `2026.08.11-e8db854`，没有安装到 PATH、没有运行
login、没有发送模型 Prompt，也没有读写日常数据库。

| 能力轴 | 本次证据 | 当前产品边界 |
| --- | --- | --- |
| Executable identity | 通用 `agent` 存在真实产品碰撞；Cursor build 使用 `YYYY.MM.DD-<build>` shape | canonical command 为 `cursor-agent`；`agent` 只有严格版本 identity 通过后接受，无关同名程序返回 `runtime_identity_mismatch` |
| Protocol | 临时候选的 `<executable> acp` 完成 ACP v1 initialize，stdout 为逐行 JSON-RPC | 复用 ACP Host；只把 `acp.initialize` 作为已观察 handshake，不升级平台 qualification |
| Authentication / Session | `authenticate(cursor_login)` 在 15 秒内未完成；跳过认证的 `session/new` 返回 Authentication required | Ready validator 要求 authenticate + 非空 Session；当前没有 Ready evidence |
| Cursor extensions | 官方文档列出 ask/create-plan requests 与 todo/task/image notifications | 唯一 Active Prompt 路由、skip/reject 与 private notification 隔离已由 fixture 实现；没有真实 Agent 行为 Smoke |
| Permission / workspace | 官方文档提供 agent/plan/ask 与 auto-review/force | 静态配置已实现；read-only 强制 plan 并移除高权限 flag；尚无 allow/deny 副作用证据 |
| Skill | 官方文档列出项目 `.cursor/skills` 与 `.agents/skills` | Rovai 只拥有 `.cursor/skills` projection；Runtime load/invocation 为 DocumentationOnly |
| MCP / continuation | 官方文档只确认 Cursor 配置面；本轮未获得 authenticated Session | External MCP、session/load/resume、warm reuse 均 Disabled；完成 Run 后停止 Host |
| Activity / final / usage | 无 authenticated Prompt、Tool 或 terminal transcript；官方现已记录 observation-only `preCompact` 及 current/window/usage token 字段 | Activity baseline 为 `run_level`；Missing-Send、Usage/Cost 与 Bootstrap Compaction detector 均 Disabled。执行台当前无展示入口，本次需求不新增其协议接入 |

本轮不满足 checklist 的 First run、Command output、Approval、Cancellation、Private request、Built-in CLI、
Process cleanup 与 continuation 必过 Smoke。macOS arm64、macOS x64、Windows x64 因而全部保持
`not_qualified / runtime_platform.qualification_evidence_missing`，qualified evidence revision 为空。
完整研究与后续 Probe 清单见 [Cursor Agent Runtime Research](research/cursor-agent-runtime-research.md)。

### 2026-08-20 TRAE `0.120.52` asynchronous catalog、Skill 与 Ready 复核

本轮直接启动 build commit `6756e52a9238b6d493928e55b05127957dbfefb4`（build date
`2026-08-12T01:31:30Z`）的 `traecli acp serve`。基线中 `session/new` response 在进程启动后约
1215 ms 到达；标准 `session/update` 的 `available_commands_update` 在约 1727 ms 到达，即 response 后
约 512 ms。`availableCommands[]` 每项 shape 为 `{name, description, input: {hint}}`，共 17 项：Runtime 内建
Slash Commands 为 `agent-new`、`init`、`loop`、`compact`，其余 13 项来自当时用户环境已加载的 Skills：
`code-review`、`codebase-design`、`documentation-lookup`、`domain-modeling`、`feishu-docs`、`grill-me`、
`grill-with-docs`、`grilling`、`handoff`、`improve-codebase-architecture`、`mac-performance-doctor`、`officecli`、
`setup-matt-pocock-skills`。
因此“`session/new` 返回值没有 Skill 字段”不能作为 TRAE 不提供 Skill 的证据。

旧 ACP Host 会把该合法 Idle Session notification 归为“session-scoped message arrived without an active
prompt”，将 Session 标记为 `ProtocolViolated`。当前 Host 已把 `available_commands_update`、config/mode/
session-info catalog、Idle usage metadata 和已知 lifecycle extension 分流为 Session metadata：不进入 Prompt
output，不因没有 Active Prompt 违规。Runtime advertisement evidence 为 `Verified`，安全路由实现为
`Implemented`；Rovai 尚未把异步 update 维护为按 Host + Native Session ID + generation fencing 的权威 catalog
snapshot，产品 catalog consumption 为 `NotImplemented`，首条 update 前也没有可消费的 `Pending/Unknown`
状态。

当前 Host 对未知标准 method/`sessionUpdate` variant 仍 fail closed；它也会把结构合法的未知 ACP `_...`
custom notification 标记为 `ProtocolViolated`，尚未按 ACP extensibility 规则私有忽略，并且尚未对未知
`_...` request 返回 `-32601`。这是基线 `2e8ddc3539470770a6f1942c93344cd236f5768f` 的已确认 parser/路由缺口，
Rovai implementation 为 `NotImplemented`，不能写成 Runtime 不提供能力。`session/load` response 后另有有界
settling/quiet window，迟到 replay 不会污染下一 Prompt。

Skill 三层能力的当前证据如下：

| 能力/路径 | 状态 | 实测边界 |
| --- | --- | --- |
| Rovai managed 项目 `.trae/skills` | `Verified` | 唯一 Skill 在新 Session catalog 出现，精确 `/skill` 调用返回唯一 marker；作为唯一 TRAE delivery group |
| Runtime 项目 `.agents/skills` | `Verified`（Runtime discovery/load） | catalog 出现且精确调用通过；不是 Rovai-owned TRAE 投影路径 |
| Runtime 项目 `.traecli/skills` | `Verified`（Runtime discovery/load） | catalog 出现且精确调用通过；未见公开文档，不作为 Rovai-owned 路径 |
| Runtime 项目 `.coco/skills` | `NotObserved` | 唯一 Skill 未出现在 catalog |
| Runtime 用户 `~/.trae/skills`、`~/.trae-cn/skills`、`~/.traecli/skills`、`~/.agents/skills` | `Verified`（discovery/advertisement）；调用 `Unverified` | 隔离 HOME 均出现唯一 catalog entry；调用环境因 model catalog 为空而在 Prompt 前失败，未据此宣称 load/invocation pass |
| Runtime 用户 `~/.coco/skills` | `NotObserved` | 唯一 Skill 未出现在 catalog |

项目 `.trae/skills` 的同名 `documentation-lookup` 覆盖用户 `~/.agents/skills` 版本，advertisement 与实际响应
都来自项目 marker。扫描发生在 `session/new` / `session/load`：warm Host 的新 Session 能看到刚加入的 Skill，
既有 Idle Session 在 5 秒窗口内没有动态 refresh，cold Host `session/load` 能看到。Rovai 不修改用户全局
目录，并且不把 Runtime 的多路径兼容扫描合并成 managed delivery Verified。Runtime discovery/load evidence
为 `Verified`，Rovai `.trae/skills` managed delivery 为 `Implemented`。

同一源码基线已经把 `PreparedSkillExposure.digest` 写入 ContextManifest，但 Native Session 新建判断仍只核对
Binding identity/generation 与 Session ID，ACP Host compatibility digest 也没有纳入 Skill exposure。由于 TRAE
既有 Idle Session 不 live refresh，这意味着 Skill exposure 改变后禁止直接复用旧 Native Session 的产品
门禁仍为 `NotImplemented`；该缺口不要求一律停止 warm Host，新 Session 或已验证会重扫的 `session/load`
即可保留 Host 复用。

TRAE Machine Ready 现由 Availability Check 与 Dispatch Preflight 共用同一合同：非空 version、当前
executable identity/fingerprint、ACP v1 initialize、成功 `session/new` 与非空 Session ID、非空动态模型目录、
非空 permission/mode 目录，以及 current model/mode 均存在于相应 options 的 Session config shape。两条路径
都不发送 model Prompt、system marker、文件写入/拒绝、sleep/cancel、Tool 副作用或
`session/set_config_option`。这些行为继续作为 Adapter/version/platform 独立资格证据；旧弱 TRAE `ready`
snapshot 会被降级并重新验证。

ACP v1 的 `session/load` 必须 replay history，而 `session/resume` 恢复时不返回旧消息。当前通用 ACP Host 却把
`Resume` 与 `HistoryRestore` 都绑定为 `LoadingReplay`，并在 response 后执行同一 settling/quiet window；
`session/resume` 独立路由为 `NotImplemented`。这项源码缺口属于共享 ACP Host，不是 TRAE Runtime 的私有行为，
也没有据此改写 TRAE 已完成的 `session/load` 实测结论。

Compaction 仍为 `CompactionDetectorPolicy::Disabled`。`compact` 虽在 advertised commands 中，手动
`/compact` 只产生普通 Session updates 与 assistant 文本 `Compaction Completed`；把自动阈值设为 `0.01` 后
发生的重复自动压缩也没有标准 `compaction_update`、TRAE 私有 started/completed method、稳定 occurrence ID
或去重 key。上游文档存在 `pre_compact` / `post_compact` Hook，但项目 Hook 及控制 Hook 在 `acp serve` 下都
未触发。当前结论是 Runtime structured completion signal evidence `NotObserved`、Rovai detector
implementation `Disabled`，不是 `Unsupported`；usage/token 变化、历史长度和模型正文均不参与推断。

### Windows x64 平台准入

v1.05 设计冻结于仓库提交 `0e20ea154eb3110f46d3a18f695dc2217b4e801b` 时，尚无任一 Adapter 完成
Windows 10 22H2/Windows 11 x64 的逐项真实资格证据。2026-08-23 复核既有 Windows 证据并在当前源码树完成
逐 Runtime 两轮 Camp 目标确认后，设置页范围内的十一种 Runtime 已资格化；Pi 另以实验性 Preview 开放，明确不在本轮设置页范围的
`cursor-agent` 仍不准入。下表是当前准入状态，不是本机
`not_installed`、Probe 失败、上游不支持或 Renderer allowlist；唯一产品真源是 Rust Registry 的
[Runtime Platform Admission v2](contracts/runtime-platform-admission-v2.md)投影。

| AdapterKind | `windows-x64` admission | evidence revision | 说明 |
| --- | --- | --- | --- |
| `codex-cli` | `qualified` | `sha256:fe7e375313d4ba0eeefd0ad69304523414ebd2a0bd72efba8814af3732382054` | 两轮纯消息与 Native Session 延续通过 |
| `pi` | `preview` | — | 实验性开放供主动测试；Windows 专属 qualification evidence 仍缺失 |
| `opencode-cli` | `qualified` | 同上 | 回复、终端输出与 Native Session 延续通过 |
| `copilot-cli` | `qualified` | 同上 | 回复、终端输出与 Native Session 延续通过 |
| `claude-code-cli` | `qualified` | 同上 | 两轮、取消与 packaged planned-shutdown 证据通过 |
| `kiro-cli` | `qualified` | 同上 | 回复、终端输出与 Native Session 延续通过 |
| `qoder-cli` | `qualified` | 同上 | 回复、终端输出与 Native Session 延续通过 |
| `codebuddy-cli` | `qualified` | 同上 | MiniMax M3 回复、终端输出与 Native Session 延续通过 |
| `qwen-code` | `qualified` | 同上 | 回复、终端输出与 Native Session 延续通过 |
| `trae-cn-cli` | `qualified` | 同上 | 回复、终端输出、Session 与 warm host 延续通过 |
| `cursor-agent` | `not_qualified` | — | 不在当前设置页范围，且本轮明确排除 |
| `kimi-code-cli` | `qualified` | 同上 | 两轮纯消息与 Native Session 延续通过；本机 ACP terminal 不可用 |
| `antigravity-app` | `qualified` | 同上 | 复用操作员确认的既有成功；当前额度下未重复模型输出 |

公共 Named Pipe、Job Object 或三类 execution-shape 测试只能证明平台基础设施。任一行提升为 `qualified` 前，
必须独立覆盖 discovery、executable identity、authentication、first run、Session continuation、Built-in Tool
v20、Approval、cancellation、final boundary、process cleanup 与 planned shutdown；证据 revision 必须不可变且
digest-bound。

#### 2026-08-23 Windows x64 十一种设置页 Runtime 资格

本轮采用 `operator_directed_two_turn_confirmation_with_reused_windows_evidence`，不是机械重跑全部历史矩阵。冻结的脱敏证据为
[`windows-x64-v1.json`](../qualification/runtime-platform/windows-x64-v1.json)，其字节 SHA-256 即上表的
evidence revision。当前源码基线为 `6842e65018549746eb2139dc348adb1f542299c2`；本机为 Windows 10 Pro
22H2 x64、`10.0.19045`，因此不声明 Windows 11 或 SmartScreen 覆盖。

Claude Code `2.1.86` 在国内 MiniMax Anthropic-compatible endpoint 使用 `MiniMax-M3[1m]` 完成当前树目标确认：
静态 discovery/identity、已配置且已认证的 secret-redacted 凭据、首轮精确回复、同一 Native Session 延续、
结构化 Bash input/output，以及长时 Bash 达到 `in_progress` 后由 `agentRuns.cancel` 进入 `cancelled`；取消后
延迟文件没有创建。既有同版本证据继续覆盖 15/15 Built-in Tool v20、Approval allow-once/deny、zero-send、
accepted-send suppression、tool→final 与打包 App planned shutdown。当前打包候选的计划关机报告记录已接受输入后 Runtime
在 8143ms 自然退出、Job 回收 7 个后代进程、协议 v2 收敛，重启后 fenced Run 恢复为 cancelled 且没有伪造
terminal。凭据、原始 Prompt、本机用户路径、Session/Run ID 均未进入冻结文件。

Codex、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen、TRAE 与 Kimi 都在各自隔离 Rovai Camp 完成两轮；
第二轮与第一轮绑定同一 Native Session。除 Codex、Kimi 使用两轮纯消息外，其余当前可重复 Runtime 还确认了
终端输出投影。Antigravity 按操作员明确确认复用此前成功运行，本次 companion 在当前额度状态下未返回模型
输出；这一限制原样写入冻结证据。Cursor 不在本轮设置页范围，仍为唯一 Windows `not_qualified` 行；Pi 是唯一
Windows `preview` 行。

### 2026-08-21 Windows 10 22H2 本机实施复核

本轮在 Windows 10 Pro 22H2 x64（build `19045.6466`）完成开发态全流程复核。它证明当前代码和下列本机安装
可以进入真实 Runtime、Tool、MCP、Skill 与恢复路径，但不是 `Runtime Platform Admission` 的发布证据：执行时
仅对正在测试的单个 Adapter 使用了开发验收覆盖，正式 packaged Release 对十个 Adapter 仍全部返回
`runtime_platform_not_qualified`。Windows 11、逐项 cancellation/process-cleanup/planned-shutdown 和不可变
digest-bound evidence 尚未形成，因此上表的 admission 与 evidence revision 均不改变。

| AdapterKind | 本机版本 | 本轮认证/模型边界 |
| --- | --- | --- |
| `codex-cli` | `0.148.0` | 已登录账号；Runtime-native 模型目录 |
| `opencode-cli` | `1.18.19` | 本机 DeepSeek Provider；`deepseek/deepseek-v4-flash` |
| `copilot-cli` | `1.0.80` | 已登录 GitHub 账号；Runtime default |
| `claude-code-cli` | `2.1.86` | Claude-compatible DeepSeek endpoint；`deepseek-v4-flash` |
| `antigravity-app` | `1.1.17` | AGY 账号授权有效；最终合并后复跑时 Flash 账号 quota 返回 429 |
| `kiro-cli` | `2.19.0` | 本机账号态；Runtime default |
| `qoder-cli` | `1.1.27`（随后更新至 `1.1.28`） | 已登录 Qoder 账号；验收矩阵使用账号 catalog `deepseek/deepseek-v4-flash-pg` |
| `codebuddy-cli` | `2.137.1` | 官方 `CODEBUDDY_API_KEY`/`CODEBUDDY_BASE_URL` ACP 路径；`custom-local:deepseek-v4-flash` |
| `qwen-code` | `0.21.14` | DeepSeek API key；仅保留 `deepseek-v4-flash` Provider/model |
| `trae-cn-cli` | `0.120.52` | OpenAI-compatible DeepSeek endpoint；`deepseek-v4-flash`，关闭 thinking |

本机验证包含 Rust PR test profile、Rust fmt/Clippy、TypeScript/Vitest/Node tests、Windows x64 unpacked/NSIS/legal
payload 构建与 PE/manifest 验证、clean install/start/upgrade/uninstall/data-preserve。合并前十个 Runtime 的 Built-in
CLI v20、Missing-Send 与 Skill 开发态矩阵通过；合并后七个适用 ACP Runtime 全部通过，Codex、OpenCode、Copilot、
Claude、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE 的 Built-in v20、Missing-Send 和 Skill 复跑通过，九个适用 Runtime
的 MCP Projection 全部通过。Antigravity `1.1.17` 在同一最终复跑中完成静默账号认证，但模型调用返回
`429 RESOURCE_EXHAUSTED`；`GEMINI_API_KEY`/`GOOGLE_API_KEY` 不改变 AGY 的账号 Code Assist quota 路径，因此该项
记录为外部额度 blocked，不归因于 Windows 实现。TRAE 使用当前权威的 `.trae/skills` managed delivery，并另行
通过冷恢复。OpenCode、Qoder、CodeBuddy、Qwen 与 TRAE 的相应模型证据均为 Flash，不使用 DK V4 Pro。开发态
packaged Desktop 以 Claude `2.1.86` 完成真实 planned shutdown：Runtime 在 8123ms 自然退出、7 个后代进程被 Job 回收、协议 v2
收敛、重启后 fenced Run 恢复为 cancelled；Release sidecar 随后按备份 hash 恢复并重新通过 verifier。

CodeBuddy `2.137.1` 还暴露了两项版本差异：Session/model setup 后会在首个 Prompt 前发送私有
`usage_update` 与 `_codebuddy.ai/command` notification。当前通用 ACP 路由已把合法 Idle `usage_update` 作为
Session metadata；本轮只把精确的 CodeBuddy 私有 command notification 加入已知 lifecycle extension。
其他 Adapter 的该私有 method、extension request 与未知 session-scoped message 继续 fail closed。修正后 CodeBuddy 的 ACP
completion/continuation、allow-once/deny、15 项 Built-in operation、Missing-Send（49 个结构化 ACP tool event）、
MCP Projection 与 `.codebuddy/skills` 全部以 Flash 模型通过。

Kiro `2.19.0` 在普通 Ready、MCP 和 Built-in 路径额外发送 `_kiro.dev/commands/available`、
`_kiro.dev/metadata` 与 `_kiro.dev/mcp/server_initialized`。当前 ACP 路由只把这些精确、无 request ID 的 Kiro
notification 认作 Session lifecycle metadata；同名 request、其他 Adapter 和未知 session-scoped message 继续
fail closed。Kiro 的 ACP/Approval、Built-in、Missing-Send、MCP 与 `.kiro/skills` 复跑均通过。

Windows 原生 Skill 投影还验证了 OpenCode/Copilot 对健康 `.claude/skills` 的共享发现：共享入口被项目内容遮蔽时，
reconciler 先退役旧 forwarded observation，再用新 operation ID 建立 Runtime-specific 直接副本；项目内容保留、
重启恢复和 imported Skill 硬删除均通过，不再产生 `skill_projection_recovery_required` lineage 冲突。

最终 `main` 合并后的十 Runtime Built-in 边界还复现了 warm Qwen Host 持有 `.qwen/skills/*/SKILL.md`
delete-sharing handle 时，旧 Windows delete-on-close 语义只标记对象、未立即解除子项目录名，导致下一 Adapter 的
投影清理以 `directory not empty` 失败。Windows file-tree backend 现在优先对已经按 identity 打开的精确 handle 使用
Windows 10 POSIX disposition 立即 unlink，并只在平台/文件系统不支持时退回 legacy delete-on-close；回归同时保留
打开的 `SKILL.md` handle、撤销投影，并验证目录项与 observation 均已消失。修正后的 Qwen→TRAE 同进程边界、
TRAE 独立 Built-in 和十 Runtime Skill 矩阵均通过。

同一轮 Windows Built-in 还修正了 native `rovai.exe --input-file` 的路径边界：Git Bash 继续使用 POSIX
`RUN_TMP` 做重定向，但传给 native CLI 和 `jq.exe` 的文件参数必须显式转换为 Win32 path；CodeBuddy 会设置
`MSYS2_ARG_CONV_EXCL=*`，不能依赖 MSYS 隐式 argv 转换。修正后 CodeBuddy 的 15 项 direct flags/stdin/
input-file、successor exact read、stale conflict、lease fence 与 Native Session continuation 全部通过。Windows
Missing-Send fixture 同时把 PowerShell `$env:ROVAI_AGENT_CLI` 隔离在 Bash 不展开的单引号 payload 中；Qwen/TRAE
使用直接 `cmd.exe` 投递，并明确禁止模拟/跳过 Tool。十 Runtime 的 zero-send、accepted-send suppression 和七个
ACP tool→final 场景由此完成聚合复核。

#### 2026-08-21 用户 Provider 切换后的补充复核

上述完整 Windows 矩阵完成后，用户因 DeepSeek 余额接近耗尽，要求把可使用 OpenAI-compatible endpoint 的
日常 Runtime 切到新 Provider，并提供 Groq 与 Gemini 两组独立凭据。凭据只保存在用户环境、Runtime 用户配置和
桌面私密备忘，不进入仓库或验收输出。补充实测结论如下，它们不追溯改写上方已经完成的 Flash 矩阵证据：

| Runtime / Provider | 补充实测 | 当前边界 |
| --- | --- | --- |
| Groq `qwen/qwen3.6-27b` | 直接 Chat Completions 成功 | 当前账号 TPM 上限 8,000；OpenCode Agent 请求实际要求 16,844–24,776 tokens，不能承担真实 Runtime |
| OpenCode / native Gemini `gemini-3.7-flash` | 单次真实 Agent turn 成功 | Gemini free tier 在 Skills 高频矩阵达到 20 requests 窗口上限；点测成功不冒充全矩阵 |
| CodeBuddy / Google OpenAI-compatible Gemini | 普通 turn 与一次真实 `Read` Tool→final 均成功；请求模型为 `custom-local:gemini-3.7-flash` | 当前可作为日常替代；仍受用户 Google quota 管理 |
| Qwen Code / native Gemini provider | 普通 turn 与一次真实 `read_file` Tool→final 均成功 | 使用 Qwen 原生 Google SDK；OpenAI-compatible 路径不是必要条件 |
| Qoder `1.1.28` BYOK | 手写任意 Groq/Google/custom pool 配置可进入 catalog，但服务端拒绝生成 custom pool；官方向导登记的 DeepSeek Flash BYOK `deepseek/deepseek-v4-flash-pg` 真实返回成功 | 默认已固定到官方 DeepSeek BYOK Flash；直连、ACP、Built-in v20、Missing-Send、MCP 与 Skill 均通过，不消耗 Qoder Credits |
| TRAE / Google OpenAI-compatible Gemini | 首轮模型响应成功，Tool 后续因 adapter 未回传 Gemini 3 `thought_signature` 返回 400 | 改选内置 `Qwen3.8-Max` 后又返回个人 quota limit；不静默回退 DeepSeek |

完成上述补充点测后，用户明确授权继续使用 DeepSeek。本机 OpenCode、CodeBuddy、Qwen 与 TRAE 已恢复
`deepseek-v4-flash`，仍不使用 DK V4 Pro；Gemini/Groq 凭据与调用方式只作为桌面备用。Qoder `1.1.28` 最终改用
CLI 官方向导已经登记并验证的 DeepSeek Flash BYOK 条目 `deepseek/deepseek-v4-flash-pg`，默认直连与全部适用
Rovai smoke 通过；此前手写的无效重复 custom model 已从用户配置移除。Claude 的 Anthropic-style transport 不
伪装成 OpenAI-compatible endpoint。后续若要把新 Provider 结果提升
为完整发布证据，必须在相应账号额度恢复后重新执行原矩阵，而不是复用本次点测。

### Camp Published Attachment View visibility 基线

当前十二个 Adapter 在各自已准入平台统一使用 `generation_fenced_v1`。每次 Camp 附件发布或受控 rebuild 都把
旧 generation 的 Host/Binding 视为不兼容，并在 mutation gate 内停止或 fence；下一次 dispatch 仍只授权同一
Camp 的精确 `attachments` root。该实现选择是保守 fallback，不是 Runtime snapshot 行为的实测结论。

截至 2026-08-20，没有运行或保存符合 Camp Attachment View Probe v1 的 TRAE 正向 `live_append_visible`
证据；既有 TRAE warm Host、Session reuse、HistoryRestore、MCP 或普通文件工具 Probe 都没有验证“同一
IdleWarm Host/Session 在两个可靠 terminal 之间观察由正式 publication gate 原子追加的 file + directory”。
因此 TRAE 不启用 `live_append_v1`，compatibility generation 不能为 null。其他 Adapter 同样没有被旧证据
隐式升级。完整条件见 [Runtime Launch and Verification v13](contracts/runtime-launch-and-verification-v13.md)。

### 2026-08-17 OpenCode Usage 与 Codex Cost Projection

OpenCode `1.18.15` 的官方 `buildUsage()` 把 `inputTokens` 定义为 non-cached Input，并仅在正值时输出
`thoughtTokens`、`cachedReadTokens`、`cachedWriteTokens`。同 tag 的 ACP service 成功 `end_turn` Fixture
返回 Input 100、visible Output 40、Thought 7、Cache Read 11、Cache Write 13；Rovai 因而对该版本声明
Prompt Total、Uncached、Read、Write、Output、Reasoning 和 request cache hit Eligibility，并把省略的三个
可选桶归一为零。字段畸形、版本未知或核心 Input/Output 不完整时仍保持未知。

本机隔离探针进一步确认 Provider 覆盖不能从上游合同反推：

| OpenCode/model | 成功 terminal Usage | 结论 |
| --- | --- | --- |
| `1.18.15` / `opencode/hy3-free` | Input 65193、Output 3、Thought 54、Cache Read 1728；无 Cache Write | 省略的 Write 按已验证 dialect 为 0；不能宣称 Provider 产生过正 Cache Write |
| `1.18.15` / `deepseek/deepseek-v4-flash` | Input 52448、Output 2；无 Thought/Read/Write | DeepSeek 链路成功但未回传 Cache 分类；不能从 cache miss 或长 Prompt 推断 Write |

DeepSeek 探针只在子进程环境复用 Qwen 本机配置中的 secret，未回显、未写仓库、未改变日常 Runtime 配置。
由于本机没有独立 Anthropic API credential，本轮没有获得 Provider 实测 `cachedWriteTokens > 0`；正值回归
明确标记为同版本 OpenCode 官方成功 Turn Fixture，不冒充本机 Provider 记录。OpenCode
`usage_update.cost` 是累计 Session Cost，不进入 Run cost。

Codex CLI `>= 0.145.0` 已有 Input、Cache Read、Cache Write、Output 四桶。当前实现只在模型与 effective-date
价格目录可辨识时生成 `price_estimated / price_catalog / USD` 的 OpenAI API public-price equivalent；
Reasoning 是 Output 子集，不重复收费。它不是 ChatGPT/Codex 订阅实际账单，不包含 Codex Credits、未知
Fast/Enterprise rate、long-context multiplier、regional uplift 或 Tool fee。字段级边界见
[Runtime Usage Monitoring v3](contracts/runtime-usage-monitoring-v3.md)。

### TRAE CLI CN v0.83 准入记录

2026-08-15 在临时工作目录直接启动 `traecli acp serve`，实测版本为 `0.120.52`、build commit
`6756e52a9238b6d493928e55b05127957dbfefb4`、build date `2026-08-12T01:31:30Z`。本次没有修改
用户级 TRAE 配置，也没有把当前模型、Session 或 instruction 路径写为静态产品能力。

| 能力轴 | 实测结论 | Rovai v0.83 边界 |
| --- | --- | --- |
| Protocol / auth | `initialize.protocolVersion = 1`；当前登录态 `authMethods=[]`；stdout 仅合法 JSON-RPC | 明确认证错误映射 `authentication_required`；协议/shape 缺失映射 `incompatible`；I/O/timeout 保持 transient |
| Session / model | `session/new` 返回稳定 ID、动态 model select（本次 16 项）和 `default/bypass_permissions/plan` modes；跨 Host `session/load` 通过 | Catalog 每次从 Session 建立；v1.01 新队员默认 `bypass_permissions`，首次真实 Session 缺少该值时配置进入 needs-attention |
| Prompt / cancel | 普通 prompt 返回 `end_turn`；tool 期间 cancel 返回 `cancelled` 且目标文件未出现 | 进入既有 ACP terminal/cancel 边界；第一版 Run 完成后停止 Host，不声称 warm reuse |
| Tool / Approval | `toolCallId` 生命周期稳定；结构化 permission request 的 option ID 可执行 allow/reject | 映射现有 Action/Approval；拒绝后无文件，allow-once 后只有目标写入 |
| External MCP | Session A 通过 `mcpServers` 追加 fixture 并真实调用；同 Host 未配置 Session B 不可见 | 沿用 `AdditivePerRun / RovaiWins`，不新增 Transport、全局配置副本或额外 MCP 隔离层 |
| System prompt / Charter | `append_system_prompt` 实际形成独立 system message，marker Probe 通过；冲突实验中模型仍可能选择 user 指令 | capability 保留为观察证据；正式 AgentRun 沿用 `FirstPayload` Charter，不写 TRAE 配置，也不把 native append 当作唯一正确性边界 |
| Skill / recovery | TRAE 会读取原生用户 instruction，但未证明 Rovai Skill 路径；ACP `end_turn` assistant suffix 稳定 | Skill discovery 保持 documentation-only empty；Missing-Send Recovery 的 zero-send、accepted-send suppression、tool→final 三场景通过 |

脱敏 Snapshot、Probe 步骤和分类限制见
[TRAE CLI CN ACP Probe](research/trae-cli-runtime/probe/README.md)。这组 v0.83 主动 Probe 是历史准入证据，
不代表当前产品会在设置检查、诊断或后台刷新时重放这些进程。

同日定向正式验收通过：`smoke:acp-runtime` 完成 completion、Native Session 续接、Approval
allow-once/deny；`smoke:missing-send-recovery` 在 tool→final 场景观察 8 个结构化 ACP tool event；
`smoke:mcp-projection` 返回 `rovai-projection:trae_cn`。TRAE Host 在 durable terminal 对后继 Run
可见前停止，后继 Host 再以 `session/load` 恢复同一 Session，避免 cwd、权限或 Run 配置跨 Host 延伸。

### v0.87 静态检查与执行期再验证

从 v0.87 起，TRAE 的 `--version`、主动 ACP Probe 和独立登录检查不再用于 discovery、设置页自检、
Installation refresh、诊断或 dispatch preflight。当前 launch policy 只允许真实 AgentRun 启动 TRAE；
静态检查只证明 path、执行位、canonical identity 与 fingerprint，并投影为 `installed_unverified`。

版本仅从进程内解析的 `.app/Contents/Info.plist` 或明确 TRAE main module 的 Go build information 获取；
不存在可信字段时 `reportedVersion = null` 是正常结果。第一次真实任务复用其唯一 ACP Host 的 initialize 与
Session response 更新认证、模型、权限和 capability Ready，随后在同一 Host 继续任务。握手失败不会再启动
诊断或 replacement TRAE process。上游 executable identity 改变时，静态 preflight 先回到
`installed_unverified`，下一次真实 AgentRun 再完成验证。

该规则不撤销上方 `0.120.52` 的准入结论，只改变产品何时重取本机动态证据。其他 Runtime 的启动/重扫执行
Adapter 允许且无副作用的有界版本/身份命令；只有命令成功、输出未超限并识别到基础身份才写
`light_ready` 静态证据。深检由显式单 Runtime 检查或首次真实任务触发；Adapter policy 仍可进一步收窄目的。
规范边界见 [Runtime 进程与校验不变量](architecture/foundational-invariants.md#runtime-process-verification)、
[Runtime 进程与校验不变量](architecture/foundational-invariants.md#runtime-process-verification)、
[Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)与
[Runtime Launch and Verification v4](contracts/runtime-launch-and-verification-v4.md)。

### 2026-08-17 TRAE 启动轻检与用户授权检查复核

v1.03 按 [Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)调整当前产品边界，
不改写上方 v0.87 的历史理由。本机 `$HOME/.local/share/trae-cli/trae-cli --version` 在一秒内成功
返回 `trae-cli version 0.120.52`、build commit `6756e52a9238b6d493928e55b05127957dbfefb4`；启动与 rescan
因此可以建立 `light_ready`，其含义仍只是 executable 可选择和尝试。

同一安装通过 `AvailabilityCheck` purpose 完成真实 ACP initialize/session/new，并在 2.79 秒内形成 Ready
snapshot 所需的非空模型与 permission descriptor。该 Probe 使用 `permission_mode=default`、空 MCP 与隔离临时
cwd，没有发送 session prompt、工具或模型请求；完整 Prompt/Approval/cancel 兼容性仍以上方准入记录和专项
Smoke 为准。Health、Installation refresh 与 dispatch preflight 继续被 launch policy 拦截。当前规范入口为
[Runtime 平台安全不变量](architecture/foundational-invariants.md#runtime-platform-security)与
[Runtime Launch and Verification v5](contracts/runtime-launch-and-verification-v5.md)。

### 2026-08-17 Kiro trust-all 与 TRAE 最高权限默认复核

本机 Kiro CLI 2.16.1 的 `kiro-cli acp --help` 明确输出
`-a, --trust-all-tools  Auto-approve all tool permission requests`；正式 Host 因而使用 Host-scoped
`trust_all_tools=on|off`，其中 `on` 精确映射 `--trust-all-tools`。Health Probe、设置页检查和 discovery
继续不传该 flag。官方 Kiro CLI 文档同时确认 custom Agent `allowedTools` 只对列出的工具免确认、支持有限
pattern，但不支持用全局 `*` 表示全部免确认，因此产品不通过拼接 `allowedTools` 猜测 trust-all。

TRAE 当前 Ready snapshot 已广告 `bypass_permissions`，静态 descriptor 从 v1.01 起允许在
`installed_unverified` 阶段保存该值，新队员也默认该值。该结论不把静态 Installation 升级为动态 capability
证据；首次真实 Host 仍必须用 Session 返回的 mode catalog 重新验证，缺少保存值时阻断后续执行。

### 2026-08-17 ACP Session 隔离与 TRAE warm Host 修正

当前实现已把 TRAE 加入 ACP Fleet LRU：兼容 Host 在 AgentRun terminal 后保持 IdleWarm，后继 Run
轮换 Built-in Tool lease 后直接复用同一 Host 已持有的 Native Session。冷 Host 依次选择
`session/resume` 或 `session/new`；TRAE 正常 AgentRun 不再使用会重放历史的 `session/load`。
本机 `0.120.52` 的 initialize snapshot 只声明 load、未声明 ACP v1 resume，因此它在 warm 命中时
直接复用，Host 冷却或被淘汰后建立新 Session。

所有 ACP Host 同时增加 route lifecycle 和 Prompt fence。`session/load` 仅保留给明确允许的 legacy
Adapter，且其 replay 只能在 `LoadingReplay` 阶段被隔离；对不上 Host instance、AgentRun、execution
epoch、Native Session、Native Prompt 或 Delivery 的事件，不得进入 Evidence、Action、Usage、
Missing-Send Recovery、Compaction 或 Renderer。匹配 `session/prompt` request ID 的 response 是唯一
ACP input ACK 权威；无 Prompt correlation 的 `session/update` 与 permission request 不再提前确认。
当前规范入口是 [Runtime Launch and Verification v5](contracts/runtime-launch-and-verification-v5.md)。

2026-08-17 使用本机真实 TRAE 执行 `ROVAI_ACP_SMOKE_ADAPTER=trae-cn-cli pnpm
smoke:acp-runtime` 通过：completion、allow-once 写入与 deny 三个连续 AgentRun 使用同一
`hostInstanceId` 和同一 Native Session；批准写入内容正确，拒绝写入未创建文件。该结果同时验证
TRAE terminal 后进入 LRU、后继 Run 直接复用 warm Session，以及历史 replay 未进入后继 Run 的
Evidence、Action 或最终输出。

### 2026-08-18 TRAE exact-ID Provider Resume 与 cold HistoryRestore

使用同一次 ACP `session/new` 返回的精确 Session ID 重新执行三组有界协议 Probe。普通
`traecli acp serve --permission-mode default` 在约 0.9 秒内响应 initialize；
`traecli --resume=<exact-id> acp serve --permission-mode default` 与
`traecli acp serve --resume=<exact-id> --permission-mode default` 均在 30 秒内没有响应 initialize，stderr
为空且进程仍存活。两组均使用 `=` 显式赋值，没有使用 `AUTO`，因此已排除 pflag `NoOptDefVal` 把 Session ID
解析成位置参数的可能。当前 `0.120.52` 不能启用 Provider Resume。

同一构建既有跨 Host `session/load` marker Probe 仍为正向证据。当前实现因此按
[Runtime 恢复与关闭不变量](architecture/foundational-invariants.md#runtime-recovery-shutdown)选择 same Host、ACP resume、受控
HistoryRestore、New；load 前 route 为 `LoadingReplay`，成功 response 后才发送当前 prompt。历史
assistant/tool/permission/usage/server request 全部静默隔离，并受 4096 event、8 MiB、30 秒限制。
workspace、模型、权限、Host config 或 executable fingerprint 不兼容时不尝试 load；错误 ID、协议异常或
超限持久记录 continuity lost、停止 Host、轮换 Binding 并建立新 Session。当前规范入口为
[Runtime Launch and Verification v13](contracts/runtime-launch-and-verification-v13.md)。

隔离 Core smoke `pnpm smoke:trae-cold-resume` 进一步通过：首个 Host 的工具读取随机私密 marker 后删除
源文件并重启 Core；新 Host 使用同一 Native Session ID 恢复 marker，Host ID 明确变化，恢复 Run 投影的
Action/Approval 均为 0。恢复后的新文件工具与 Approval 成功，运行中 cancel 收敛为 cancelled 且目标文件
不存在。随后把隔离数据库中的 Session ID 改为不存在值再次重启，Core 持久记录一次 continuity lost，换用
新的 Session ID 并成功完成当前请求。

### 2026-08-19 当前语义勘误：TRAE 统一深检生命周期

上方 v0.87 与 2026-08-17 记录关于“Health、Installation Refresh、Dispatch Preflight 不启动 TRAE”以及
`installed_unverified` 首次 AgentRun 验证的内容，是当时版本的历史证据，不再描述当前产品语义。v1.11
发布后修正使 TRAE 与其他 Product Runtime 一样参加 Installation Refresh、Health Probe 和 Dispatch Preflight；
`light_ready` 可以保存 runtime-default 与静态 permission descriptor，但正式 AgentRun 必须先统一达到
`ready`。旧 `installed_unverified` 只可读取，不再进入 onboarding、配置或执行。真实 TRAE acceptance/smoke
继续串行，第三方密钥/状态文件竞争由测试调度解决。

上面的 2026-08-20 定向复核新增了 asynchronous metadata、Skill discovery/invocation、Compaction 与统一
Machine Ready 证据，但没有冒充重新运行完整 Built-in CLI/MCP/Approval 矩阵。统一 launch-policy、fake ACP
Health/Dispatch 与持久化回归测试拥有当前产品行为；当前规范入口为 [Runtime Launch and Verification v13](contracts/runtime-launch-and-verification-v13.md)
和 [Runtime Catalog Boundaries](architecture/runtime-catalog-boundaries.md)。

### 2026-08-17 Runtime command output 协议修正

通用 ACP Adapter 现在消费标准嵌套 `type: "content"` Text block，并把 Terminal block 视为展示边界，
不把 `terminalId`、Diff 或未知结构投影成 command output。只有没有公开 Content Text 时，才从
`rawOutput` 顶层白名单字段 `stdout`、`stderr`、`output`、`text` 提取文本；其他字段仍只参与私有摘要，
不得进入 `runtime.action.payload.output`。OpenCode、GitHub Copilot 与 TRAE 的固定 `printf` smoke
断言已加入 `smoke:acp-runtime`；`ROVAI_ACP_COMMAND_OUTPUT_ONLY=1` 可在 command output 结算后停止，
仍保留默认完整 approval/write/deny 回归。脚本现在会在 Run 前显式应用自身声明的 `ask/off/default`
权限；此前只声明但未写入成员配置的漂移已修正，OpenCode 完整 allow/deny 回归随后通过。

Claude Code 保持 `--output-format stream-json --include-partial-messages`，但现在同时消费 partial
`tool_use`、完整 assistant tool block 与对应 `tool_result`。生命周期直接使用 Claude 原生 tool-use ID；
Bash、Read、Edit、Write 等只映射到既有 Canonical Activity kind，Bash result 仅公开标准 Content Text
或明确的 `stdout`/`stderr`；Bash `tool_use.input.command` 是唯一公开 input 白名单，因此没有输出的
Bash 也保留可展开的命令详情，其它工具输入、文件内容和 provider metadata 仍不公开。最终 `result`、
Usage 与 Session 校验路径没有改变。确定性 stream fixture
已证明 partial/full 去重、start/terminal 关联、command marker 可见及私有字段不泄露。真实 smoke 还会
强制原生 `Bash` 执行固定 `printf`，并要求 command marker 同时从对应 started
`runtime.action.payload.input` 和 terminal `runtime.action.payload.output` 取得、原生
tool-use ID 存在且 Session/Conversation 连续。公开 `text_delta` 现在另行投影为 `agent.text.delta`；若整次
Run 没有该公开 delta，只用通过 Session/terminal 校验的 success `result` 生成一次 narration fallback。
原始 `thinking_delta`、失败 result 与 provider metadata 不进入 Evidence，最终 Camp Message 仍由 terminal
result 独立结算。真实 smoke 的两次无工具回复同时要求 narration marker 可见，避免“最终消息存在但处理
过程为空”的 Claude-only 缺口回归。

Antigravity 的健康探测仅在 `--help` 同时声明 `--output-format` 与 `stream-json` 时发布可选
`output.stream_json` capability；冻结为支持的 AgentRun 才追加 `--output-format stream-json`，从 NDJSON
`init`、`step_update`、`result` 事件建立 native step 生命周期。command step 只公开 `tool_info` 中的
`stdout`、`stderr`、`output`，不使用私有日志、workspace diff 或最终文本猜测内部工具。旧版或未声明
能力的安装继续走原有 text/run-level 路径。本机 `agy 1.1.13 --help` 的只读检查确认当前安装声明该能力；
结构化与旧版回退两条独立进程 fixture 均通过。真实 smoke 还会强制原生 `run_command` 执行固定
`printf`，并验证结构化 step identity、同一 AGY Session 续接、AGY→Codex 换绑和私有日志清理。

同日使用隔离 Core data-dir、managed Skill Library 和 Git workspace 完成五组真实模型复核：

| Runtime | 实测版本 / model | 原生工具与固定输出 | 关联与结论 |
| --- | --- | --- | --- |
| OpenCode | `1.18.15` / `opencode/big-pickle` | terminal/Bash；`ROVAI_OPENCODE_CLI_PRINTF_OK\n` | command output pass；完整 ask/allow/deny pass |
| GitHub Copilot CLI | `1.0.79` / `claude-sonnet-5` | shell；`ROVAI_COPILOT_CLI_PRINTF_OK\n`，另含 exit-code terminal 状态 | `allow_all=off` 下审批 1 次；pass |
| TRAE CLI CN | 当前安装、静态版本按策略为 `null` / runtime default | Bash；`ROVAI_TRAE_CN_CLI_PRINTF_OK\n` | 审批 1 次；pass |
| Claude Code | `2.1.220` / runtime default | `Bash`；`ROVAI_CLAUDE_PRINTF_OK` | 原生 tool-use ID 与同 Session/Conversation continuation；pass |
| Antigravity | `1.1.13` / runtime default | `run_command`；`ROVAI_AGY_PRINTF_OK\n` | 结构化 step ID、同 Session continuation、AGY→Codex handoff；pass |

这些结果直接来自真实 Runtime 的公开协议事件和 canonical `runtime.action`，没有使用私有日志、workspace
diff 或最终回复文本补猜 command output。验收未启动、停止或替换 `/Applications/Rovai AI.app`，也未接触
日常数据库；一次实测不扩大为其他版本、模型或未上报事件的能力结论。

### v0.89 Transport v13 当前基线

当前字段级合同已推进到 [Built-in Tool Transport v14](contracts/builtin-tool-transport-v14.md)，固定十五项
operation；在 v12 的 `member.create` 之外新增异步 `team.gather -> rovai gather`。catalog、CLI
help/projection、幂等重放、Gather completion、Evidence 脱敏和十 Runtime qualification 脚本均已完成
确定性门禁与脚本对齐。

2026-08-16 使用隔离 Core data-dir、Skill Library、Git workspace 与 Native Session 执行 v13 真实模型
matrix。完整 pass 都覆盖十五项 canonical operation、三种 Send 输入、Gather captured return、唯一 Completion
Delivery/Run、stale-version conflict、旧 lease fencing、后继三条 exact read 和新 lease。结果不是 10/10：

| Runtime | 本轮版本 / model | v13 结果 | 结论 |
| --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | 完整 pass；38 条首轮 Evidence，投影缩减 56.7% | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | 完整 pass | pass |
| GitHub Copilot CLI | `GitHub Copilot CLI 1.0.79` / `claude-sonnet-5` | 完整 pass | pass |
| Claude Code | `2.1.220` / runtime default | 完整 pass | pass |
| Antigravity | `1.1.13` / runtime default | 完整 pass | pass |
| Kiro | 当前安装未解析 | 显式 executable 下 60 秒产品配置仍为 `resolved=null`，未进入 Run | 本机 readiness blocked |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | 首轮十五项及 Gather/Completion pass；successor 返回 `Insufficient Balance` | 外部余额 blocked |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | 两个独立 fixture 均在零工具调用时返回 `runtime_prompt_refusal` | 外部模型 blocked |
| Qwen Code | 当前安装未解析 | 显式 executable 下 60 秒产品配置仍为 `resolved=null`，未进入 Run | 本机 readiness blocked |
| TRAE CLI CN | 静态版本允许为空 / runtime default | 完整 pass；38 条首轮 Evidence，投影缩减 56.5% | pass |

因此当前可陈述为 `6 full pass + 1 Gather 主闭环 pass 后外部阻塞 + 3 pre-Gather blocked`，不能陈述为
十 Runtime v13 pass。Kiro/Qwen 复测时观测到早于本轮存在的对应 ACP 孤儿进程；这只是本机相关事实，
尚未证明是 `resolved=null` 的唯一原因。Qoder 与 CodeBuddy 的错误来自 Runtime 明确终态，均未出现 Gather
合同断言失败。下方历史表仍只代表各版本当时的实机证据，不能补足本轮缺口。

## 既有九 Runtime Built-in CLI 正式接入证据

2026-08-13 的 v0.67 `pnpm smoke:builtin-cli` 为九个 Runtime 分别创建隔离 Core data-dir、Skill Library
和 Git workspace，并运行真实模型 AgentRun。每个 Runtime 都完成 13 个 canonical operation、16 条目标
Core Evidence、direct/stdin/input-file 三种 send 输入、public-only `--to-user`、Agent+user 双轴发送、
stale-version recovery、完成后的旧 lease fencing 和后继 AgentRun 新 lease。由于当前 Run 的 Context 是
冻结快照，三条新消息的 exact `camp.read(mode="item")` addressing 由后继 Run 验证；这不是同一 Run
读取接受后新消息的伪影。每个 Case 同时拒绝旧/虚构 send input，并验证 compact success stdout 不暴露
`local_user` 或 Notification ID。

同日 `pnpm smoke:skills` 为九个 Runtime 分别验证 `cli-operations` 的复杂协调触发。真实模型从 managed
Skill projection 读取该 Skill，运行 `rovai task create --help` 与 `rovai send --help`，输出 exact
`--to-user`，且没有制造 `rovai task --help`、多余的 `task update` 或
`--request-user-attention` 等不存在/不适用的入口。
该矩阵同时验证七项 official inventory、默认九组和 managed symlink；不是把 prompt 中的静态答案当作
Skill 使用证据。

| Runtime | v0.67 实测版本 / CLI model | 13 项操作 / 三 send 输入 / exact read | conflict / lease fence | continuation | CLI / Skill 结论 |
|---|---|---|---|---|---|
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | pass | pass / pass | logical + native | pass / pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass / pass | logical + native | pass / pass |
| GitHub Copilot | `GitHub Copilot CLI 1.0.79` / `claude-sonnet-5` | pass | pass / pass | logical + native | pass / pass |
| Claude Code | `2.1.220` / runtime default | pass | pass / pass | logical + native | pass / pass |
| Antigravity | `1.1.12` / runtime default | pass | pass / pass | logical + native | pass / pass |
| Kiro | `2.16.1` / `auto` | pass | pass / pass | logical + native | pass / pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass / pass | logical + native | pass / pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass / pass | logical + native | pass / pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass / pass | logical + native | pass / pass |

这张 v0.67 表是前九种 Runtime 的历史真实矩阵，不把 v0.83 新增的 TRAE 冒充为已运行同一轮
十三操作与 Skill 验收。TRAE 的本版定向 AgentRun/MCP 证据单独记录在上节与 v0.83 实施计划中。

九个 Runtime 的 Envelope/Projection 样本分别观测到 57.4%–57.9% 字节缩减；这是 observability
metric，不是兼容性门槛。Antigravity 的 `agent_run.started` 在首轮日志确认前没有 Session ID，因此
联合脚本以随后持久绑定的 `agent_run.native_session_bound` 为准；修复后的专项
`pnpm smoke:antigravity-runtime` 实测两次 Run 使用同一 Native Session。Kiro `2.16.1` 的 focused
`ROVAI_BUILTIN_CLI_ADAPTERS=kiro-cli pnpm smoke:builtin-cli` 复测也证明 successor Run 复用同一
Native Session：Adapter 在终态对外可见前停止持有 Session lock 的 per-Run Host，再由新 Host 执行
`session/load`；smoke 现以 session ID 相等作为硬断言。transport-independent response-loss、
`outcome_indeterminate` 与无 locator stop 继续由确定性 CLI/Core 测试覆盖。

该历史矩阵当时的字段级合同为 [Built-in Tool Transport v8](contracts/builtin-tool-transport-v8.md)，
调用结构以 [Built-in Tool Runtime Architecture](architecture/builtin-tool-runtime.md) 为准。上方九 Runtime
矩阵仍是 v7 的真实模型证据，不能冒充 v8 收窄后的 schema/help/Charter/Skill 教学已经完成实机复测；v8
的确定性测试已证明 catalog digest、三类分离示例与 Antigravity binding replacement。

v0.70 关闭时只有 Codex 聚焦复测：以全新隔离 Core data-dir 和 Native Session 运行 Codex CLI
`0.147.0` / `gpt-5.6-sol`，在内部 handoff 没有新增用户决定、回答或行动时，真实模型读取 exact help
后选择 `attention=omit --to-user`，最终结构化 Camp Message 不含 `current_user_mention`。由于其余
八个 Runtime 尚未运行，v0.70 以 `closed_incomplete` 冻结。

关闭后于 2026-08-13 从 v0.70 最终产品快照 `a6397f32` 构建 Core/CLI，并为每个 Case 使用全新隔离
Core data-dir、Skill Library、Git workspace 与 Native Session，追溯补跑 Built-in CLI v8 和 managed
Skill v8 九 Runtime 矩阵：

| Runtime | v0.70 补测版本 / CLI model | Built-in CLI v8 | managed Skill v8 |
| --- | --- | --- | --- |
| Codex CLI | `0.147.0` / `gpt-5.6-sol` | pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass |
| GitHub Copilot CLI | `1.0.79` / `claude-sonnet-5` | blocked：月度配额耗尽 | blocked：月度配额耗尽，两次一致 |
| Claude Code | `2.1.220` / runtime default | pass（聚焦重试） | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass |

八个 Built-in pass 均覆盖十三项 canonical operation、direct/stdin/input-file 三种 send 输入、successor
exact reads、stale-version conflict、旧 lease fencing、新 lease 与 logical/native continuation。八个
Skill pass 均覆盖 managed projection、私有 marker、exact task/send help、消息局部 attention、重启
恢复、Shadowed 与删除边界。Copilot 两类用例都在接受输入后明确返回月度配额耗尽，故记为外部条件
阻塞，不记 pass，也不归因于 v0.70 产品失败。

这组追溯证据的结论是两类矩阵各 `8/9 pass + 1 blocked`，不是完整 `9/9`。它也不能倒推 v0.70
在关闭时满足发布门槛；版本状态继续是 `closed_incomplete`。完整执行口径和 smoke 假阴性修正记录在
[v0.70 实施计划](versions/v0.70/implementation-plan.md)。

### 历史 v0.47 Transport v4 基线

2026-08-08 的 v0.47 联合矩阵曾证明九个 Runtime 的十三项 Transport v4 操作、冲突恢复与 lease
fencing；每个完整 AgentRun 观察到 14 条 Core Evidence，Envelope/Projection 缩减为 51.1%–51.5%。
该历史证据不能单独证明 v0.67 的 `--to-user`、exact Camp read addressing、精确 help 或
`cli-operations`；这些边界由上方 v7 矩阵接替。

## Missing-Send Recovery Publication

2026-08-12 的 v0.59 验收使用 `pnpm smoke:missing-send-recovery`，为每种 Runtime 分别创建临时
Core `data-dir` 和临时 Git workspace。每个真实 Runtime 都完成：零次 `rovai send` 时由 Core 发布
一条 recipient-free recovery，以及一次 accepted `rovai send` 后抑制不同 Runtime final。六个 ACP
Runtime 还必须用原生文件工具读取请求中未披露的随机 token，再以 `end_turn` 返回该 token；验收同时
要求数据库中存在真实 tool activity，并把实际 ACP 事件交给独立 Node 协议重建器。断言直接读取
SQLite 中的 source Run、author、literal Text、source operation、recipient arrays、Delivery count、
terminal decision 和 `finalCampMessageId`，不以 Renderer 或 stdout 文本代替。

| Runtime | 实测版本 / 模型 | zero-send | accepted-send suppression | ACP tool→final / protocol | 结论 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | pass | pass | 不适用；completed-turn parser fixture pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass | pass / pass（6 tool events） | pass |
| GitHub Copilot | `GitHub Copilot CLI 1.0.79` / `gpt-5.6-sol` | pass | pass | pass / pass（2 tool events） | pass |
| Claude Code | `2.1.220` / runtime default | pass | pass | 不适用；success-result parser fixture pass | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass | 不适用；exact print-stdout marker pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass | pass / pass（2 tool events） | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass | pass / pass（2 tool events） | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass | pass / pass（87 tool events） | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass | pass / pass（3 tool events） | pass |

最终统一报告与六份 ACP 协议 fixture 位于
`<local-output>/Rovai-ai-comparison-2026-08-12/acceptance/missing-send-recovery-v059/final-all-nine/`。
Copilot 默认 `claude-sonnet-5` 的 zero-send 路径通过，但该模型三次拒绝从 Camp 输入执行 shell，因此
不把其模型拒绝冒充 suppression pass；最终统一矩阵为 Copilot Adapter 显式选择同一真实 Runtime
model catalog 中的 `gpt-5.6-sol`，报告记录了实际选择。该模型行为观察不改变 Core 的全 send 抑制
规则，也不以模拟 send 替代 Runtime 调用。

## Copilot Native Turn reconciliation

2026-08-12 的 v0.64 P1 使用 GitHub Copilot CLI `1.0.79`、固定模型 `gpt-5.4` 和 executable SHA-256
`637f85f8c6aa0c1b03ba0949ab2d7dbc705d2f0519802fa92c5493841d93925f`，在隔离 Git workspace 上完成
control、in-flight Host kill、terminal-before-persist Host kill 各两个有效重复。每个 Host B 都只执行
`initialize + session/load` 两次，从未发送 prompt。

| 观察项 | 六个有效样本的结果 |
| --- | --- |
| Host A prompt / 唯一 Tool Call / workspace nonce | 每项均恰好 1 |
| Host B prompt / execution permission request | 每项均为 0 |
| Session history replay | 可重复；Control 重放 Tool Call 与最终文本，terminal kill 只重放 completed Tool Call |
| Provider 生成的稳定 Native Turn ID | 未返回 |
| 机器可判的 Turn 状态 | 未返回；只能记为 `ambiguous` |
| 旧 Turn terminal result / prompt response 重读 | 不可取得 |
| `native_turn.reconcile.v1` | `capability_not_proven` |

history replay 没有造成第二次 Tool Call 或 nonce，但也不能证明 Provider 模型请求 exactly-once；ACP v1
不暴露该计数。该实测是目标 executable/version 的负向 capability 证据，不影响 Copilot 其他已通过的
Runtime admission 能力，也不把 Session load 提升为旧 Turn reattach。协议、逐 case artifact、raw 脱敏
ledger 和 digest manifest 见
[v0.64 P1 实验](versions/v0.64/copilot-native-turn-reconciliation-experiment.md)。

## Claude Code 与 ACP 输入确认

2026-08-11 使用本机 Claude Code `2.1.220` 按 Adapter 的完整参数执行无工具、无 Session 持久化的
`stream-json + include-partial-messages` focused smoke：约 1.4 秒出现匹配请求 UUID 的 `system init`，
约 4.9 秒出现同一 Session 的 `stream_event/message_start`，约 5.1 秒出现 success `result`，最终正文为
`CLAUDE-STREAM-ACK-SMOKE`。当前 Adapter 明确排除 system/Hook/status，只允许匹配 Session 的模型 stream
或 assistant event 提前确认，并保留 success result fallback。该 smoke 只验证输入确认 surface，不替代
上表十三项 Built-in CLI qualification。

OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE 的输入确认由同一 ACP Host 实现。
确定性回归确认 `session/prompt` stdin write/flush 不再直接 ACK；ACP v1 的 agent
message/thought、plan、tool、permission request 与 usage/mode/catalog update 都只有 Session ID，不能单独证明
属于当前 Prompt。只有匹配 request ID 的成功 prompt response 确认 accepted，匹配 error response
结算为 `not_accepted`。这项共享实现不改写上表各 Runtime 的实测版本；上游若改变
ACP prompt response shape，须重新执行对应真实 Runtime smoke。

## Antigravity one-shot 输入确认

2026-08-11 使用本机 `agy 1.1.12` 执行只读 `--print --mode plan --sandbox` smoke：同一份私有日志先后
观察到 `Created conversation`、`Print mode: conversation=...`、匹配 Conversation 的
`Forwarding user message` / `Sending user message`，随后出现
`v1internal:streamGenerateContent?alt=sse` 的 `ResponseID`，最终 stdout 正常返回且进程成功退出。
该 focused smoke 只验证 one-shot accepted marker，不替代上表 `1.1.11` 的十三项 Built-in CLI
qualification，也不据此改写完整兼容性版本。

当前 Adapter 以“匹配 Session 的 forward/send 之后出现 stream response ID”作为进程仍运行时的
早期 accepted evidence；Conversation 创建和本地 forwarding 本身不确认投递。marker 缺失或格式变化
时 fail closed 到原有 terminal settlement；若进程失败且两条路径都无法验证，则保持
`delivery_unknown`。已持久化 accepted ACK 后的生成失败不会降级或重放输入。确定性 fixture 覆盖
response-before-forward、forward-without-response、new/resumed Session、早期 ACK 先于 final、非零退出
和 ACK 后取消；上游升级若改变任一 marker，必须重新执行本节 smoke 与相关 Adapter 回归。

## Native Session compaction detector

2026-08-08 的 v0.48 qualification 对六个目标 Runtime 执行真实 compaction，并观察 Rovai 选择的
官方结构化 surface；v1.27 另以 Kimi `0.32.0` 安装包、官方源码/E2E 和已有手动 wire 建立精确文本
compatibility surface；v1.28 以 Grok `0.2.118` no-leader live wire 与真实产品强制压缩建立 event-ID
structured surface。detector 是 `best_effort` 内部增强能力；此表记录各目标版本的证据强度，不把
detector readiness 提升为 Runtime admission 条件。

| Runtime | 实测版本 | 真实操作与观察 | 当前 admission / transport | 结论与边界 |
| --- | --- | --- | --- | --- |
| GitHub Copilot | `1.0.78` | ACP Session 内真实 `/compact` 触发 Plugin `preCompact`，后续 ACP prompt accepted | one-shot `preCompact`；隔离 `--plugin-dir` | pass；目标 Hook payload 不带 event name，relay command 冻结 expected source；Unix Hook 使用 `bash` 字段 |
| OpenCode | `1.18.10` | server summarize 完成并发出 native `session.compacted` | completed；隔离 native Plugin，prompt 保持 ACP | pass；ACP inbound 本身不转发该 native event |
| Kiro | `2.16.1` | `_kiro.dev/commands/execute compact` 后观察 status `started`、`completed` | 仅 nested `params.status.type=completed`；现有 ACP inbound | pass；summary 不参与 admission 或 evidence digest |
| Kimi Code | `0.32.0` | 手动 `/compact` 产生普通 lifecycle frame；安装包与官方 `main` 证明 native ACP server 把 started/completed/cancelled/blocked 降格为同形 `agent_message_chunk`，自动 compact 可在 turn 内完成；Host fixture 已覆盖 started→blocked→completed | `kimi.acp.compaction.completed_text.v1 / completed`；Kimi-only Prompt lifecycle correlation + idle/detached exact completion route | source-qualified best-effort；started 建 pending，blocked 保持，cancelled 清除，completed 仅在 pending 时 observation 并清除；相关 frame 不进入 final/Missing-Send。wire 无 provenance，模型逐字复现整套 frame 的歧义仍存在；无 Hook/用户配置/token heuristic；真实自动/手动完整 Core observation smoke 待执行 |
| Grok Build | `0.2.118 (1e1687c1cf6a)` | 官方 debug arm 后真实发出 started 与 direct `auto_compact_completed`；completion 带 exact Session ID 与非空 event ID，当前 Prompt 正常完成 | `grok.acp.auto_compact_completed.v1 / completed`；现有 ACP Session metadata route | source-qualified best-effort pass；只认无 request ID、exact Session、non-replay completion 与非负 `tokens_after`，event ID 去重。下一轮同 Session/warm Host 的 Redelivery revision 1 accepted，requested/acknowledged 均为 1；无 Hook、用户配置、summary/text/token heuristic |
| Qoder | `1.1.14` | 真实 `/compact` 触发 `PostCompact(manual)` | completed；隔离 `--settings` Hook | pass |
| CodeBuddy | `2.133.1` | 强制真实 emergency auto compaction 完成后触发 `SessionStart(source=compact)` | completed；隔离 `--plugin-dir` Plugin Hook | best-effort pass；CLI additional settings 未进入 Hook registry。该版本 pre-message compaction 实测绕过 `PreCompact`、`PostCompact` 和 `SessionStart(compact)`，因此存在已记录的 detector coverage gap，不使用 token heuristic 补猜 |
| Qwen Code | `0.21.5` | 真实 `/compress` 完成并触发 `PostCompact(manual)` | completed；私有 `QWEN_HOME` user-scope Hook | pass；HookRegistry 不读取 system Hook，trigger matcher 为 exact match，配置 `*` 后由 relay 校验 trigger |
| TRAE CLI CN | `0.120.52` | advertised `/compact`、手动与自动阈值场景均已运行；只见普通 update/assistant completion text | `Disabled`；无 detector transport | Runtime signal evidence `NotObserved`；ACP 无结构化 qualified lifecycle edge、occurrence ID 或去重 key，project/control Hook 在 `acp serve` 下未触发；不是 `Unsupported` |

Claude Code 与 Codex CLI 的 Bootstrap 位于普通 compaction 不触及的 instruction layer，不建立
detector。Antigravity v0.48 与 TRAE 当前 policy 为 `disabled`，因为尚无合格 compaction lifecycle event；Rovai 不
使用 token 数或 context telemetry 猜测 compaction。detector 建立失败、短暂中断或恢复都不改变 Product
Runtime 的 Built-in CLI 兼容性结论。完整时序与持久边界见
[Native Session Bootstrap Redelivery](architecture/native-session-bootstrap-redelivery.md)。

执行台 display sidecar 与本节 detector 资格独立，但只复用 Rovai 当前已经能够捕获的原生事件；展示功能不得为尚未接入的
Runtime 安装 Hook、Plugin、配置 Overlay，或改变其启动环境。当前展示范围为：

| Runtime | 当前展示 | 现有数据来源 | 可展开内容 |
| --- | --- | --- | --- |
| Codex CLI | 是 | app-server `contextCompaction` | 无 |
| OpenCode | 是 | 已有 managed Plugin `session.compacted` | 无 |
| GitHub Copilot | 是 | 已有 detector Hook `preCompact` | 无 |
| Claude Code | 否 | 当前无展示入口；本次需求不新增其协议接入 | — |
| Kiro | 是 | 已有 ACP compaction status | Runtime 明确给出 summary 时展开 |
| Qoder | 是 | 已有 `PostCompact` observation Hook | summary |
| CodeBuddy | 是 | 已有 `SessionStart(source=compact)` | 无 |
| Qwen Code | 是 | 已有 `PostCompact` observation Hook | summary |
| TRAE CLI CN | 否 | 无可靠信号 | — |
| Cursor Agent | 否 | 当前无展示入口；本次需求不新增其协议接入 | — |
| Kimi Code | 是 | 已有 ACP compaction lifecycle | token、消息数量 |
| Grok Build | 是 | 已有 native extension | token、耗时 |
| Antigravity | 条件性 | 仅现有 Adapter 已收到的明确事件；不新增 Hook | 当前无额外数据 |

因此当前明确接受 Claude 暂不显示 Compact 摘要、Cursor 暂不显示 Compact token；这不改变 Cursor 全平台
`not_qualified`、任何 Runtime 的 detector policy 或 Bootstrap observation/outbox。

## External MCP 兼容性

External MCP Library、Assignment 与 Runtime-native Projection 保持独立。v0.43 已按
[外部 MCP 不变量](architecture/foundational-invariants.md#skills-external-mcp) 删除精确替换模型；下表记录
当前实现通道。代码与确定性测试已经通过，原生不同名保留、同名整项优先和真实 tool call 仍须
完成 Checkpoint 7 实机矩阵后才能作为发布证据。

| Runtime | Projection / 同名策略 | 当前动态通道 | 实机发布证据 |
|---|---|---|---|
| Codex CLI | `AdditivePerRun` / `NativeWinsSkip` | app-server `config/read` discovery + thread `config.mcp_servers` | 待 v0.43 矩阵 |
| OpenCode | `AdditivePerRun` / `RovaiWins` | ACP Session `mcpServers`，保留 native config roots | 待 v0.43 矩阵 |
| GitHub Copilot | `AdditivePerRun` / `RovaiWins` | `--additional-mcp-config` | 待 v0.43 矩阵 |
| Claude Code | `AdditivePerRun` / `RovaiWins` | `--mcp-config`，不使用 strict | 待 v0.43 矩阵 |
| Kiro | `AdditivePerRun` / `RovaiWins` | Custom Agent `mcpServers` + `includeMcpJson: true` | 待 v0.43 矩阵 |
| Qoder | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 strict/allowlist | 待 v0.43 矩阵 |
| CodeBuddy | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 strict | 待 v0.43 矩阵 |
| Qwen Code | `AdditivePerRun` / `RovaiWins` | native `--mcp-config`，不使用 allowlist | 待 v0.43 矩阵 |
| TRAE CLI CN | `AdditivePerRun` / `RovaiWins` | 首次 ACP `session/new.mcpServers`；后续只有 compatibility digest 相同时复用 warm Host/Session | `0.120.52` 原生 Session A/B 追加与不泄漏 Probe、正式 Core smoke 均通过 |
| Antigravity | `Unsupported` | 无不修改 Global/Workspace 文件的逐 Run 动态通道 | 诊断披露；配置页保持中立 |
| Cursor Agent | `Unsupported` | 当前未准入，不注入 External MCP | 完整 authenticated Session 与 same-name matrix 前保持 Disabled |
| Pi Coding Agent | `Unsupported` | 不读取或投影 Assignment；不启动 Server、不注册 proxy Tool；MCP 不参与 compatibility、LRU 或 exact resume | 当前产品接受差异；配置与 Assignment 保留，切换到支持 Runtime 后继续生效 |
| Kimi Code | `AdditivePerRun` / `RovaiWins` | ACP `session/new/resume/load.mcpServers`，不写用户级配置 | `0.32.0` + MiniMax M3 真实 Core smoke 已通过 stdio、Streamable HTTP、同名整项优先与三项 `ready` Manifest exposure |
| Grok Build | `AdditivePerRun` / `NativeWinsSkip` | `0.2.118` 忽略 ACP Session `mcpServers`；Core 使用权限收窄的临时 Plugin 与 process `--plugin-dir`，不写 project/user config | MiniMax-M3 产品 smoke 保留两个原生同名 Server、skip 两个冲突 Assignment，并真实调用第三个不同名 Rovai stdio Server；三项 Manifest exposure 与 cleanup 通过 |

## Grok Build `>= 1.0.0` 当前支持合同

2026-08-25 起，macOS arm64、macOS x64、Windows x64 共用 `grok >= 1.0.0` 最低版本门；这只统一 Runtime
版本合同，不合并三个平台的 qualification evidence。低版本或不可解析版本在 light discovery 中为
`light_failed / runtime_version_below_minimum`；Deep Probe 和 machine Ready 必须观察
`initialize.agentCapabilities.sessionCapabilities.resume` 对象，并对刚创建的 exact Session ID 成功执行一次无
Prompt 的 `session/resume`。只广告但实际拒绝该方法时不得判 Ready。

Grok continuation 为 compatible same-host Session → exact `session/resume` → 一次 continuity-lost replacement
`session/new`。Grok 不再声明或选择 `session.load`，`0.2.118` HistoryRestore fallback 已删除；TRAE、Kimi 等
其他 Runtime 的通用 load 路径不变。新 Session 继续携带 attachment root、Run tmp，并只在
`session/new._meta.rules` 追加完整 Bootstrap；Grok Resume 固定发送 `additionalDirectories=[]`，不尝试更新
creation-time roots，也不重新注入 creation-only rules。`grok-build:resume-v1` compatibility key 继续 fence
官方配置、rules revision、Runtime identity、workspace、model 与 permission，变化时建立新 Session。

macOS arm64 客户端使用 `grok 1.0.5 (5115b46bc909)`。真实 Deep Probe 在 Ready 前完成
`session/new → exact-ID session/resume([]) → session/set_model`；Core 与 ACP Host 重启后，Host ID 改变而 Native
Session ID 和私密 marker 保持，恢复 Run 没有 replay Action/Approval。恢复后的新写入、审批与 cancel 通过，坏 ID
只记录一次 continuity-lost 后 replacement-new。普通 AgentRun、十五项 Built-in CLI、历史 attachment、
`AdditivePerRun / NativeWinsSkip` MCP 和 `.grok/skills` 也在同一 1.0.5 候选上通过。

Windows x64 在 Windows 10 22H2 / build 19045 上以同一 `grok 1.0.5`、独立 executable fingerprint 与
`xai.api_key` BYOK 重新完成真实 Deep Probe、PowerShell 六类 command-output、allow/deny、运行中 Tool cancel、
跨 Core/Host exact-ID resume、坏 ID 单次 replacement、十五项 Built-in CLI/Gather/历史 attachment、
Missing-Send、`.grok/skills`、Plugin MCP 以及隔离 packaged App planned shutdown。planned shutdown 观察到一个
active Grok execution，native stop 返回可靠 `planned_shutdown_cancelled` terminal，App 无 forced signal 退出，
七个已观察后代进程全部回收，重启保持该终态。

macOS x64 客户端以原生 x86_64 `grok 1.0.5 (5115b46bc909)` 重复同级矩阵：Deep Probe、exact-ID cold resume、
恢复后 Tool/Approval/cancel、坏 ID 单次 fallback、Built-in v20 十五项、Skill、External MCP、Missing-Send、六类
Shell 输出和 structured compaction Redelivery 均通过。x64 打包 App 的包内 `rovai app` 自动创建成员和 Runtime，
真实 AgentRun 分别调用 `/bin/bash`、`/bin/sh` 与 `/bin/cat`；三个非空 Tool ID 均从 `in_progress` 收敛为
`completed`，View 为 `succeeded`。受控 App Quit 以 shutdown protocol v2 自然回收 App/Core/Grok/Helper，未使用
forced signal。一次 cold-resume 初始 marker Run 在 Resume 前遇到 MiniMax 空 Tool 名；同一原命令立即完整通过，
原始失败保持 `toolName=null / Tool not found`，不增加 Rovai 特例。

当前三个 adapter-scoped 证据分别为
[`macos-arm64-grok-build-v2.json`](../qualification/runtime-platform/macos-arm64-grok-build-v2.json)、
[`macos-x64-grok-build-v1.json`](../qualification/runtime-platform/macos-x64-grok-build-v1.json)与
[`windows-x64-grok-build-v1.json`](../qualification/runtime-platform/windows-x64-grok-build-v1.json)。初始
`0.2.118` macOS arm64 v1 artifact 保持不可变历史证据；三个当前 artifact 互不继承 evidence digest。

## Grok Build macOS arm64 初始 `0.2.118` 接入证据（历史）

2026-08-24 的 v1.28 qualification 使用 `grok 0.2.118 (1e1687c1cf6a)`、MiniMax-M3 与本机私有
OpenAI-compatible endpoint。生产 Host 直接继承官方 `$GROK_HOME/config.toml` 的 `[models]` /
`[model.<id>]` 配置；mode-0600 `$GROK_HOME/.env` 只向目标进程提供 TOML `env_key` 引用的密钥。Core 不再
定义或翻译 `GROK_MODEL_*` 私有三字段，不覆盖正式 `GROK_HOME`，也不改写用户配置。BYOK Probe 把官方
配置层复制到临时 Home、只经环境传递密钥并选择 `xai.api_key`。无 BYOK 时实现保留原生 Home、选择
advertised `cached_token` 的非交互 account-auth 分支；本机没有 cached token，因此该分支未做真实登录验收。

真实产品链路通过 Deep Probe、标准 `session/set_model`、同一 Native Session 两轮对话与 Fleet LRU warm Host
复用、allow/deny、取消、六类命令输出、Missing-Send、十五项 Built-in CLI 以及 `.grok/skills` 原生发现。
新 Core/ACP Host 用 exact `session/load` 保持同一 ID 并恢复 session marker；17 条 replay event 被隔离，0 Action、
0 Approval，恢复后写入/审批和 cancel 通过，错误 ID 只记录一次 continuity-lost 后新建 Session。该版本不广告
resume，结论为 HistoryRestore。

开发者确认的 v1.28 model-context revision 2 保持 Bootstrap Formatter 3 的完整 bytes 不变。新 Grok Session
把该 payload 只放入一次 `session/new._meta.rules`，首轮及后继 `session/prompt` 均只发送 Dynamic Context；
same-host 与 exact load 不重复注入，replacement new 按新 Binding/generation 注入一次。产品从不发送
`systemPromptOverride`。Grok runtime/history compatibility 增加 native-rules revision 1，旧 `first_payload`
Binding 不复用。

该次历史 compatibility 升版严格限定到 Grok：Grok Runtime payload 使用 schema 5、HistoryRestore key 使用 v3，并含
官方配置摘要与 native-rules revision；非 Grok Runtime 仍使用原 schema 3 且不出现 Grok 字段，TRAE
HistoryRestore 仍为 v1，因此其 canonical payload 与 digest 不变化。

no-leader Probe 与产品链路都观察到 direct `_x.ai/session_notification` structured completion。detector 只接受
`auto_compact_completed`、exact Session ID、非空 event ID、non-replay 与非负 `tokens_after`，并把 event ID 用作
Runtime occurrence identity。官方 debug arm 的真实两轮产品 smoke 中，第一轮当前输出未被 metadata 污染，
第二轮保持同一 Host/Session，并以 Redelivery revision 1 accepted；requested/acknowledged 均收敛为 1。
Usage/Cost 仍保持 Disabled。

MiniMax 可能把 `<think>` 作为普通 ACP agent text 返回。v1.28 不再删除、重分类或延迟 Kimi/Grok 的这类
文本：标准 chunk 原样进入执行台 Evidence、final 与 Missing-Send candidate。该行为与其他 ACP Runtime
一致；资格证据只陈述“观察到上游文本并按 generic path 投影”，不再声称存在私有 reasoning boundary。

External MCP 先得到“Session `mcpServers` 被忽略”的负向证据，再验证 process `--plugin-dir` 的替代入口。
产品 smoke 保留两个 native 同名定义并启动它们，两个冲突 Assignment 记为 skip，第三个不同名 Server 由
MiniMax-M3 真实调用；临时 Plugin 随 Host 删除。项目/用户 config 仍不作为注入通道。

adapter-scoped 初始历史证据位于
[`qualification/runtime-platform/macos-arm64-grok-build-v1.json`](../qualification/runtime-platform/macos-arm64-grok-build-v1.json)。
当前 1.0.5 三平台证据见上方三个独立 artifact；它们都不包含 Key、完整 Native ID、Prompt 或本机私有路径。
原生 Usage/Cost 字段保持 Disabled。

### 2026-08-31 Runtime 图片观察边界

本次接入已有 ACP `tool_call` / `tool_call_update` 的标准图片 block、Claude 的结构化 base64 Tool Result、
Codex MCP content 和原生 `imageGeneration`。ACP 以 toolCallId 增量累积，在 completed/failed 才提交；
Codex 原生字段依据上游 app-server `ImageGenerationItem` 的 `result` / `savedPath`，inline 内容不因 path 存在而丢弃。
初始阶段完成了协议提取、epoch/Session fence、本地生命周期和隔离 Electron Gallery 验证。
随后经用户授权，本机已真实执行 Codex / Antigravity 原生生图，并用实际队员配置检查其余 Runtime。

Antigravity 1.1.22 的 stream-json 只给出 generate_image 参数；其本机只读 step API 返回 generatedMedia。
现已接入精确 conversation/step 的只读查询，原生 JPEG 入库/读取通过，稳定路径不复制。
TRAE 0.120.52 的 builtin Output 与 Copilot 1.0.79 的 binaryResultsForLlm 已按真实 wire 补齐；
Codex、Antigravity、Claude、OpenCode、TRAE、Copilot 六种 Runtime 的图片结果通过隔离 Core 入库/读取。
Qwen 当前 ACP 只回文字；CodeBuddy/Kimi/Grok 本机工具配置没有返回图片；Kiro/Qoder 本机 Prompt 上游失败。
Cursor 本机仍为不支持 ACP 的旧版，不升级、不提高准入资格，也不猜测非标准通知中的建议路径。
各构建、真实生图与读图的区别、失败边界见 [v1.37 验收记录](versions/v1.37/runtime-image-acceptance.md)。
本观察能力不改变 Session、Usage、活动分类或 Built-in/External MCP 资格。规范见
[Runtime Images v2](contracts/runtime-images-v2.md)，状态见 [v1.37](versions/v1.37/implementation-plan.md)。

## 历史：内置 MCP / Antigravity 专项复核

以下记录只解释 v0.30–v0.32 当时的实现和证据，不能作为当前运输合同，也不表示旧 MCP
实现仍被保留。Antigravity 当前与其他八个 Runtime 一样使用 bundled CLI。

| 复核日期 / 版本 | 已观察证据 | 当前实现结论 | 仍需复核的边界 |
|---|---|---|---|
| 2026-08-01 / `agy 1.1.9`（v0.30 历史证据） | 专属 Plugin 可启动无凭据 MCP；Bridge 是 `agy` 直接子进程；macOS kernel peer PID/start/parent/path 可读取；当时的精确 `mcp(rovai_team/post_message)` 在真实 headless model call 生效；调用 `_meta` 有稳定 conversation/progress identity；Bridge 崩溃后 `agy` 不重启；真实 A→B→A 与普通终端负例通过 | 证明 Attested Bridge 拓扑与无凭据进程绑定可行，不证明 v0.32 `call_member` 协议 | 该历史证据自身不能证明新 alias、Schema、Return Obligation、Outcome 或自动 Resume；v0.32 复核见下方，不能改写本行冒充新协议实测 |
| 2026-08-02 / `agy 1.1.9`（v0.31 历史证据） | packaged Core 上真实模型依次完成 13 个 canonical Team/Context/Memory tool receipt、A2A leaf、Task version 2、Context Summary、1 个 Memory Revision、1 个 pending Hearth proposal 与 Core restart 无重复；普通 `agy` 的 `tools/list` 为空、13 个 direct call 全为 `run_not_bound`、领域写入为零；同一 Core 上 Codex `0.146.0` 与 OpenCode `1.18.5` 的十三工具回归通过。修复配置的 CAL-001 又真实完成 Context/Memory/Task/Team reply、文件编辑与测试，四角色以 7 AgentRun / 6 A2A 在原预算内收敛 | 增加 `BuiltInMcpToolParity::Complete`；十三条 exact permission bundle、catalog/protocol/Schema/Session compatibility 与统一 Core handler 已落地。AGY execution/attachment workspace、Prepared Binding 授权、非交互权限和 final-output 结算已修复；Qualification 显式使用 per-run skip-permissions。该结论只表示内置工具运输与语义对等，不提升 External MCP，也不改变 `PreservedUncontrolled` | 原始 `delivery_unknown` 有效失败仍保留；修复后校准为 valid pass，但十二次自主 Trial 尚未运行。`sandbox=on` 与 auto-approved bypass 不是严格安全隔离。上游 CLI、模型、Plugin/权限格式或父子进程行为变化后仍须整套复核 |
| 2026-08-02–03 / `agy 1.1.9`、Codex CLI `0.146.0`、OpenCode `1.18.5`（v0.32） | 新 `call_member` Schema 分别在真实 Codex→Codex 与 AGY→AGY Smoke 上完成 A→B→A；重启后无重复物化。普通未绑定 AGY 的 `tools/list` 为空，13 次直接调用均为 `run_not_bound`。随后 Team Pack revision 4 校准通过，12 个正式 Trial 共观察到 72 Run、60 Member Call、30 显式 Return、30 completed Task；12/12 协作审计、12/12 同成员单槽、0 轮询，4 个 Trial 直接捕获忙时 pending Input | v0.32 breaking alias、持久 Input、显式 Return、忙时 FIFO、自动 Resume、Attested Protocol 3 与 Alias Map 2 已获得跨三种 Runtime 的正式执行证据。OpenCode 使用 `opencode/big-pickle`；此前 `north-mini-code-free` 的真实 Spike 漏掉 Task、测试和返回，不再作为默认 tester | safe Core Outcome 和 pre-materialization Outcome 已由事务/集成测试覆盖；本轮正式 Trial 全走显式 Return，仍需专门的真实 Outcome/重启 Case。正式 Pass Rate 4/12，功能 6/12、边界 10/12、协作 12/12；协议可用不代表最终业务整合稳定。`sandbox=on` 与正式 Runner 的 skip-permissions 仍不构成严格安全隔离 |

前两条是 v0.30/v0.31 历史协议证据，第三条才是 v0.32 breaking protocol 的真实 Runtime
复核。编译、单元/集成测试和静态契约仍不能替代这条实测；反过来，一次真实显式 return
链路也不能替代 Outcome、取消、容量与 crash 分支的确定性测试。

这些历史证据不证明当前 CLI 合同；旧 Plugin、Bridge、permission bundle、`rovai_team`
保留名与 ambient built-in MCP attachment 都已在 v0.42 删除。单工具历史验收见
[v0.30](versions/v0.30/README.md)，完整十三工具与 Qualification 结果见
[v0.31](versions/v0.31/README.md)。

## 未接入候选与 Settings Preview

普通调研候选不应出现在 `AdapterKind`、数据库 kind、Contracts、设置选项或运行时健康目录。
ADR-0189 只允许 Runtime 设置页追加严格 presentation-only 的 Preview；Preview 不改变本文件的
准入结论，也不进入任何 Core surface。

| Runtime | 调研版本 / 状态 | 观察结果 | 当前边界 / 未接入原因 | 复核条件 |
|---|---:|---|---|---|
| Cursor Agent | 2025.09.18-7ae6800 | 支持 headless 与 resume；已验证入口会读取项目 `.cursor/mcp.json` | 尚无稳定的逐 Run additive channel 与同名证据 | 上游提供动态追加入口并完成 native preservation、同名与恢复复核 |
| DeepSeek Harness | Settings Preview；未实现 | 仅显示名称、图标、`待支持` 与 disabled 状态；没有 executable、Adapter、Probe 或 capability 结论 | Renderer-only preview，不属于 Product Runtime Catalog | 取得明确入口和协议后，完成 Adapter、认证、Session、终态、取消、Approval、Tool ID、MCP、Activity、Migration 与真实 AgentRun 准入 |

## 后续准入规则

- 新增 Runtime 的 built-in tool 准入要求真实模型能执行 bundled `rovai` CLI，并通过固定命令、
  十三项调用、旧输入负向、冲突 recovery、Envelope Evidence、lease fencing 与后续 AgentRun 验证；具有 shell/
  bash 能力但尚未通过矩阵，只能视为待验证，不能以理论支持替代证据。
- Runtime 不得通过内置 MCP、native Plugin、stdio Bridge 或 ambient MCP 获得 Rovai built-in
  operations；也不得在 CLI 失败时静默回退到旧运输。
- External MCP 继续以独立的 additive per-Run 投影合同验收；必须证明 native preservation、
  Adapter-specific same-name policy、最终 Exposure 与 Ready 注入失败路径，且不能用于承载或模拟
  Rovai built-in operations。
- 已准入 Runtime 可以担任 Lead；兼容性差异不进入角色系统。

## 官方入口

- [Kiro CLI ACP](https://kiro.dev/docs/cli/acp/)
- [Kiro CLI MCP](https://kiro.dev/docs/cli/mcp/)
- [Kiro Custom Agent configuration](https://kiro.dev/docs/cli/custom-agents/configuration-reference/)
- [Qoder CLI permissions and MCP allowlist](https://docs.qoder.com/en/cli/permissions)
- [CodeBuddy CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference)
- [Qwen Code configuration](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/)
- [Kimi Code CLI ACP](https://moonshotai.github.io/kimi-code/en/guides/ides.html)
- [Grok Build CLI reference](https://docs.x.ai/build/cli/reference)
- [Cursor Agent CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)
- [TRAE Enterprise](https://www.trae.ai/enterprise)
- [Antigravity MCP Servers](https://antigravity.google/docs/mcp)
- [Antigravity Plugins](https://antigravity.google/docs/plugins)
- [Antigravity CLI Permissions](https://antigravity.google/docs/cli/permissions)
