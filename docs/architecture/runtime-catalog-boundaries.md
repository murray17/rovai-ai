---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-10-28
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。Catalog、Installation 与机器状态的长期边界见
[Runtime Catalog 与 Installation 不变量](foundational-invariants.md#runtime-catalog-installation)。主机平台准入由
[Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)与
[Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)拥有；Runtime 启动与延迟验证边界见
[Runtime 进程与校验不变量](foundational-invariants.md#runtime-process-verification)、
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)及
[Runtime Launch and Verification v65](../contracts/runtime-launch-and-verification-v65.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 原生提问边界

问卷承载用户输入，不能进入执行审批来选择答案。Claude、Copilot、Qwen 在统一正式启动处关闭已验证的
提问工具；Copilot、Qwen 策略属于 Host 兼容输入，不改变原生会话绑定。Kimi 与 Qwen 的意外请求复用 ACP 当前请求归属、
Prompt 观察与终态，先识别并取消，再让普通权限进入现有审批。已识别但损坏的问卷也不能自动允许。
Claude 控制通道拒绝意外问卷并把观察传到现有整轮结果校验；不新增用户回复或自动重跑机制。
具体字段与优先级见 [Runtime Launch v67](../contracts/runtime-launch-and-verification-v67.md)。
MiniMax 保留现有行为，不以修改用户配置关闭问卷；本轮不扩大到其他适配器。

## Antigravity 执行边界

Antigravity 适配器通过 `--print-timeout 0` 等待原生整轮结束，保留独立的初始化与清理期限。
原生超时返回的部分文本不能凭零退出码成为完整成功；精确失败证据与错误合同见
[Runtime Launch v64](../contracts/runtime-launch-and-verification-v64.md#antigravity-整轮执行时限)。

## 四层权威

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | closed `AdapterKind` 与 Rust `AgentRuntimeAdapter` Registry | 全局产品身份与 Adapter interface | 某个平台已验证、机器状态、未接入候选或 roadmap |
| Runtime Platform Admission | Rust Adapter Registry 的 `AdapterKind × HostPlatformKey` 矩阵 | 某平台上的 discovery/check/Installation、成员选择、AgentRun、诊断与 Migration 准入 | 当前机器是否安装/登录/Ready、Renderer roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery、静态身份或 deep-verification snapshot | light ready、checking、legacy installed unverified、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份、把静态可尝试误作深检 Ready 或静默 Runtime fallback |
| Settings Runtime Preview Catalog | Renderer 内受审查的静态 presentation rows | Runtime 设置页中的名称、图标、`待支持`文案和 disabled 状态 | Contracts、Core request、数据库、成员选择、诊断、Probe、AgentRun 或支持数量 |

Product Runtime Catalog 当前包含二十种已实现 Adapter。Preview 与它不是“同一目录的另一种状态”；
Renderer 当前不展示 Settings Preview row。DeepSeek Harness 通过官方 ACP profile 接入；macOS arm64、macOS x64、
Windows x64 与 Linux x64 分别绑定平台专属证据并取得 qualified。
产品目录的机器可判数量、全量检查、诊断分母和
普通执行仍只来自逐平台 Admission。Cursor 与暂缓公开的 Cline 保留 closed identity 和历史 reader，但不进入
Settings Runtime Preview Catalog；隐藏该 row 不删除持久 identity，也不改变未准入状态。普通成员 Runtime
selector 同样不展示 Cursor 与 Cline。Hermes 在 macOS arm64/x64、Windows x64 与 Linux x64 均普通开放；
Command Code 在 macOS arm64/x64、Windows x64 与 Linux x64 均为 Preview。成员选项继续经过 Runtime Platform Admission，Renderer 不另建平台白名单。

`enabled`、`qualified` 与 `preview` 可以进入 Product Runtime Availability；`enabled` 不宣称完整资格，
`preview` 在内部保留缺失资格证据，用户界面不显示资格记录未齐备的提示。
`qualified` 行只在有实际 reported version 时显示版本副文案，否则仅显示居中的产品名，不再回退到静态
“稳定 / 测试 / 实验性”标签。当前主机平台在目录标题旁统一显示，机器状态徽标继续来自 Availability。
`not_qualified` 按目标平台显示“Windows 尚未验证”或“当前平台尚未验证”，`unsupported` 显示平台不支持。
后两者不产生 discovery、Installation、Probe 或普通机器状态。既有未准入配置
可以原样读取并在修改无关队员字段时原样保留，但不能修改 Runtime 子对象、重新保存默认值或执行。

<a id="command-code-研究接入边界"></a>
## Command Code ACP 实施边界

`command-code-cli` 以官方 1.88.0 为基线，接入只有用户原生 HOME、官方 `--mod`、标准 ACP
与现有共享 Fleet。Adapter 不复制认证/配置、不镜像 HOME、不遍历原生 Mod/MCP，不管理用户原生历史。
完整字段与行为见 [Runtime Launch and Verification v72](../contracts/runtime-launch-and-verification-v72.md)。

共享 Fleet 对 Command 显式采用 Native Binding 身份策略：所属范围、成员、Binding ID、canonical cwd
一致且进程健康空闲时复用。配置摘要、安装 generation、程序指纹均不参与其复用或恢复判断；历史摘要仍可读。
Command 的入口/指纹验证和必要刷新只在 Fleet cold spawn 执行；warm 仍保留显式禁用/删除安装准入。
显式启动设置和 MCP 实际修改走既有 invalidation，MCP 只影响有效工具变化的成员；增减成员不影响保留
成员，关闭 Server 的修改和无变化保存不退役。保存先释放配置/数据库锁，再等待 Fleet；安装命令 replay
与已达到目标值的保存不重复退役。
忙碌进程结束后退役，新 Host 保留精确旧 Session ID。
成员环境保存也只使用本次操作的实际变更事实；仅改 JSON 排版和命令重放不退役 Host。
外部原生配置变化不触发扫描、比较或隐式新 Session；其他 Runtime 的策略不变。

Bootstrap 的 `managed_system_prompt` 语义不变：完整冻结 B 经官方 `appendSystemPrompt({state})`
追加到原生 System，user 只有 P。每 Host 一个 Mod，正文通过已有 ACP 的 `/rovai-bootstrap` 控制命令
保存在 Mod 内存；初始化只校验一次 revision/局部 nonce/PID 归属并删除 ready 文件。没有 Bootstrap
正文文件、HOME fallback、专属池/锁/缓存。原输入确认见 [revision 5](../versions/v1.72/model-context-change-command-code-acp.md)；
其中旧物理交付描述由 v72 替代，冻结内容、选择、上下文版本和证据边界不变。
每个 Run 发送前交付该 Run 已冻结的 B，控制成功后才发送业务输入；warm 与 cold 使用相同交付时点。
控制失败停止准备，不使用旧正文继续执行；控制回复不形成业务终态或用量。
成员编辑不回写正在执行的 Run；后继 Run 使用其准备的新身份，同 Run 重试仍用原冻结字节。
不比较历史正文、不触发 Host 退役或额外补发，也不另建冻结管理器；具体时点见
[实施记录](../versions/v1.72/command-code-native-simplification.md#成员身份与长期指令何时生效)。
大小预算只作用于正文，不因 JSON 转义增长而拒绝有效内容。状态检查与其他 ACP 共用错误分类和脱敏，
不将认证、协议或网络错误统一改写成 provider 配置提示。

分配 MCP 经 `session/new|load|resume.mcpServers`，原生同名配置由 CLI 自动优先。1.88 原生 stdio 使用
Session cwd；默认／相同目录直接传 command/args，只有不同 cwd 使用现有 argv launcher，不额外扫描目录。
env/header 按 1.88 实测在 wire 边界转义一次以保留解析值；warm 不运行额外 CLI。
冷恢复直接携带保存的精确 Session ID 调用原生 load/resume，不做 `session/list` 前置查询。
采用原生尽力恢复，不额外证明历史完整；1.88 静默接受缺失 ID 的可能性保留，认证/网络错误不冒充缺失。
显式模型来自真实 ACP 目录，ID（含 provider 前缀及碰撞别名）原样传递；不使用 `acp --model`。

同一 Mod 在 `onSessionStart` 从当前 active tools 中移除 `ask_user_question`，官方过滤器负责隐藏
schema 与拒绝调用，不追加 fallback 或原生问卷界面。Skills 发现复用共享代码的 user/project
`.commandcode/skills`、`.agents/skills` 来源；原生同名选择由 CLI 拥有，不生成投影副本。

Migration 185 的闭集 identity 与既有历史保持。2026-10-25 按 User 要求开放 macOS Apple Silicon、Intel 与
Windows x64，Linux x64 随独立目标机验收后开放；四行均采用既有 Preview 准入，可发现、配置、检查和执行；最低版本仍为 1.88.0 稳定版。
Cline 的暂缓公开不变。Preview 不代表完整平台资格验收通过；不绑定虚构证据，
不显示常驻实验标签。Linux 取舍见 [V1.72-D61](../versions/v1.72/decisions.md#v1-72-d61)，macOS/Windows 取舍见 [V1.72-D60](../versions/v1.72/decisions.md#v1-72-d60)。旧 1.74.1/1.79.1 BYOK
目录缺口属于历史证据；1.88 的原生证据与尚未覆盖范围见[实施记录](../versions/v1.72/command-code-native-simplification.md)。
官方 1.88 Windows 原生 ACP 的 MCP executable 含空格路径／复杂 argv 限制在不经过 Rovai 时同样可复现；
普通 `node` 与简单参数可用。拒绝写权限会阻止文件修改，原生可能直接结束该轮而不发公开最终回复，
此时 Core 如实报告缺失最终输出。上述边界不通过修改上游包、复制原生配置或新建进程机制掩盖。

## Cline 实施边界

Cline 仅使用用户选中或正常发现的官方 `cline --acp`，协议 `acp-v1`，复用共享 ACP Client/Host/Fleet。
Native Hub、WebSocket、discovery、私有登录后端、完整历史搬运和 compaction 注入已退出。
无固定版本门槛、认证 Provider/字段白名单、凭据副本、独占锁或账号强制 cold。
用户原生来源由同一安装认证与刷新；必要静态 Key 参数仅做原生 BYOK 适配，Rovai 不变更端点或凭据。

冻结 Bootstrap 仍由原生不可变 System Rule 提供，user 只有 Dynamic Context；原生只读观察保留稀疏数值。
同名 MCP 按既有策略只投影一条路径；当前安装未使用 ACP mcpServers，保留 Host 私有原生配置。
成功 apply_patch/editor 仍为 reported_mutation，run_commands 原生失败不伪报成功；不扫磁盘补造 Diff。

warm 使用正常 Fleet，cold 按广告能力 session/load/resume，重放进入共享 quarantine 后才允许新 prompt。
旧 Hub Binding 通过不兼容替换推进 generation，公开历史和原生历史保留，不迁移隐含上下文、不重发旧输入。
通用进程账本仍可回收退役后端的已确认自有进程，但不保留可启动 Hub 的兼容实现。

2026-10-09 按 User 99 暂缓公开：撤回 macOS arm64 Preview，所有平台为 NotQualified；Settings、
新手引导、成员/Skill 选择、安装引导与监控筛选均不提供 Cline。既有身份、配置、公开历史及证据可读，不迁移或删除用户数据。
保留官方 ACP 实现供后续补齐原生能力，普通发现、检查和执行仍服从共享 Admission。
原因是已安装 3.0.70 的 ACP 仍未交付原生 compaction 配置；普通 CLI 的自动压缩不能当作 ACP 能力。
方法、Rule、认证、模型请求与冷恢复的既有证据按实际安装保留。当前范围见
[Runtime Launch v54](../contracts/runtime-launch-and-verification-v54.md#cline-official-acp)、
[ACP 退役验收](../research/cline-runtime/acp-retirement-2026-10-08.md)及
[输入说明](../versions/v1.72/model-context-change-cline-acp.md)，理由见
[V1.72-D30](../versions/v1.72/decisions.md#v1-72-d30)与
[V1.72-D31](../versions/v1.72/decisions.md#v1-72-d31)。

## 可执行准入

新增 Product Runtime 必须原子建立：

1. 稳定 wire identity、可执行发现和 Installation/Migration closed kind；
2. 由统一 purpose-scoped launch policy 管理深检，并对协议、认证、必需 capability 与 transient failure 诚实分类；
3. 冻结模型、权限、Session、MCP、cwd 和进程策略的 AgentRun Adapter；
4. prompt 终态、cancel、Action/Approval、Tool ID、Runtime Activity 与兼容性证据；
5. 成员配置、Runtime 设置、诊断、测试与文档投影。

图标、版本输出、`initialize` 成功或 Settings Preview 都不能单独满足准入。

Catalog admission 与平台 qualification 是独立轴。`cursor-agent` 已具备稳定 identity、Adapter、Migration、
ACP launch、保守配置与 Renderer projection，因此属于 Product Runtime Catalog；但 macOS arm64、macOS x64
与 Windows x64 都尚无完整行为 Smoke，当前三行均为 `not_qualified`。这不会把 Preview 升级为 Adapter，
也不会让未准入 Catalog row 获得 discovery、Installation、配置或执行语义。

每个 shipped `HostPlatformKey` 还必须逐 Adapter 完成 discovery、identity、auth、first run、Session
continuation、Built-in Tool、Approval、cancel、terminal、process cleanup 与 planned shutdown 证据。三种进程形态
的公共测试只证明平台基础设施，不能替代逐 Adapter 准入。`reasonCode` 是关闭枚举，qualified evidence 使用
不可变 digest-bound revision；TypeScript 不维护第二份矩阵。

## 本机启动设置

Runtime Startup Settings 保存本机程序路径及按 Runtime 隔离的通用环境变量。环境由 Core 私有加密存储管理，
新 CLI 按 Host、可选的 Runtime 通用配置、队员覆盖合并，同名后者优先、不同名追加；删除队员条目恢复下层值。
队员可选择是否继承通用配置，新队员默认继承，升级前非空队员配置保持独立。
已启动进程不受保存影响，旧 Agents 环境不再参与启动/检查，独立只读归档由诊断提供人工迁移参考。

新建 CLI 时合并当时的 Host＋通用＋队员环境，领取 Run 不读取；健康 Warm 复用不读取或解密最新配置。
活着的 CLI 及其工具子进程保持启动环境，重建/冷恢复使用当前配置。环境不进入会话或 Run 历史，
旧快照缺失或损坏不阻断执行；真实队员配置错误只失败对应任务，数据库整体错误仍上报。
进程只在同一 Camp、同一队员的当前会话内复用，继续遵循各 Adapter 的工作目录、恢复与停止策略。
值不进入成员资料、公开命令、工具、事件或诊断导出；Owner 管理面使用遮蔽读取及显式查看。
程序绝对路径仍属于安装发现，不由队员 PATH 偷换。详细字段、CAS、凭据保护、CLI 资格与迁移见
[Runtime Launch v69](../contracts/runtime-launch-and-verification-v69.md)。
正式检查与模型目录使用 Host＋通用配置；保存使相关缓存和旧检查失效，不主动替换 Warm。

### Claude Code 与 Codex 原生配置

原生连接编辑已按 User 要求退出。启动设置拥有路径及通用变量，队员环境由独立私有入口拥有；不读取到表单或编辑
原生地址、Key、连接方式和模型列表，不再观察账号或生成原生目录。移除入口不修改任何已有原生配置，
原生 CLI 继续读取其文件、环境、认证与模型设置。

执行仍保留只读连接摘要、凭据来源引用和输出脱敏，以保持旧快照与 Host/binding 兼容隔离；
内部历史快照名不代表可编辑 API 配置。队员模型选择使用原生目录及能力，不附加编辑器允许名单或
推理强度 fallback。边界由 [Runtime Launch v59](../contracts/runtime-launch-and-verification-v59.md)拥有。

### 受管执行的原生自动记忆

Rovai 管理的 Claude Code 与 Codex 执行关闭 Runtime 原生自动记忆；Rovai Memory、原生会话连续性和项目工程规则保持不变。
该策略不删除既有数据，也不控制 Rovai 之外启动的 Runtime。不新增用户开关、Runtime Home 或文件访问隔离。

Claude 在既有私有临时 settings 文件中合入 `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY="1"`，保留 Fast 三态及其他字段；
普通 Runtime/Built-in 环境合并后，再对该子进程设置同名环境变量。settings 与 Bootstrap 沿用现有文件持有和清理，
不把 JSON 或敏感载荷放入命令行、不改变 Windows shim 的参数检查。用户及项目原生文件不改写。

Codex 在 App-Server 启动参数中无条件传入 `features.memories=false`、`memories.generate_memories=false`、
`memories.use_memories=false` 三个 `-c` 覆盖。新 Thread 不作为记忆生成输入，后续 Session 不自动注入原生记忆；
既有 Thread 的历史资格和历史正文不追溯清理。Thread start/resume 继续追加已有 MCP 配置，不重开记忆开关。

固定修订只进入 Codex Host 的进程兼容摘要，不进入 Native Binding 兼容摘要。旧 Host 按原有空闲替换／Run 完成后退役，
后继 Host 使用原 Thread ID Resume；Claude 同样保留原 Session ID。新版 Core 新建的子进程开始采用策略，
旧 Core、运行中的 Run 不热更新，不为此退出日常 App。

CLI/settings 覆盖仍受原生管理策略约束。明确的参数拒绝或配置加载错误沿用现有 Runtime failure，不能撤销覆盖后静默重试，
也不能清空 Session Binding。已证实的更高优先级冲突明确报告；未知版本或缺少配置字段记为未验证，
不增加每轮版本检测、配置读取或生产准入门禁。`config/read` 与实际请求的对应关系只在隔离验收中核对，
版本、平台与未验证项见[兼容性清单](../runtime-compatibility.md#2026-10-10-关闭原生自动记忆)。

<a id="浅检测与按需深检"></a>

## 安装发现与真实 Host 验证

OpenCode 保持一个产品与 Adapter。显式路径或现有发现顺序确定程序后，在启动准备阶段先取得
与该程序身份匹配的代际：复用健康 Host／现有版本字段，否则有界读取同一程序的版本，再冻结配置。
不新增缓存，不在页面、保存或浅发现中探测，不主动寻找 opencode2，不在失败后换程序。
V1/V2 未知且无法确定必需配置时报告初始化错误；握手冲突在正文前停止，不修补冻结身份或重发。
Host 的程序指纹与 Native Session 的协议／存储来源分别判断，普通补丁更新不自动丢弃会话。
权限保留一般 allow/ask/deny 与 Shell、Skill 放行例外，V2 用原生有序规则覆盖 build/plan，
全局和这两个 Agent 的规则末尾统一拒绝 `question`，由原生过滤模型工具集合；V1 不变。
其他自定义／子 agent 仍有原生规则。问卷策略只进入 V2 Host compatibility，不改变会话绑定。
细节与测试边界见
[OpenCode V1/V2 实施记录](../versions/v1.72/opencode-v1-v2-implementation.md)。

启动、rescan 与主动单项检查共用 Core 的基础 PATH 采集策略：macOS/Linux 使用有界交互式登录 shell，
Windows 沿用 Registry／PATH 规则；只采集 PATH，失败仍走既有回退。主动检查即使旧入口存在也刷新，
同次候选解析与检查进程使用该次搜索环境及 Runtime 通用配置。刷新保留已保存的路径和变量，输入比较、
代次及并发保护沿用原机制。额外 shell 变量通过用户通用／队员配置传递，不增加版本管理器适配。
精确范围见 [Runtime Launch v73](../contracts/runtime-launch-and-verification-v73.md)。

启动只静态解析入口、检查平台与执行条件、保存同次稳定的 fingerprint/file identity，不运行 Runtime。
手动 rescan 保留未知或变化程序的有界版本补读，不执行认证或协议深检；单项检查只检查选中的 Runtime。
发现安装即可保存配置并尝试运行，版本未知不影响普通运行准入。
安装记录不伪造 Ready、认证或能力；旧健康证据只供主动诊断和模型 Picker 参考，已知版本的展示复用单独判断。

已知程序版本复用现有快照保存，独立于健康状态：本次静态发现未读取版本或版本读取失败时，Core
仅在 Installation 路径与当前发现一致、非空 executable fingerprint 匹配时复用已知版本。
搜索代次变化不改变这条取值规则；程序身份变化或缺失时不显示旧版本。快照写入的空版本也不得
清空同一程序已有的版本。设置与队员配置统一使用 Core 的版本投影，不各自回退历史快照。
这不新增检查、轮询、运行准入或第二套持久缓存；字段规则见 [Runtime Launch v64](../contracts/runtime-launch-and-verification-v64.md)。

配置冻结保存精确模型/权限意图，Scheduler 检查工作区、平台、目标及文件身份后启动真实 Host。
真实初始化先确认必要协议、认证、显式模型/选项与权限，再在同一 Host 发送正文。
默认模型不为 Picker 等待完整模型目录。输入接收未知不重放；已有 Fleet 复用、Session 兼容与隔离保持。
运行中的初始化/错误属于当前 Run；修复环境后的新任务重新尝试，不必手动解除历史健康状态。

主动诊断沿用有界 Runtime Check Manager 和进程清理，Probe 前后仍校验目标身份；其结果不授权运行。
Antigravity 的正文只能进入 argv，因此保留有界 help/models 无正文预检；Fast 可选偏好直接进入真实 Host，不再进行资格预检。
特例和字段由 [Runtime Launch v49](../contracts/runtime-launch-and-verification-v49.md)拥有，不扩展为统一健康门禁。

### Machine Ready 与 Adapter 行为证据

历史 Machine Ready 是特定 Probe 的诊断证据，不能替代本次 Host 的初始化。
TRAE 真实 Session 必须确认当前权限模式及所请求的模型选项；默认模型无需额外等待完整目录。
独立 Adapter/version/platform 行为验收继续单独记录，不在每个任务前执行工具副作用或行为测试。

### Runtime advertised catalog 与 managed Skill delivery

ACP `available_commands_update` 属于 Session 建立后的动态 Runtime catalog；它可以在 Idle Session 合法到达，
不得进入当前 Prompt output，也不能因“没有 Active Prompt”标记协议违规。Host 对已知 config/mode/session-info/
usage metadata 与 lifecycle extension 使用同一 SessionMetadata 路由，未知 Idle shape 继续 fail closed。

Runtime advertised command、Runtime Skill discovery/load 与 Rovai managed Skill delivery 是三套证据。TRAE
`0.120.52` 已实测把内建 Slash Commands 和已加载 Skills 一起投影为 `availableCommands[]`；这只证明 Runtime
catalog。Rovai 只有在唯一内容的项目 Skill 同时通过新 Session advertisement 与真实调用、且 ownership/cleanup
边界明确时才建立 delivery group。当前 managed TRAE group 只写项目 `.trae/skills`；Runtime 兼容扫描到的
`.agents/skills`、`.traecli/skills` 或用户目录不因此成为 Rovai-owned 投影目标。

## Camp 队员 Fast 边界

Camp Fast service 拥有可空偏好、保存绑定代次与 Run 冻结。活跃 Claude/Codex 绑定直接显示二态控件，首次保存
在现有事务/表中写入；不依赖版本、账号资格、schema 导出或健康快照。真实 Host 直接传递冻结参数，关闭值
不能因资格未知而丢弃。正常 Host 初始化的原生默认复用现有字段作显示初值，用户选择优先；
未启动或字段缺失时按钮不高亮，内部保持未知且不生成关闭覆盖。普通运行观察只属于对应 Run Evidence/Usage，不反写偏好。
通用诊断、必要的认证/显式模型/权限验证与输入去重保持。没有 Fast 兼容重启、后台查询或新的资格管理器。
字段由 [Camp Member Fast v3](../contracts/camp-member-fast-v3.md)拥有。

## 模型目录缓存与执行事实

模型目录只服务 Picker 和主动诊断，沿用既有 60 秒/24 小时缓存及身份失效规则，不新增缓存或 LKG。
打开 Picker 才按需使用既有有界 Check Manager 刷新；页面打开、Runtime 切换及默认模型任务均不触发目录刷新。
历史目录可用于展示，不能证明当前 executable 支持某个模型，也不能形成运行授权。
刷新只写明确取得的目录证据；失败保留原诊断记录，Superseded 不提交错误身份的结果。

Core 原子保存显式模型和选项的精确意图及静态权限配置；过期、缺失目录或历史失败不阻止保存。
真实 Host 负责原生握手和选项传递，不静默替换或忽略。Claude Code 将已有模型 ID 与可传递的显式选项交给
原生 CLI 判定；不能仅因枚举缺失或目录不包含该 ID 而拒绝正文。其他 Adapter 的原生模型设置协议保持原合同。
默认模型不依赖目录，内部 sentinel 只用于审计和冻结，不向原生 Runtime 发送。

成员配置只拥有模型策略，不拥有某次 Run 的实际模型。使用 `runtime_default` 时，Core 只能从当前
Thread/Session 的 Runtime-native 结构化字段记录首个实际模型，并按 AgentRun execution epoch、default-only、
write-once 持久化；catalog default、请求模型、冻结 sentinel、Usage 或自由文本都不能补推。无观测时 Read
Model 继续表达“Agent 运行时默认”，不会把缺失升级为 Runtime failure；该事实也不反向改写配置或 catalog。

### Claude Code 原生模型目录

Claude Code 通过选中的原生 CLI，以 stream-json 双向控制协议优先发送无 Prompt `list_models`。
只有匹配 request_id 的明确“不支持 list_models”错误才回退一次 `initialize.models`，两次请求共享
30 秒总预算；超时、退出、认证、策略和其他错误不触发回退，不建立能力缓存或最低版本门槛。
精确关联的成功响应 `models` 是候选目录来源，`--help` 只检查命令参数。Probe 继承原生环境与
active PATH，使用 `--no-session-persistence`，不追加 model、settings、权限或 Provider 覆盖。
整个查询沿用 `RuntimeProbeProcess` 的超时、取消和进程树回收。协议读取只限制当前未完成帧，默认
64 MiB、按需增长，通过 Core 环境变量 `ROVAI_RUNTIME_PROBE_MAX_FRAME_BYTES` 配置字节数。
删除 256 KiB 单行和 4 MiB 历史累计门槛；解析完成的帧释放，stderr 继续有界保存并持续消费。
超限完整失败并报告本地读取容量，不截断 JSON 后继续，不作为原生 CLI 拒绝。此规则覆盖复用读取器的
Claude、ACP、Codex 模型／初始化及 Codex 原生配置查询，不删除文件、日志、图片等其他边界。

`value` 保留为选择 ID，显示名称与描述独立；原生单条模型元数据进入统一 descriptor 的
`runtimeMetadata`，包括 Runtime 明确给出的别名、resolved ID 和能力。整份 account/初始化响应不进入
模型目录。只有 Runtime 报告的 effort levels 才能生成选项；不按家族筛选或推断版本。
`system.init` 的当前模型继续作为 Run 观察，不能用它代替目录。

新目录复用统一快照、Picker、缓存和刷新；help 时代旧目录缺少原生 entry 证据，不能再服务选择或作为 LKG，
但保存的队员配置保留。原生成功目录在刷新失败时继续按已有 stale/expired 边界读取，失败不能更新成功时间。
`model.catalog.initialize` 保留为既有持久化能力名，专用查询或兼容查询均可建立该目录证据；查询失败
不制造 Ready，界面独立表达目录不可用。已有模型和选项可原样保存并执行；默认项由用户主动选择，
本期不增加任意模型 ID 输入。正式会话仍完成 initialize 协议／权限握手，但不再据其目录拒绝已有配置。
显式模型 ID 原样传给 `--model`，effort 原样传给 `--effort`；不能传递的键或非字符串选项明确拒绝，
不把未知原生枚举值静默删除。运行时默认省略模型参数。字段与错误边界见
[Runtime Launch v49](../contracts/runtime-launch-and-verification-v49.md)。

## 内部诊断与公开 Runtime failure

任一 Product Runtime 的真实执行失败，以及支持该边界的显式 Availability Check 失败时，Core 可以从 typed Runtime 证据形成
`RuntimeFailureView`。该对象只保存 Runtime identity、origin、phase、稳定 code、安全 summary/detail 与
retryable；完整 error chain、原始 stderr、私有日志、exit status、byte count 和 digest 仍属于内部诊断。
公开 detail 必须先脱敏、去控制字符并有界化，不能包含 Prompt、用户消息、Tool input 或完整 Tool output。

ACP matching Prompt error 至少保留安全数字 JSON-RPC error code 和有界 message。通用 ACP Host 还可以从
精确白名单标量路径提取 Provider detail；接受字符串 `error.data`，或对象中的字符串 `error.data.error`，
并在进入诊断或公开 failure 前复用统一的路径、凭据、控制字符和长度清洗。其他对象字段、非字符串值及完整原始对象一律忽略，
不能由各 Adapter 自行扩展或把原始 `error.data` 交给 Renderer。Prompt activity 与 matching response 已证明
输入 accepted 时，公开 failure 的 retryable 必须为 false，不能用 Provider 可重试分类覆盖 Core 的防重放门禁。
字段与历史读取规则见 [Runtime Launch v71](../contracts/runtime-launch-and-verification-v71.md)。

`runtime` 只表示 Runtime/Provider 明确报错；协议、参数和输出格式问题是 `compatibility`，executable/cwd/
权限/附件目录问题是 `environment`，只有明确 Core 状态、持久化或配置生成证据才能是 `rovai`，否则为
`unknown`。Renderer 不重新分类，也不从内部 diagnostic code 或 digest 推断原因。

`AgentRunView.failure` 和 `ProductRuntimeAvailability.failure` 只投影该安全对象。显式检查可以持久化 Probe
Attempt failure；启动浅检测的瞬时 version failure 仍只用于内部发现，不升级为产品级 failure，也不覆盖
last-known-good。此增量不修改其他 Runtime 的执行路径或 Availability 状态集合。字段级合同见
[Runtime Launch and Verification v55](../contracts/runtime-launch-and-verification-v55.md)。

## TRAE CLI CN 当前边界

`trae-cn-cli` 通过既有 ACP v1 Host 启动 `traecli acp serve`。模型与 permission mode catalog 来自
每次真实 Session 返回；新队员默认使用已验证的 `bypass_permissions`，用户仍可改回 `default`。Session 恢复采用
有界 continuation：兼容 IdleWarm 命中时直接复用同一 Host 已持有的 Session；冷 Host 优先使用声明的
`session/resume`。本机 `0.120.52` 的 exact-ID Provider Resume 协议 Probe 不合格，因此当前下一层为
`session/load` HistoryRestore；所有 load replay 在当前 prompt 前进入独立 quarantine，失败才建立
`session/new`。禁止 `--resume AUTO`、私有 Session 文件解析和最近 Session 扫描。

TRAE 与其他 Runtime 一样只做静态入口发现。用户主动诊断可以运行保守的 ACP 初始化检查，结果只供排障。
配置使用静态声明的 `permission_mode=default|bypass_permissions`，默认值保持现状；任务启动时真实 Session
必须确认所选模式、协议及显式模型选项，成功后同一 Host 执行。历史 `installed_unverified` 不阻断配置或运行。
兼容 IdleWarm 继续按原 Host/Session 规则复用；TRAE 真实验收串行执行，避免第三方密钥或状态文件竞争。

冷 Host HistoryRestore 只在 executable fingerprint、installation/protocol、Host config、canonical workspace、
workspace access/isolation、模型和权限均兼容时尝试。Host initialize 后先把精确 Session route 标为
`LoadingReplay`，再调用 `session/load`；匹配成功 response 是进入 `Ready` 和发送当前 prompt 的唯一 barrier。
恢复期 assistant/tool/permission/usage/server request 均静默隔离，受 4096 event、8 MiB 和 30 秒上限约束；
异常持久记录 continuity lost、停止失败 Host、轮换 Binding 后才以新 Session 继续。

External MCP 沿用现有 `AdditivePerRun`：当前 AgentRun 的冻结 Definition 通过
`session/new` 参数追加；warm reuse 只允许完整 Runtime compatibility digest 相等，因此冻结 MCP Projection
的解析后 Server 集合、cwd 或其他 Host 输入不同时不会领取该 Host；只含 AgentRun ID 的投影文件
digest 不是 Host 输入。不写 Runtime 用户级或 Workspace 配置，也不新增独立 MCP 隔离层；回归必须证明
不同解析后 Server 集合不会命中同一 Host，以及 cwd、权限和 Session 绑定仍由各自 AgentRun 冻结。

TRAE 的 `append_system_prompt` 已实测为独立 system message，但正式集成仍使用首包 Charter；能力存在
不等于模型在冲突场景中可靠服从。Rovai managed Skill 投递只拥有已验证的项目 `.trae/skills`；Runtime
兼容扫描到的其他项目/用户路径不进入 Rovai ownership。Compaction detector 仍因可靠结构化完成信号
`NotObserved` 而保持 `Disabled`，不是 `Unsupported`。Missing-Send Recovery 则只在 zero-send、
accepted-send suppression 与真实 tool→final 三条专项 Smoke 通过后启用，不从“Runtime 已支持”反向推断。

## Cursor Agent 当前边界

`cursor-agent` 复用 ACP v1 Host，并依赖 Cursor vendor extensions。产品优先解析 `cursor-agent`；兼容别名
`agent` 必须先通过 Cursor build identity 校验，避免与 Grok Build 等同名程序碰撞。Host 使用
`<resolved-executable> acp`，initialize 后有界调用 `authenticate(cursor_login)`，再建立 `session/new`。

`cursor/ask_question` 与 `cursor/create_plan` 只能进入唯一 Active Prompt；当前分别返回 skipped/rejected。
三个已知 private notification 保持私有，未知 Cursor request 返回 Method not found。External MCP、cold
continuation、Missing-Send、Usage、Bootstrap Compaction detector 和细粒度 Activity 都没有真实资格证据，保持禁用或
run-level。执行台展示不为 Cursor 修改启动环境、创建配置 Overlay 或追加 Hook；Cursor 当前没有 Compaction 展示入口，
本次需求不新增其协议接入，也不能替代真实 Cursor AgentRun 资格证据。
Cursor Host 完成 Run 后停止，不跨 Run 延伸未证明的进程状态。

项目 `.cursor/skills` 是 Rovai managed delivery target；该结论只建立可清理文件投影，不把上游文档中的
Skill 扫描能力冒充真实 load/invocation pass。当前所有平台未准入，因此普通产品路径不会实际投影或启动
Cursor。Settings 的 Agent Runtime 目录默认不展示 Cursor；closed identity 只用于内部兼容、历史读取和后续实现。
字段级行为见 [Runtime Launch and Verification v55](../contracts/runtime-launch-and-verification-v55.md)，
证据状态见 [Runtime 兼容性清单](../runtime-compatibility.md)。

## ACP Client Terminal 边界

ACP Client Terminal 是 Runtime-specific compatibility capability，不是全局 ACP 开关。Adapter registry 为每种
Runtime 返回 `disabled` 或 `local_bridged`：只有后者才同时在 initialize 声明 `terminal=true` 并在同一 Host
安装通用标准 Bridge。当前只有 Kimi Code 使用 `local_bridged`；其他 ACP Runtime 继续声明 `terminal=false`，
保留各自已资格验证的内部 Shell 路径。

Bridge 只在当前 AgentRun owner、execution epoch、Session 与 Active Prompt fence 内创建本地进程。进程从已
admitted Runtime Host 的 ManagedProcess launch snapshot 派生，继承其 workspace、provider/Built-in 环境和
平台进程树所有权。当前 [Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md) 不再附加 macOS
protected-tree deny。省略 cwd 时使用 execution root；显式 cwd 只要求为已存在的绝对
目录，不做 execution-root containment。原始 application 与结构化 argv 会和请求 cwd/env 一次性交给 Managed Process：
先应用最终上下文，再解析 bare/relative command；Windows `.cmd/.bat` 重新进入 CommandShim identity，而不是 EXE-only
派生路径。Runtime 的 sandbox/permission mode 与操作系统拥有 Shell/文件权限，Core
不再通过 `scoped_path()` 建立第二层 Terminal cwd allowlist。Run cancel、detach、Host EOF/shutdown 与 fleet reap
回收遗留 Terminal，未清空的 Host 不得进入 warm reuse。stdout/stderr 使用有界私有 buffer，Terminal wire、
output 与 error 不进入 Camp message 或 durable Evidence。字段与幂等合同见
[ACP Client Terminal v3](../contracts/acp-client-terminal-v3.md)。

<a id="native-home-probes"></a>

## Grok、Kimi、Kiro 普通 Probe 环境

三者的普通检查沿用正式运行的原生 Home 选择，包括未设置的 Home override；Grok BYOK 不再复制配置。
临时 cwd、Kiro additive agent、既有非交互认证、无消息 Session 检查和有界进程清理保留，不发送 Prompt。
只清理 Probe 自有资源；原生初始化可能联网或落盘，检查不保证模型生成、余额或任意项目配置。
自动化回归与真实模型 smoke 继续由调用方提供隔离环境，详见 [Runtime Launch v49](../contracts/runtime-launch-and-verification-v49.md)。

Kiro 仍通过临时 `.kiro/agents/rovai.json` 与 `--agent rovai` 追加 MCP。Kimi 已按
[Runtime Launch v56](../contracts/runtime-launch-and-verification-v56.md)退役专属 env 文件，普通 Probe 与正式运行都使用原生配置。

## Kimi Code 当前边界

`kimi-code-cli` 通过 `kimi acp` 复用 ACP v1 Host。Provider、凭据和默认模型由 Kimi 的官方
`config.toml` 拥有；Core 不读取、复制、合并或改写它们，也不再读取 `~/.config/rovai/kimi-code.env`
或 `ROVAI_KIMI_CONFIG`，不从私有文件注入 `KIMI_MODEL_*`。旧 env 文件的内容、格式与权限不影响
启动、Probe 或 Host 复用；文件保留给用户自行处理，不自动覆盖官方配置。原生进程环境照常继承。
秘密不进入 Rovai 数据库、Evidence、diagnostics 或公开 command。当前精确边界见
[Runtime Launch v56](../contracts/runtime-launch-and-verification-v56.md)。

Kimi Code 的 ACP compatibility policy 使用通用 Client Terminal `local_bridged` 模式。初始化真实声明
`clientCapabilities.terminal=true`，Shell 子进程由上述本地 Bridge 执行；这不是 Kimi 私有 Shell 协议，也不改变
其他 Runtime 的 Shell 路径。实际 `@moonshot-ai/kimi-code@0.38.0` 发布包的只读复核确认其 exact
create/output/wait/kill/release、4 MiB output limit 与 capability-unavailable 分支；一次性隔离 Home initialize
也返回 0.38.0 且接受 `terminal=true`。确定性 Host fixture 覆盖完整 wire、Run cancellation 与 cwd
校验。macOS arm64 本机随后通过 Homebrew 升级到 0.38.0；隔离开发 App 的 Deep Probe 返回 authenticated/ready，
真实 Camp AgentRun 经两次 Bash 调用读取 workspace cwd 与固定 marker 后成功结束，且未遗留 Kimi/Terminal 子进程。

Kimi 正式 AgentRun 不设置通用 `HOME` 或 `KIMI_CODE_HOME`：父进程已有 `KIMI_CODE_HOME` 时原样继承，未设置时
由 Kimi 使用其原生默认 Home。Core 不复制、合并或改写该 Home 的配置、认证与 Session。普通 Deep Probe
同样继承原生 Home，只保留一次性 cwd；不得把 Probe Session 写入正式 Binding，其行为不能外推为产品
continuation 证据。自动化 smoke 的测试 Home 由调用方隔离。

Kimi AgentRun 正常结束后，健康、quiescent 且 compatibility digest 完全一致的 Host 进入 warm LRU；后继兼容
Run 直接复用同一 Host/Session。Host 被停止、淘汰或失效后，后继兼容 Run 在继承同一用户原生 Home 的新 Host
上优先 exact `session/resume`，只有没有 resume 能力时才用带 replay quarantine 的 `session/load`；返回
Session ID 必须与原 ID 完全相同。v22 创建的 Rovai 私有 Home 不再被新 Host 使用，也不自动迁移或删除；旧
Binding 不可见时沿用一次 continuity-lost replacement。

Kimi/MiniMax 可能在普通文本中返回 `<think>` 块。Core 不再以 provider 或标签推断私有推理：Kimi 的标准
ACP `agent_message_chunk` 与其他 ACP Runtime 一样原样进入 `agent.text.delta`、Runtime Evidence、terminal
final 与 Missing-Send candidate，只应用通用 whitespace trim。External MCP 以
`AdditivePerRun / RovaiWins` 经标准 ACP `session/new/resume/load.mcpServers` 投递，不写用户级 Runtime
配置；完整解析后的 Server 集合进入 Host compatibility，含 AgentRun identity 的 Run-local projection/evidence
digest 不进入，Server 定义变化仍 fence 旧 Host。stdio、Streamable HTTP、同名整项优先、ContextManifest 和
真实模型 Tool call 均已验证。Usage/Cost
保持 Disabled；Compaction 通过 Kimi-only Prompt lifecycle correlation 与 idle/detached exact completion frame
以 `best_effort` 接入。History Restore
仅作为 load-only fallback。异步 command/config
advertisement 只安全路由为私有 metadata，当前没有产品消费者，不作为遗留项。Rovai managed Skill 投影目标为
`.kimi-code/skills`。

本机 `kimi 0.32.0` 使用 MiniMax M3 在 macOS arm64 完成真实 prompt、Shell allow/deny、六类 terminal output、
Missing-Send、cancel 与 cleanup。早期 Built-in CLI `0/15` 是 fixture 在第一项 canonical operation 前错误检查
legacy stdin 非法输入退出码；改为当前 CLI 合同的 `2` 后，十五项 operation、三种输入、Gather、conflict、
lease fencing、exact successor read 与 logical/native continuation 全部通过，共产生 56 条 full-run evidence。
因此 snapshot 声明 built-in transport。macOS arm64、macOS x64 与 Windows x64 当前均为 digest-bound
`qualified`：arm64 由完整 Kimi 资格矩阵准入，macOS x64 由维护者完成平台验收后的独立发布确认准入，Windows
x64 由独立 Windows 资格证据准入。三者都进入普通 discovery、检查、成员配置和 AgentRun 路径。字段级行为见
[Runtime Launch and Verification v55](../contracts/runtime-launch-and-verification-v55.md)，证据状态见
[Runtime 兼容性清单](../runtime-compatibility.md)。

## Grok Build 当前边界

`grok-build` 通过 `grok --permission-mode <effective> --no-auto-update agent --no-leader [--plugin-dir
<private-root>] stdio` 复用 ACP v1 Host。initialize 成功后，BYOK 优先已广告的 `xai.api_key`；没有 BYOK
overlay 时只接受 Runtime 广告的安全非交互默认、`cached_token` 或 `xai.api_key`，不回退到浏览器/device
login。模型目录来自真实 Session，显式模型使用标准 `session/set_model`。

Grok 模型/provider 直接使用官方 `$GROK_HOME/config.toml` 的 `[models]`、`[model.<id>]` 与
`[model_providers.<id>]`；Core 不再定义或翻译 `GROK_MODEL_*` 私有三字段，也不改写用户配置。权限收窄的
`$GROK_HOME/.env` 只作为本机密钥环境源：Core 仅解析官方 TOML 的 `env_key` / `env_http_headers` 引用和
官方全局 API-key 名称，并把对应值注入目标子进程；未引用变量不进入。官方 `api_key` 字段同样兼容。

正式 AgentRun 与普通 BYOK/account-auth Probe 都继承用户原生 `HOME` / `GROK_HOME`。Probe 不复制
官方配置或凭据到临时 Home，只保留临时 cwd 和有界进程清理；原生初始化可能联网或写入 Session 状态。
官方配置摘要同时 fence warm Host 与 Native Session resume。

Grok/MiniMax `<think>` 若由 Runtime 作为普通 `agent_message_chunk` 发出，就与其他 ACP agent text 一样原样
进入执行台 Evidence、Camp final 与 Missing-Send，不做 provider-specific 清洗或重分类。`_x.ai/*`
notification 只作为已知 Session metadata/lifecycle 安全路由。Runtime Fleet LRU 保留 compatible warm
Host/Session。三个宿主平台共享 `grok >= 1.0.0` 最低版本门；light discovery 低于门槛时为 `light_failed`，
普通检查验证必要认证、初始化与当前模型，不演练恢复或重复设置模型；协议声明恢复支持不等于本次实测，
见 [Runtime Launch v64](../contracts/runtime-launch-and-verification-v64.md#单项检查的必要工作)。cold continuation
只调用 exact `session/resume`；Grok 不声明或选择 `session.load` 产品能力，失败后只允许一次 fresh fallback。
其他 Runtime 的通用 load/HistoryRestore 路径不变。

External MCP 为 `AdditivePerRun / NativeWinsSkip`。`grok 0.2.118` 的 ACP Session 忽略 `mcpServers`，Core 因此
在私有 Runtime 目录生成临时 Plugin 并用 process `--plugin-dir` 追加；`grok inspect --json` 已发现的所有
native 名称都保留，冲突 Assignment skip，不同名 Server 可追加，完整集合进入 Host compatibility，Plugin 随
Host 清理。Core 不写 project/user config。managed Skill 投影到 `.grok/skills`。Usage/Cost 保持 Disabled。

`grok-build × macos-arm64` 与 `grok-build × windows-x64` 分别绑定独立、目标主机生成的
adapter-scoped qualification evidence；macOS x64 仍保持
`not_qualified / runtime_platform.qualification_evidence_missing`。

## Pi Coding Agent 当前边界

Pi 目录只是一轮有效观察。Picker 经既有 Check Manager 合并同环境请求，始终使用临时目录探测；
首次无健康快照或共享健康证据失效都不回退完整检查。沿用现有目录 JSON/时间字段，以 sentinel metadata
记录独立安装、程序指纹和环境代次；只按该归属读取，不清除健康 stale_at、失败或推进完整检查成功时间。
原生可归属的 Provider 注册错误使本轮刷新失败，保留旧目录；内部未暴露错误保持未知。fresh 不表示完整性。
缺席条目不删除配置，Pi 刷新或切模不自动过滤已填强度。协议与枚举规则由
[Runtime Launch v55](../contracts/runtime-launch-and-verification-v55.md)拥有。

Pi 是独立 `pi-jsonl-rpc-v1` Product Runtime，不进入 ACP initialize/storage。正式 Host 继承用户 Pi 官方
`PI_CODING_AGENT_DIR`、认证、provider 与 default model；Core 不读取 Claude Home，也不生成 Pi provider 配置。
显式模型来自 `get_available_models`；先完成并核对目标 Session 激活，再用 `get_state` 比较 Provider 与原生模型 ID。
只有真正切模才调用 `set_model`；显式 thinking_level 在必要选模后设置并严格回读，收窄档位视为配置失败。
未指定时保留同模型 Session 激活后的原生值，真正切模接受原生默认行为。没有默认值回滚或额外重启。
Pi 0.84.4 是当前最低兼容版本；
这只定义 identity/version gate，不构成平台资格。

正式 Pi Host 只能以 `pi --mode rpc --no-themes --approve --extension <rovai-pi-host-v7>` 保留 Pi 原生 Built-in tools、Extensions、
Skills、Context files、Prompt templates 与用户 Settings；`--approve` 只信任当前项目，不是 Tool Approval，也不改写
用户全局 trust。Rovai 不提供 `--no-extensions` fallback，任何 Extension
启动错误都保留真实诊断并直接失败。Pi Host 进入统一 Fleet，策略为 `resident_multi_session`：一个 Host 串行服务多个 Native Session，并发 Run 使用
不同 Host。Pi 的复用归属是 Camp + member + 当前会话引用，canonical workspace 仍进入 process digest。
同工作区不允许跨 Camp 或跨队员借用，删除失效仍保留。其他 Runtime 的
Camp/member-scoped identity 不变。创建 gate 按 `(agent_run_id, execution_epoch)` singleflight，registry 锁不跨 IO。
process key 不包含 Session、Bootstrap、Skills、model 或 Prompt；Fleet 以计入容量的 Starting reservation 在短锁内
Reserve，并立即交给 Fleet-owned operation 锁外 Spawn、短锁内 Commit；同 Run/epoch waiter 共享结果且任意 waiter
drop 不影响启动，不同 Run/Runtime 可以并发。Stop 使用短锁 Mark、锁外 reap、短锁 exact-operation Commit，同 Host
共享 completion。Pi Adapter 在任何清理前拒绝 stale epoch，并在创建提交时二次 fencing。MCP Assignment
和配置完全不参与 Pi compatibility 或复用。恢复只使用
Core 私有完整 canonical session file，实际调用 `switch_session` 后核对 full ID/file/cwd；公开 read/event/diagnostic
只允许不可逆 digest。失败 Host 不进 LRU；只有 locator/文件/identity/cwd 或明确 switch target 不可用等
`ResumeContinuityLost` 才最多创建一个 replacement，Host/RPC/model/binding 等失败不降级。普通检查只验证初始
Session 身份、目录归属、扩展和当前模型，不演练新建/切回；仍用 `--session-dir <probe-root>/sessions`
隔离并清理测试 Session。

Windows Pi Host 在自己的启动边界使用 `dunce::simplified` 将可安全表示的 canonical 本地 cwd 转为普通盘符路径，
避免 Pi 默认 Session 目录编码保留 `\\?\` 中的 `?`。Camp、Fleet 与 Session 校验仍使用原 canonical identity；
正式启动继续使用 Pi 原生 Session 目录策略。无法安全转换、仍需 verbatim 语法的长路径、特殊文件名或 UNC/device
路径在 Pi 启动前返回明确兼容错误，不截断路径或静默改指向；Windows UNC workspace 的既有不准入范围不变。
该适配只属于 Pi，其他 native EXE 的 Managed Process cwd 语义不变。

Bootstrap 使用 managed extension 的 `before_agent_start`，在该 hook 位置的 Pi system prompt 后追加当前完整
Bootstrap。该 hook 每轮重新读取 binding，只验证基本结构与 Bootstrap digest；失败只诊断并允许 Pi 继续，不重复
Session/cwd activation，也不验证 Tool/Skill catalog、提交 Receipt 或 abort。Prompt RPC response 只证明 command round
trip；当前 Host owner 精确绑定的第一个 `agent_start` 使用现有 Delivery transition 接受 Input 并只发布一次 started。
Pi 原生 input hook 更早 handled 且没有产生 `agent_start` 时，Rovai 不伪造 started。后加载的原生 extension 仍可继续
改写最终 provider payload，Rovai 不声明完整 attestation。历史 Receipt 表与数据保留，但新 Run 不读取或依赖。
Pi system prompt 不属于压缩的消息历史，compaction strategy 为
`native_system_prompt_preserved`，因此不加入 redelivery requirement 或 observer lease。

managed Skill target 为 `.pi/skills`，但 extension 不再通过 `resources_discover` 追加路径，Core 也不读取
`get_commands` 或证明完整 Runtime catalog；项目原生与 Rovai 投递 Skill 统一由 Pi ResourceLoader 按 workspace trust
发现。Pi 0.84.4 的真实原生 smoke 已调用带私有随机标记的 Rovai managed Skill，并覆盖 Revision 更新、禁用与恢复、
取消分配与恢复、Core 重启、project-owned 同名 shadow、同 Host 相邻 Session 无泄漏及硬删除后的不可见性，因此
Pi managed Skill delivery group discovery 声明为 `Verified`。该等级只证明 `.pi/skills` 投递项的原生发现、调用与
生命周期，不声明 Rovai attestation 完整 Prompt/Context/Template/Extension catalog。v7 extension 不固定 Active Tools；所有 Built-in 与用户
Extension Tool 都按 Pi 原生语义执行。Pi 没有 Rovai Approval、sandbox 或 permission option，公共 permission value
为空对象且 compatibility digest 不含 approval mode。Rovai 消息不是 Pi TUI command input；Formatter 22 payload不解析 `/...`，原样成为
`prompt.message`。当前已授权图片只从 ContextManifest 结构化 attachment refs 取得，以 exact bytes/MIME/order 经
`prompt.images` 发送，schema-2 evidence 直接绑定 Delivery，不存在 Prompt Transform。Pi External MCP
固定为 `Unsupported`：成员已有 Assignment 与全局配置保留，但 Pi dispatch 在 projection 前分流并静默忽略，不读取
server 定义、不启动 server、不注册 proxy Tool、不产生 MCP receipt/approval/diagnostic，也不依赖 `mcp` optional
subsystem。历史 Pi ContextManifest/Receipt 中的 MCP 字段只作历史事实保留；新 Run 与恢复路径不解析、比较或重新激活。
MCP 配置变化不影响 Pi compatibility、Host reuse、LRU 或 exact resume，切换到支持 MCP 的 Runtime 后原 Assignment
继续生效。`abort` 使用普通 pending RPC correlation，调用方超时后的合法迟到 response 仍被消费。第三方
Extension 的未映射交互返回 cancelled/denied，不 poison Host。stderr、startup prelude 与可恢复单条 malformed stdout
进入脱敏 Runtime diagnostic；持续 framing、response identity 或 Rovai-owned binding identity 冲突才 poison Host。
`agent_settled` 是唯一成功边界；Usage 只读 terminal assistant `message_end.message.usage`，未知
reasoning/cost 保持 NULL。

Pi Prompt images 已通过原生 RPC 接入，但结构化 Web Search 与 Camp Fast 当前仍 unsupported/hidden。macOS arm64、
macOS x64 和 Windows x64 各自绑定 Pi 专属 immutable evidence revision，均为 `qualified / reasonCode=null`；普通
discovery、检查、成员选择、Diagnostics 与 AgentRun 对三平台开放，UI 走正式 Runtime 展示且不再标记实验性。
平台晋升不新增 Pi 已明确 unsupported/hidden 的能力。字段级行为见
[Runtime Launch and Verification v55](../contracts/runtime-launch-and-verification-v55.md)，
证据状态见[Runtime 兼容性清单](../runtime-compatibility.md)。

## 队员最高权限默认

Runtime Host compatibility 还绑定 Camp Attachment View contract 4。Scheduler 在 Camp read admission 内完成
full verification；校验失败时释放 read admission，在 bounded write admission 内做一次 Authority rebuild/附件局部
降级并重试。Claim 之前仍检查持久 publication writer intent；存在 unresolved pending/recovery operation 时 Run
保持 queued，已成功 resolved 附件的当前 `recovery_required` 只省略该附件。一次 dispatch 的
Context freeze、Runtime authorization、Host acquire/resume 和 input delivery 复用同一 admission 与 verified
authorization，不能在公平 writer 排队后再次申请 read gate，也不能对同一 View 重复全量扫描。

用户显式选择 Product Runtime 时，Core 的 `memberRuntimeDefaults` 使用该 Adapter 已验证的最高权限值；
descriptor 的保守 `recommendedValue` 不替代队员 draft。静态 descriptor 只拥有配置/admission 语义，不升级为
认证、模型、Session 或动态 capability 证据。

Kiro 暴露 Host-scoped `trust_all_tools=off|on`，新 draft 默认 `on`；真实 ACP Host 映射为
`kiro-cli acp --agent rovai --trust-all-tools`。Probe 与 Runtime Check 不携带 trust-all，
`CoreEnforcedV1 + read_only Workspace` 的 effective launch 也会收窄为不传该 flag。既有成员配置不由
discovery 或迁移扩权；permission schema digest
变化时不能保留旧 Ready，用户必须通过既有 drift 流程显式重存。

Kimi 暴露 Session-scoped `permission_mode=default|plan|auto|yolo`，新 draft 默认原生最高权限 `yolo`；
Runtime-managed AgentRun 通过标准 ACP `session/set_config_option` 投递冻结模式，只有 legacy
`CoreEnforcedV1 + read_only Workspace` 恢复路径仍强制 `plan`。descriptor 的 `recommendedValue=default` 只是
保守提示，不改变 Product default；已有成员保存的
`default`、`auto` 或 `plan` 不由 discovery、升级或 migration 静默扩权。十二种 Runtime 的 exact 默认矩阵见
[Runtime Launch and Verification v55](../contracts/runtime-launch-and-verification-v55.md)。
复用 Kimi Host 时从当前 AgentRun 的冻结配置设置 Session 模式，不继承原 Host 创建时的模式。
Host＋通用＋队员环境按 [v68](../contracts/runtime-launch-and-verification-v69.md) 在进程创建时读取；保存配置不替换
当前 Host。会话重置通过既有 native binding 身份隔离，原生配置与协议兼容判断继续保留，不新增环境摘要。
CodeBuddy 的显式模型通过 Host 启动参数 `--model` 选择，因此它参与进程兼容；Runtime-default
不传该参数，Session/Turn 选项变化不因完整 Run 配置摘要而重启 Host。

ACP Client FS 不把这些权限 descriptor 复制成 Core allowlist。`fs/read_text_file` / `fs/write_text_file` 对当前
fenced Run 只作协议与参数校验，绝对路径按 Runtime 请求执行，相对路径以 execution root 解析；是否能读写、是否
越出 execution root 由对应 Runtime sandbox/permission mode 与操作系统决定。全自动/绕过交互模式下迟到的
`session/request_permission` 只收到 native allow 兼容响应，不创建第二层文件授权；交互模式的 Approval 也不控制
Client FS 是否可执行。

## Preview 呈现与晋升

Preview row 必须同时满足：明确“待支持/尚未接入 AgentRun”、无可点击检查或配置入口、不会进入成员页
或诊断，并在键盘和辅助技术中表现为不可执行状态。此处的 Settings Preview row 不等于可执行 Adapter 的
Runtime Platform preview。当前没有可见 Settings Preview row；DeepSeek Harness 的可执行准入由 Core 平台矩阵投影，不保留 Renderer-only 占位入口。

未来接入时不得把 preview identity 写入 Migration 或原地解释为 Installation。实现必须删除 preview row，
再按完整可执行准入增加新的 AdapterKind 和逐平台 Admission；用户从未保存过 preview 选择，因此没有 preview-to-product
数据迁移。

## 官方 ZCode 当前边界

ZCode 使用独立 Node.js 执行官方 App 自带的未修改内核，不执行 App 主程序。发现绑定官方 bundle，
fingerprint 同时包含内核与独立 Node；PATH 中的社区
CLI 不属于这个 Product Runtime。Core 内的协议翻译负责原生 NDJSON、Session/Input/Turn/Tool identity 与 callback，
已有 AcpHost/Fleet 继续拥有 owner、epoch、停止、LRU；Host 复用以 Camp 为授权边界。Node prelude 的
pipe-owned companion 在 Unix 补充回收原生 detached Bash 进程组；Windows 由原子 Job 拥有全部后代，
以 Job 空集确认退出，不使用 Unix companion。生命周期细节由 Runtime Launch v44 拥有。
内部 ACP shape 不改变公开协议来源。有原生后台任务的 Host 保留 Session/成员关联，禁止跨成员复用和空闲/容量回收；
后台结果走原 Run 的已登记 Evidence 归属，前台 Run 与 CLI 授权正常结束。普通 Probe 沿用原生 HOME/存储，
只隔离临时 cwd/socket，且不发送生成请求；Probe 实测与 Adapter 能力及发布资格分开。

模型与凭据由官方配置拥有。带 `config/provider/zcode-builtin.json` 的新版 App 内核使用 Provider Registry：
Host 注入官方 bundled/personal Provider Config 路径，初始化读取 `workspace/readPresentation`，
创建 Session 时传 `ModelSelection`，显式切换时使用 `session/setModel`；旧版仍沿用只读
`runtimeModel`、App `.zcode/v2/config.json` 的 family 选择与 `workspace/updateProviderRegistry`。
两条路径都不建立 Rovai provider 配置或解密登录文件。新版 app-server 不自动取得桌面 App 的账号
Provider snapshot；当前可独立验收的路径是官方 personal Provider Config 中的 BYOK。
Start Plan 的账号同步、App 内临时人机验证、账号刷新和 Team Plan 动态凭据尚未接入；
配置加载或无消息 Session Probe 不能作为账号生成通过的证据。原生失败终态发布脱敏错误，
不因 `error` 状态误触发断线恢复。旧版个人 Coding Plan 的签名凭据由官方内核处理；
Start Plan 的验证回调仍显式报告未应用并给出操作指引。
图片沿用授权附件路径，由原生 Read 转为模型图片内容；Read 保持读取活动，不形成 Files Changed 或修改 Diff。原生配置变化 fence Host 与 Binding。MCP 合并遵从原生用户/项目优先级，再叠加当前 Rovai Assignment；
warm resume 不刷新 MCP，所以集合变化不能沿用旧 Host。协议、FirstPayload、权限、Usage 与保留能力见
[Runtime Launch v44](../contracts/runtime-launch-and-verification-v44.md)。平台资格与 Machine Ready 分开维护。

托管 `session/create` 和 `session/resume` 均传入 `toolDenylist: ["AskUserQuestion"]`；
这与仅控制无人作答时自动继续的偏好分开。问卷策略只进入 Host compatibility，
不改原生配置或会话绑定；旧 Host 在安全获取时替换，普通权限及计划交互不扩大拦截。
禁用证据与适用版本见 [Runtime Launch v67](../contracts/runtime-launch-and-verification-v67.md)。

Windows x64 与 macOS arm64 分别以平台专属冻结证据标记 Qualified；macOS x64 同时开放为可执行 Preview，
没有 Intel Mac 真机资格。管理页不显示测试、试运行或实验性标签，保留机器检查、错误和具体能力限制；
平台晋升不等于完整 First-Class Checklist 已完成，证据与尚未覆盖范围见[当前实施记录](../versions/v1.57/implementation-plan.md)。


## DeepSeek Harness ACP

`deepseek-harness` 使用 `dsh --profile acp`，最低版本 `0.1.5-rc.2`。CLI 版本与 ACP agentInfo 的桥接版本
分别记录；模型来自原生 grouped configOptions，保留 provider/model 的不透明 ID，reasoning 通过标准
set_config_option 设置并核对。普通 Probe 使用该 Runtime 原生 Home、临时 cwd，不发送模型请求；
认证字段沿用 ACP 握手语义，不证明 Key 可用、余额或模型生成成功。
ACP composition 的 provider/model 是该入口自己的 native default，独立于交互入口的
agent-default-model settings。BYOK 仍通过原生 llm-pi-ai providers 与 ACP profile patch 配置，
Rovai 显式选模使用真实 catalog ID；产品不读取其他 Runtime 的凭据。

DSH 的 `reasoning_effort` 只属于响应中当前选中的 Provider + Model，不向整个目录复制档位或
`currentValue`。其余条目保留“尚未读取”，不等同于“已确认无选项”。现有
`runtime.modelCatalog.open` 可附带 DSH 的 `modelId` 与 `dshSource`，在无业务输入的 Probe Session
选中目标并核对响应身份；返回 `selectedModelId`，通过现有 metadata 的 `dshOptionsResolved` 标注
该模型的选项已读取。仍共用模型准备与目录发布栅栏，不切换业务 Session、不逐个探测全部模型。
目标读取失败保留 Runtime 与上次目录，不将失败解释为无档位；Renderer 隔离迟到的其他目标响应。

DSH 已读取能力累计保存在原有 SQLite 模型目录 metadata 中：`dshOptionsContext` 绑定原生配置摘要、
实际启动环境与可执行文件身份，`dshOptionsObservedAt` 是该模型最近一次成功读取时间。
配置摘要复用原生读取范围与 Web 模型投影；Probe 的临时 cwd 不参与能力缓存身份，业务 Host 指纹不变。
按安装、原生模型 ID、来源与配置上下文匹配后，新鲜期为 60 秒；缓存命中和失败均不延长成功时间。
确认无档位同样缓存。普通目录刷新与目标读取共用事务内逐模型合并，不复活已删除模型，也不跨来源或配置复用。
同一目标、上下文的并发请求进入既有检查队列合并；发布前重新检查环境、配置与安装身份。

目标请求可附带 `cacheOnly: true`，只做本地指纹校验并返回缓存，不启动 DSH；`not_required` 表示
该目标仍新鲜，`deferred` 表示需要重新读取。Renderer 在具体模型选择、参数页重入及窗口重新获得焦点时
先校验缓存，再按需静默异步读取；不设扫描计时器，`runtime_default` 不发起能力请求。
过期但上下文匹配的历史选项立即展示；上下文失配时保留历史但不视为已确认能力。读取不阻塞选择或保存，
不显示独立加载提示；确认无档位且无显式旧值时隐藏控件。失败保留选择与历史并提供重试。
用户在等待期间修改或保存了草稿后，迟到结果只更新能力，不再清理该选择。

执行先核验模型/来源及参数结构，选中目标，替换 Session 的完整 `configOptions`，再以该响应
校验用户显式强度，最后提交正文。明确但不受支持的强度在正文前报错，说明模型、所选值与可选值，
不降级、不换路由或创建 Session 重试。切换响应省略强度选项时清除旧缓存。DSH 冻结配置不从目录
填入默认值；“模型默认”表示删除 override，且不发送额外强度设置。复用 Session 仍执行原生选模，
由 DSH 恢复目标模型的原生默认。其他 ACP Adapter 的参数语义保持。
用户主动切换模型可在确认能力后清除不适用的草稿值，目录刷新不改写已保存选择；读取失败保留
已有选择并支持重试。映射和模型配置表达式继续由 DSH 解释，不新增 YAML 档位解析或固定映射表。

Probe 与执行 Host 共用 `dsh/models.mjs` 模型配置准备插件。最终目录仍来自 ACP 的
`session/new.configOptions`；原生共享 settings、ACP Profile、Home Patch、环境变量与凭据引用由 DSH
按自身规则加载。标准 Web Profile（base + web-app bundles）的 `llm-pi-ai` Provider 配置作为补充，不要求用户先开 Web 或升级旧版。
原生用户配置以完整 Provider 为冲突边界优先保留；普通内置目录条目不构成用户配置。
同名模型继续保留原生 Provider + Model ID，不拼接两条路由的 URL、凭据或模型数组。
不透明配置只停止相应块/Provider 的补充，不求值配置表达式，也不建立持久化来源账本。
首版不复用自定义 Web bundle 引入的模型，显示能力诊断并保留原生 ACP，避免另造依赖解析与跟踪系统。

**DSH 原生迁移期间的 Patch 隔离**：新式 Settings 存在原生导入能力时，插件观察 DSH 自己发起的
导入 promise，先保存私有的非覆盖备份，待逐项写入结束并核对模型部分后才准备补充与兼容参数。
文件改名或握手成功不能代替完成信号。旧式 Settings 不等待迁移；无法确认新式导入完成能力时，
保留原生路径并诊断，不冒险注入模型覆盖。Rovai 不解析旧文件执行搬迁、不重命名文件、不写 ACP Profile，
不读取 `settings.yaml.imported` 作为活动配置，也不另建 DSH Home 或迁移数据库。

补充与 Responses 兼容默认值合成完整的模型配置，通过原生 Loader 的 `Entry.update` 仅在进程内应用；
不能使用会写 Profile 的 `loader.update`，也不能通过 CLI 提前覆盖 `llm-pi-ai.config`。
后者会影响 DSH 导入时读取的配置，可能使旧模型漏导入或临时 Web 模型被永久保存。
`openai-responses` 且没有显式 `compat.supportsStrictMode` 的 Provider 仍获得 `true` 默认值，
普通工具因此发送 `strict: false`。Provider / Model 显式值和其他兼容参数保持原生优先级，其他协议不增加默认。
凭据和表达式留在 DSH 中解析，不进入补丁文件、模型目录或诊断。

Web 补充失败时，最多在业务输入之前撤销一次本次补充，保留原生模型、兼容修正、权限和 Bootstrap。
被拒绝的 Web 选择不能凭同名原生 ID 继续执行。先保护原生用户配置、显式禁用与来源不明的原生块，
再解析 Web 同名 Provider；补充失败名单不禁用 ACP 实际保留的原生模型。Web 整体损坏也不以
llm-pi-ai 的局部 Provider 集合作为全部原生插件的白名单。请求发出后的认证、限流和超时不触发换路由。

目录的现有 runtime metadata 标注 DSH 来源；显式选择以可选的 dshSource（native / web）随现有
成员选择 JSON 与冻结 Run 保存，不新增表或来源历史。旧版无标记选择保留原生语义；显式保存时可从
已有目录元信息补齐，已有标记不会被后台刷新或无关配置编辑改写。执行对照实际准备结果核验来源，
再由真实 ACP 目录验证模型；失效的 Web 选择明确报错，新选择仍可使用同名的原生路由。
来源仅用于内部路由核验，不显示在模型选项说明中；配置异常的简短诊断继续复用现有目录说明，
不增加确认弹窗。

准备结果中的诊断、摘要与输入指纹用于本次启动。准备完成及发布刷新结果前复验输入，过期结果沿用
现有 Superseded 处理；已准备 Host 的后续执行沿用获取/复用入口的配置指纹，不在显式选模时重复
校验全部原始文件。等待准备结果、结果有效性与路由校验仍保留，不增加全局锁或无限重试。
Web 模型文件纳入已有 Host 摘要；可解析的非模型 Web 设置、临时路径与生成时间不引起 Host 重建。
能力检查失败不收窄既有 DSH 最低版本；已运行的 Run 沿用 Fleet 现有退役规则。
实现及验收范围见[当前记录](../versions/v1.72/implementation-plan.md#dsh-native-web-models)。
历史旧版工具请求证据仍见[Responses 工具兼容验收](../research/deepseek-harness-runtime/responses-tools-2026-10-04.md)。

共享 ACP Host/Fleet 拥有 resident_multi_session、租约、LRU 与停止。Run-local MCP evidence 与 Session 模型
不进入进程兼容键；真实 MCP 定义、权限、cwd、原生 settings/credentials/profile 配置摘要变化会 fence 复用。
新会话与 cold resume 使用精确 sessionId；DSH 不支持 session/load 或额外 additionalDirectories。
DSH 的持久 Session 有进程锁；同一复用范围的配置变化先由共享 Fleet 回收不兼容的 idle Host，
确认原进程已经退出后再启动 replacement 并 exact resume。活动 Host 只标记退役，不能抢占其 Run；replacement
等待该 Run 正常结束和旧 Host 确认回收。回收失败会阻断新 Host，不能并行争用锁或退化为 fresh Session。

Bootstrap 沿用已有 managed_system_prompt 交付模式与完整冻结字节。Core 写入 Host 私有目录中按 Native
Session 绑定的文件，官方 systemPrompt section/variable 在每个模型步骤读取，校验 Session 与 SHA-256；
子代理不继承 Camp 成员自身份。没有新增 Context section、字段、选择规则或 formatter/manifest 版本轴。
原生 compaction 保留系统层，因此不增加文本 detector，也不把普通 assistant 文本当压缩完成信号。

原生 tools/result 的同步只读 observer 为同一 Session/call 写入一次性结构化观测；Core 在共享 ACP ingress
关联后消费。只补已知工具类型、文件路径、shell exit/signal/timeout，以及官方 write/edit 结果已经给出的完整
文件状态，不改变 Runtime 的模型可见结果。`write` 要求 `after` 为受限字符串，`before` 可以是受限字符串或显式
`null`；后者证明文件此前不存在，并转换为标准 ACP Diff 的 `oldText: null`。`edit` 的 `before`/`after` 都必须是
受限字符串。完整文件状态继续由通用 Runtime Diff、Files Changed 与 Diff Card 消费；缺少字段（不同于显式
`null`）、类型错误、超限、无变化或不可用时只保留路径级活动，不伪造计数。
缺失 observer、身份不匹配或重复消费时停止该 Host；未知工具维持 other，不从自然语言猜测结果。临时文件随 Host 回收。

工具名只在协议入口归一为通用语义：`bash/pwsh → execute`、`read/read_image → read`、`write → write`、
`edit → edit`、`glob/grep → file_search`、`web_search → web_search`、`web_fetch → fetch`、`skill → tool`；
未知名称继续保持 unknown/other，不建立 DSH 专属展示。

Skills 使用 `.dsh/skills` 与原生项目/用户来源追加；MCP 使用标准 session/new/resume 的 scoped stdio/HTTP
参数。stdio command 按冻结 Runtime PATH 解析为绝对路径；官方 scoped tools restriction 隐藏被覆盖原生
同名 Server 的全部 Tool，避免原生独有 Tool 穿透 whole-definition 替换。
权限使用原生 `sandbox_mode` 与 `approval_policy`，只关闭会重写这两个独立参数的交互式 preset 插件，原生
settings 文件不变。队员页、持久值与 Host patch 使用同一原生名称和值；Workspace access 不覆盖它们。
DSH 原生 sandbox/approval 拥有决定权：Core 只展示并原样返回 Runtime 实际发出的审批请求与选项，不按 MCP
工具名、副作用注解或 read-only 状态合成 allow/deny/ask。当前 DSH 未为某个 MCP 调用发出审批时，Rovai 不增加
第二层 guard；同名遮蔽仍只是 MCP 配置投影。不借用其他 Runtime Home，也不扩张附件写权限。

ACP usage_update 的 used/size 仅形成 context gauge。官方 committed assistant/message 与自动
compaction/summary 的逐调用 usage 通过私有 observer 按 Session/turn/seq 归属并一次性消费。摘要从
compaction/start 的原生 compactionId/owner turn 取得归属，不收集正文；空闲手动压缩的 null turn 不归入
后续 Run。input 为 uncached bucket，独立保留 cache read/write、
output 与 reasoning。缺失字段与 cost 保持 unknown，不从占用或模型文本估算。逐轴差异、真实行为证据及
平台范围见 [DSH Parity Matrix](../research/deepseek-harness-runtime/acp-0.1.5-parity.md)；macOS arm64 与 Windows x64
使用独立自动化目标主机证据，Linux x64 同样独立闭合 14 轴；macOS x64 记录维护者目标主机验收与发布批准。
四个平台各自绑定 digest，不能用一行证据替代另一平台；Machine Ready 继续逐机 fail closed。


## MiniMax Code ACP 实施边界

`minimax-code-cli` 对应独立的 `@minimax-ai/code` / `mcode acp`。沿用共享 ACP Host、Fleet、
精确 Session continuation、Run 冻结、审批、Action、Usage 和 Built-in CLI，不新增进程池或上下文副本。
Migration 205 将 schema 154 升为 155，只扩展 Runtime 与 Skill group `minimax` 的闭合集合。
macOS arm64 开放 Preview，保留 `qualification_evidence_missing` 和空 evidence revision。
macOS x64 按 2026-10-18 User seq43 的验收确认标记 Qualified，绑定独立的
[维护者确认记录](../../qualification/runtime-platform/macos-x64-minimax-code-v1.json)摘要。Linux x64 与
Windows x64 分别经独立目标机验证进入 Qualified，各自绑定
[Linux 证据](../../qualification/runtime-platform/linux-x64-minimax-code-v1.json)和
[Windows 证据](../../qualification/runtime-platform/windows-x64-minimax-code-v1.json)。
各平台资格不增加未记录的目标机结果或继承其他平台证据。
实现和实测边界见[接入对照](../research/minimax-code-runtime/README.md)，
初始 Preview 取舍见 [V1.72-D50](../versions/v1.72/decisions.md#v1-72-d50)。

完整 Bootstrap 通过私有 `--append-system-prompt-file` 追加到原生 System。文件由 Host 持有，
相同内容继续复用；内容真实变化时替换 Host，并恢复同一 Native Session。Bootstrap digest 只参与
Host 兼容判断，不成为 Session 恢复资格。Dynamic Context、Steer 与同 Run 恢复继续使用既有准备字节。
原生系统提示独立于历史，策略为 `native_system_prompt_preserved`；Linux 的手动、自动、checkpoint
overflow 重试、Core Run 取消及 cold 恢复实测范围由独立准入记录拥有，不外推原生管理命令取消。
Windows 私有 Bootstrap 目录沿统一 private storage DACL 准备；Skill 的模型可见路径去除无需保留的
verbatim 前缀，冻结 sourcePath 和 canonical 身份不变。Usage cwd 比较仅规范化等价 Windows 路径。

模型 ID 原样保留 Provider、模型和 variant 的不透明组合，通过 `session/set_config_option` 选择并
校验 ACK。`thinkingEffort` 只属于原生实际广告的模型；探测某候选失败不抹去可用的目录或原生默认。
普通检查只读取初始 Session 的当前模型参数，全模型参数由现有完整目录请求读取；健康成功不替代目录
成功，也不覆盖同一有效身份下的完整参数，见 [Runtime Launch v64](../contracts/runtime-launch-and-verification-v64.md#minimax-健康结果与完整参数目录)。
权限采用原生 process scope `permissionMode`，会话模式采用 `default/plan`；前者参与既有 Host
兼容判断。`plan` 是原生流程模式，不等于只读沙箱；显式 `bypassPermissions` 下仍可写文件，
不由 Core Workspace access 静默替换权限。MiniMax 明确拒绝 ACP `additionalDirectories`，new/resume/load 均不发送该扩展；
附件仍经过共享授权和可访问路径，原生 Tool 的访问行为受原生权限约束，不宣称原生额外目录沙箱。
原生 permission ID 与 tool-call ID 不同，只在同一 Session/Prompt 以完整输入和名称唯一配对，
后续用确切 alias；歧义 fail closed。公开输出只取原生 content，命令退出码按原生明确字段归约，
不遍历私有 details，native stderr 仅排空。
文件观察另按 [File Change v8](../contracts/runtime-file-change-observation-v8.md) 窄取成功原生
Write 的 Boolean `created` 与 Write/Edit 的结果 `details.patch`；编号/截断的展示 Diff 不是完整文件状态。
相对路径只从同调用唯一结构化路径补齐，缺 patch 不从输入或磁盘重建；
实测与其他 18 款的差异见[完整对照](../research/minimax-code-runtime/full-parity-2026-10-16.md)。

原生问卷暂不承接为 Rovai 表单。客户端不广告 elicitation form，MiniMax 无可用答题路径时由
原生 dismiss；`questionnaire:` permission options 在普通审批和免审批之前返回 `cancelled`，
不能用允许执行代替选择答案。已观察到未承接问卷的 Prompt 不因非空文字或已公开发送而成功；
原生错误与取消仍先按各自终态处理。正常 `end_turn` 下公开失败为
`runtime_questionnaire_unsupported`，说明问卷不受支持、未提交答案并引导 User 发新消息继续。
已发消息保留，问卷 Run 不自动重放；后继沿既有 Session/Fleet 路径运行，不额外换 Host。
这不等于隐藏工具或自动转为 Thread 提问，不修改日常原生配置，各平台准入分别按上文记录。

运行中输入使用 `mcode/session/steer(text, clientRequestId)`，只在冻结版本已验证且当前 Prompt
已接受时发送。原生 `steered` ACK 与活跃 Run/epoch 共同确认；歧义结果保持 unknown，不自动重发。
沿用 ACP 插话后 Host 退役策略，下一次以同一 Session 恢复，不能把普通 warm reuse 结论外推至插话后。
图片插话交付授权路径，未实现该扩展不具备的 image block。按 User 要求不提供 Fast。

Usage 通过 Host 冻结的原生 data root、SQLite 精确 Session/cwd/root 身份和只读 journal baseline
采集 assistant 数值，排除历史、子 Session、重复和错误/中止占位记录；正文不进入 Usage。
沿共享异步 baseline/poll 策略，短 Run 或结束尾部可能缺数；未观测保持未知，不以零补齐。
ACP Session 累计费用仅作 Session gauge，不冒充 Run 费用。Skills 只读发现原生 `.minimax`、
`.claude`、`.codex`、`.agents` 兼容来源，MCP 使用 ACP Session 追加投影；完整隔离和真实模型资格仍按矩阵记录。

## Hermes 受管 ACP

Hermes 保留 `hermes-cli` 产品闭集身份，2026-10-28 按维护者要求在 macOS arm64/x64、Windows x64、
Linux x64 均普通开放。四行采用 `enabled`，不采用 Preview；用户界面只显示实际机器状态。
设置、引导、成员/Skills 菜单和监控筛选复用 Core Admission，仅在已准入主机提供 Hermes；未准入主机不保留占位。
共享准入继续限制普通发现、检查、配置和执行，不删除既有记录。
平台状态见[准入合同](../contracts/runtime-platform-admission-v2.md#hermes-初始准入)。保留的共享 ACP 实现直接启动官方入口，
使用用户原生 `~/.hermes` 与精确 Session resume；无私有 Home、启动器或专用 Gateway。
Fleet 只拥有 ACP 客户端根进程，原生共享执行端不随 Run 回收。

原生配置启用 `clarify` 后，官方 ACP 的选择题及开放题权限卡片进入共享问卷不支持处理，
不创建执行审批、不代选答案；已识别的损坏问卷也不回落授权。后继输入沿原 Session 继续。

模型的普通 CLI 调用通过原生逻辑 Session 定位唯一 Conversation/活动 Run，并复用现有 lease、
Router、回复和回执。按调用时归属，不追溯旧后台程序最初属于哪轮。其他 Runtime 不改。
FirstPayload 只保留首次及真实规则更新，不进行压缩补发。未确认的 MCP 撤销、原生工具终止和
增强详情不声明成功；未知输入不自动重放。具体合同见
[Hermes Managed Runtime v1](../contracts/hermes-managed-runtime-v1.md)，理由见
[原生会话定位决定](../versions/v1.72/decisions.md#v1-72-d67)。
