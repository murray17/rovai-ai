---
document_type: contract
name: Runtime Launch and Verification
version: v37
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Runtime Launch and Verification v37

完整继承 [v36](runtime-launch-and-verification-v36.md)；本版只新增官方 ZCode Runtime。

## 官方身份与原生配置

`adapterKind=zcode-app`，protocol `zcode-app-server-v1`。macOS Installation 使用官方
`ZCode.app/Contents/MacOS/ZCode` 定位 bundle，实际启动独立 Node.js 执行同 bundle 的
`Resources/glm/zcode.cjs app-server`。不执行 App 主程序；`ELECTRON_RUN_AS_NODE=1` 不能阻止 macOS 注册 App。
Node 从 Runtime PATH 或 `ROVAI_ZCODE_NODE_BIN` 解析，拒绝 `.app` 内程序。验证 bundle identifier `dev.zcode.app`，
fingerprint 包含官方定位文件、内核与独立 Node，bridge revision 为 `zcode-native-node-transport-v7`。
默认发现 `/Applications` 与用户 Applications；不通过 PATH 选择社区 `zcode`、`zcode-app-cli` 或 `zcode-acp`。

Windows 使用官方 `ZCode.exe` 定位安装根，要求同根 `resources/app.asar` 与 `resources/glm/zcode.cjs` 为
解析后仍在根内的普通文件；默认查找 LocalAppData 的 `Programs/ZCode`、`ZCode` 及 ProgramFiles 的 `ZCode`。
独立 Node 必须是原生 `node.exe`。Runtime 启动前仍保留规范化路径 identity；只在 Node CommonJS 模块加载处
移除 Win32 verbatim 前缀，Session RPC 与 bridge 工作区比较统一使用协议路径拼写。

账号登录与 BYOK 优先使用官方 `~/.zcode/cli/config.json`；不存在时读取 App 发布的 `.zcode/v2/config.json`。
项目 `zcode.json`、`.zcode/config.json` 继续按既有原生层次合并。
项目搜索从最近 Git root 到 cwd；无 Git root 时只读取 cwd。配置变化进入 Host 与 Native Binding compatibility digest。
秘密只在内存与原生 `runtimeModel` RPC 中传递，不进入 argv、Prompt、数据库、诊断或公开 Evidence。
Rovai 不修改用户 provider 配置，不建立额外密钥配置入口。原生模型目录仍须通过无 Prompt 的官方 workspace/session 交换。

每个 Host 使用私有临时目录；Unix 使用短路径 socket，Windows 由原生 protected DACL 创建目录，退出后清理。正式执行保留用户 Home。
普通 Probe 同样沿用用户 HOME / USERPROFILE 和 ZCODE_STORAGE_DIR、ZCODE_SESSION_DB、ZCODE_SESSION_DB_PATH 等
原生存储环境，不复制 Home、凭据或迁移配置。只把 cwd 与 TMPDIR/socket 放在可清理的私有临时目录。
配置读取和内存 runtimeModel 与正式执行共用；临时 cwd 的基础连接不能证明任意项目配置都已验证。
Probe 只做版本、workspace/readState、无消息 deferred Session 创建、订阅与模式初始化；关闭自动标题生成，
不发 session/prompt、V4 sendText、workspace/generateText、compact 或测试工具调用。初始化可以正常联网/落盘，
不承诺零写入；结束只删除本次临时资源，不扫描或删除用户原生 Session 数据库。

Probe 实测结果只包含 initialize、native 配置加载、session.new；AdapterCapabilitySnapshot 另存代码已实现
的映射能力，发布 Smoke 证据按版本/平台独立记录。Ready 与其他 Runtime 统一显示“可用”，检查范围保留在详情中；该状态不保证余额、模型生成或高级能力已实测。
保留最低 kernel 0.16.5、程序指纹变化复查和关键返回值校验；不因版本新于已测试版本而无条件禁止使用。

## Session、输入与生命周期

Core 内部复用 AcpHost/Fleet；ZCode 不因此成为原生 ACP Runtime。Host 以 Camp 为复用范围，
保持 attachment 授权边界；同一 Camp 的成员 Session 可精确切换，模型可按 Session 切换；mode 进入 Host 配置键。原生 Session 创建使用 deferred persistence，
不携带首轮输入；恢复只允许 exact Session ID。订阅不请求历史重放。每个输入只发一次 V4 `sendText`，
commandId 与 inputId 精确匹配；匹配的 accepted reply 或 turn.started 才确认输入接受。

事件按 Session、inputId、turnId 和单调 seq 归属；重复或旧事件不进入新 Run。Tool 参数只与同一 ToolCall result 关联。
只发布原生 text_delta，reasoning_delta 不成为公开正文。只有匹配输入的 `turn.completed.resultType=success`
形成成功 Final；failed/cancelled 不伪造成功。Missing-Send 使用 `zcode_completed_turn` 边界，仍受已接受业务 send 抑制。

前台完成只要求本轮 Input/Turn 成功终态、最终文本一致、前台 Tool/审批/请求收口与 native idle。
原生结构化 background task 的 taskId、ToolCallId、inputId、turnId 和 Session 固定归属；backgrounded/running
保持尚未退出，不伪造 completed 或 exitCode=0。前台完成不等待这些任务退出，不设 300 秒后台门禁。
任务晚到结果经存活的 Host 路由写回原 Run/epoch 的 runtime.action Evidence；必须匹配已登记的完整 identity，
不进入后续输入或其他成员。原生 lost 只表示跟踪状态未知，保留受管责任；原生未提供 exitCode 时保持未知。
已有 intercepted Action 继续记录真实结果，已解决审批且已有原生后台归属的 Action 不阻挡前台终态；新业务操作仍受 Run 授权约束。

有后台任务的 Host 暂不跨成员复用，不参与空闲 TTL 或容量 LRU 回收；同一成员的原 Session 可继续交互。
同一成员续接优先选择仍承载其后台任务的兼容 Host，避免仅因另一个 Host 更早空闲而跨 Host 恢复同一 Native Session。
最后一个任务退出后恢复普通复用/回收。原 Run 的 bundled rovai CLI lease 仍正常失效，不因后台服务延长。
ZCode prelude 在原生请求进入时固定 Rovai CLI context，并沿 Node 异步执行链传递给后续子进程；
长期 shell 与后台子代理迟启动的命令不读取已被下一 Run 重绑的 Host context。没有请求归属的启动只获得空 lease。
快照仅包含 Rovai 内部 CLI context，存放于 Host 私有目录并随 Host 清理；普通 Probe 不启用此机制，
不复制原生 BYOK 凭据或用户 Home。CLI 仍由 Core 按原 Run/epoch/lease 校验，固定快照不延长授权。
取消使用 V4 stop 并只取消本次 input 所属后台任务，确认前台收口后释放 Run；不顺手停止原 Session 的旧任务或其他 Host。
取消 ingress 已关闭时，只保留当前原生 Prompt 的后台归属观察，直到其终态；不恢复正文投递或业务授权。
无法确认本次取消时报告 cleanup unproven，不伪报成功。明确关闭/失效 Host、Core 退出或异常死亡仍执行有界清理。

Unix 的 ManagedProcess 管理 Host 根进程组；Rovai Node prelude 的独立 companion 管理 native spawn(detached=true)
返回的确切组 ID。直接子进程 close 只触发该组存活检查，确认组为空才注销；保留仍有后代的组，不永久保存已退出组的 PID。
不扫描进程名或全系统子进程。官方内核原样 require；仅替换子进程的 Rovai CLI context 环境路径，原生命令和返回对象不变。
Host pipe EOF 后 companion 清理已登记组和根组，在 2 秒内观察结果并写入私有 owner report；Fleet 只在报告确认后
承认清理完成。未确认时保留诊断/报告，不把发送 kill 等同于已退出。回答结束、Session 关闭与 Host 回收是不同边界。
受管 Host 明确关闭时，仍存活任务的原 Run Evidence 记录 `host_closed`；工具表现为中断失败，原生退出码仍为未知。
清理未确认则记录 `cleanup_unconfirmed`，保持未确认退出的语义。这是 Host 生命周期事实，不冒充原生任务成功或实际 exitCode。

Windows 的 ManagedProcess 原子创建非 breakaway、kill-on-close Job，持有 Host 和全部后代；prelude 只固定
请求级 CLI context 并设置 windowsHide，不启动 Unix companion。`QueryInformationJobObject` 返回 ActiveProcesses=0
才确认整树清理；查询失败或截止前仍非空均保持未确认，不能用根 PID 已回收或 kill 请求成功替代。

官方 0.16.5 会在后台任务结果后自行启动 `inputSource=background_task` 的模型通知轮次；它没有 Rovai Input/Run，
现有业务授权模型不能把它当成新 Run。Adapter 保留真实任务结果，记录明确诊断，并用原生 `foregroundExecutionId`
限定 V4 stop 请求来停止该额外轮次；不停止其他 Session 或后台服务，不把通知正文当作本轮 Final。
后台结果观察与原生前台空闲确认独立运行，未确认前仍保留 Host 归属，不能提前跨成员复用。
这项原生自动模型通知不作为已接入能力；原 Session 的下一次 Rovai 输入仍正常精确续接。

## Bootstrap、权限、Skills 与 MCP

ZCode 使用已有 user FirstPayload。manual/auto/reactive 的 `session.updated` 只有 completed、operationId 与 boundaryId
完整时才能产生 compaction observation；按 boundaryId 去重，下一次 eligible input 重注入完整 Bootstrap。
不承诺在上游同一轮 compact/retry 内部插入。started、failed、cancelled、skipped 不触发重投。

权限使用原生 plan/build/edit/yolo/auto，默认 yolo；原生 permission callback 的 optionId 逐项映射，响应必须仍属于
active Session/Turn。未知交互返回不支持或拒绝，不自动批准。旧 read-only workspace 收紧为原生 plan。

Skill group `zcode` 投影到 `.zcode/skills`，继续保护项目已有内容。External MCP 为 native + assigned union，同名
Rovai assignment 优先；原生用户 MCP 与项目 MCP 的冲突遵守 ZCode 用户配置优先规则。MCP 集变化 fence Host，避免
warm resume 忽略新配置。仅有原生 cwd 的 MCP 使用固定参数的 cwd launcher 保留启动目录。
Unix 使用既有 `/bin/sh` 参数包装；Windows 使用独立 Node `spawn` 的 cwd/argv 与 `shell:false`，不把参数拼接为 shell 字符串。
该 Node launcher 不隐式解释 `.cmd/.bat`；需要脚本 shell 的原生定义应显式配置相应解释器。

## Usage 与能力差异

Usage 只读取唯一匹配终态、source=provider 的本轮 input/output/cacheRead 聚合；不会累加 Session totals。
cacheWrite/reasoning 原生缺值可能被补零，因此保持 NULL；不能由缺少 cacheWrite 的总量推导 uncached，
也不能由 Turn 聚合推导单次请求命中率。没有价格证据不补造 cost。

账号登录与 BYOK 均在范围内。图片沿用附件路径与原生 Read；GUI 浏览器/Computer Use 回调未接入。
Windows x64 与 macOS arm64 为 Qualified，各自绑定平台专属冻结证据；macOS x64 为可执行 Preview，仍缺少
目标主机资格证据。管理页只展示版本和机器状态，不显示测试、试运行或实验性标签；该呈现不把 Preview 升为 Qualified，
也不宣称完整 First-Class 接入 Checklist 完成。逐平台证据见[当前实施记录](../versions/v1.57/implementation-plan.md)。Read/Write/Edit 与 Diff 见
[File Change v5](runtime-file-change-observation-v5.md)。


## 账号与图片输入

官方终端 `/login` 支持 Z.ai／BigModel。原生流程解析 Coding Plan 凭据后写入
`~/.zcode/cli/config.json` 的 provider/model；Rovai 只读加载，与 BYOK 共用相同的 `runtimeModel`，
不要求用户再向 Rovai 手工填写 key。普通 Probe 不发起交互登录；缺少原生配置或凭据时给出官方登录指引。
登录或配置变化后重新检查，旧配置 digest 对应的 Host 不复用。

终端配置不存在时，App 配置从 `ZCODE_DATA_BASE_DIR`（缺省为原生 HOME）下的 `.zcode/v2/config.json`
读取；只额外读取 sibling `setting.json` 的 Provider family 模式与选择，沿用官方 OAuth/API Key 选择规则。
禁用、无凭据的 Provider 和禁用模型不进入目录；Team Plan 动态组织/项目凭据尚未接入，不能回退成个人凭据。
App 配置及选择纳入 digest，完整可用目录通过 `workspace/updateProviderRegistry` 内存 RPC 注册并校验回执。
Rovai 不解密 `credentials.json`、复制配置到 CLI Home 或启动 GUI。普通 Probe 只证明配置与目录加载、协议初始化。

Start Plan 除账号 Authorization 外，还依赖官方 App Renderer 完成的临时人机验证请求头。
当前 Rovai Host 未实现该验证交互；`interaction/requestProviderRuntimeHeaders` 必须明确报告未应用，
不能仅因已设置 Authorization 就宣称完成刷新，不提取或复用 App 的验证码结果。
账号配置可加载不等于账号模型生成已验收，真实 OAuth、刷新、套餐额度与模型调用分别记录。
个人 Coding Plan 的原生签名凭据原样交给官方内核；不按 Start Plan 的 Bearer 方式重写，不绕过官方
enabled/entitlement 或用户显式套餐选择。Start Plan 拒绝提示应说明当前 Host 缺少验证能力，并指向
官方 App 或原生 Coding Plan/API Key 配置，不能要求用户重复登录来假称该缺口已解决。
原生 `turn.failed` 与 `projection.status=error` 是失败终态；无前台工具/审批/请求后应发布脱敏失败，
不能等待 `idle` 后将鉴权失败误报为断线恢复。成功 Final 仍要求成功终态及原有完整校验。

图片与 Codex、Claude Code 及现有 ACP Runtime 一样，从现有 Attachment 授权/解析进入
`CURRENT_INPUT.attachments` 路径数组。ZCode 原生 Read 自行读取图片，按原生格式、压缩与大小规则处理，
将 image tool content 交给模型。Rovai 不预上传图片、不新增图片发送证据表、不改变 ContextManifest、
Bootstrap、Formatter、Profile 或 Schema。Pi 的 `prompt.images` 属于其既有专属协议，不作为全局附件规范。

原生配置的 `models.<id>.supportsImages` 经 runtimeModel 保留；未声明时由原生能力决定，Rovai 不伪造支持。
读取图片产生正常 Read 活动和文件路径，不形成 Files Changed 或修改 Diff，也不成为图片生成的公开发布来源。
原生读取失败或模型不能理解图片时保留真实错误，不能把看到路径等同于已成功看图。
