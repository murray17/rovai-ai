---
document_type: contract
name: Runtime Launch and Verification
version: v37
status: accepted
source_version: v1.56
last_updated: 2026-09-10
---

# Runtime Launch and Verification v37

完整继承 [v36](runtime-launch-and-verification-v36.md)；本版只新增官方 ZCode Runtime。

## 官方身份与原生配置

`adapterKind=zcode-app`，protocol `zcode-app-server-v1`。macOS Installation 使用官方
`ZCode.app/Contents/MacOS/ZCode` 定位 bundle，实际启动独立 Node.js 执行同 bundle 的
`Resources/glm/zcode.cjs app-server`。不执行 App 主程序；`ELECTRON_RUN_AS_NODE=1` 不能阻止 macOS 注册 App。
Node 从 Runtime PATH 或 `ROVAI_ZCODE_NODE_BIN` 解析，拒绝 `.app` 内程序。验证 bundle identifier `dev.zcode.app`，
fingerprint 包含官方定位文件、内核与独立 Node，bridge revision 为 `zcode-native-node-transport-v3`。
默认发现 `/Applications` 与用户 Applications；不通过 PATH 选择社区 `zcode`、`zcode-app-cli` 或 `zcode-acp`。

BYOK 由官方 `~/.zcode/cli/config.json` 和项目 `zcode.json`、`.zcode/config.json` 提供。
项目搜索从最近 Git root 到 cwd；无 Git root 时只读取 cwd。配置变化进入 Host 与 Native Binding compatibility digest。
秘密只在内存与原生 `runtimeModel` RPC 中传递，不进入 argv、Prompt、数据库、诊断或公开 Evidence。
Rovai 不修改用户 provider 配置，不建立额外密钥配置入口。原生模型目录仍须通过无 Prompt 的官方 workspace/session 交换。

每个 Host 使用权限收紧的短临时目录容纳原生 Unix socket；退出后清理。正式执行保留用户 Home。
Probe 使用独立 Home、workspace 与 socket root，不持久化 Probe Session 到用户 Home，也不提交模型输入。

## Session、输入与生命周期

Core 内部复用 AcpHost/Fleet；ZCode 不因此成为原生 ACP Runtime。Host 以 Camp 为复用范围，
保持 attachment 授权边界；同一 Camp 的成员 Session 可精确切换，模型可按 Session 切换；mode 进入 Host 配置键。原生 Session 创建使用 deferred persistence，
不携带首轮输入；恢复只允许 exact Session ID。订阅不请求历史重放。每个输入只发一次 V4 `sendText`，
commandId 与 inputId 精确匹配；匹配的 accepted reply 或 turn.started 才确认输入接受。

事件按 Session、inputId、turnId 和单调 seq 归属；重复或旧事件不进入新 Run。Tool 参数只与同一 ToolCall result 关联。
只发布原生 text_delta，reasoning_delta 不成为公开正文。只有匹配输入的 `turn.completed.resultType=success`
形成成功 Final；failed/cancelled 不伪造成功。Missing-Send 使用 `zcode_completed_turn` 边界，仍受已接受业务 send 抑制。

取消使用 V4 `stop` 并取消未收口的 backgroundJobs。正常 foreground terminal 后继续等待已有后台工作收口，
同一 Run 保持租约；后台 Bash 的启动回执不是命令成功终态。仅当 jobs、activeToolCalls、pendingPermissions、
pendingRequestIds 全部收口且原生状态 idle 才释放 owner。等待超过 300 秒或无法证明空闲则关闭 Host。
ManagedProcess 继续拥有 Host 根进程组的有界终止与 reap。ZCode 原生 Bash 使用独立进程组，
仅终止 Host 根组无法回收它们；启动前由 Rovai 的 Node prelude 建立一个独立清理 companion，
记录原生 `child_process.spawn(detached=true)` 返回的确切进程组 ID，stdio close 后解除记录。
官方内核以 `require` 原样加载，spawn 的参数和返回对象保持原生语义；不复制或修改内核文件。
companion 通过私有 pipe 观察 Host 死亡/EOF，回收记录的组与 Host 根组后退出；companion 自身失败使
Host fail closed。该机制不依赖沙箱内的 `ps`，不扫描或终止其他 App 的进程。

## Bootstrap、权限、Skills 与 MCP

ZCode 使用已有 user FirstPayload。manual/auto/reactive 的 `session.updated` 只有 completed、operationId 与 boundaryId
完整时才能产生 compaction observation；按 boundaryId 去重，下一次 eligible input 重注入完整 Bootstrap。
不承诺在上游同一轮 compact/retry 内部插入。started、failed、cancelled、skipped 不触发重投。

权限使用原生 plan/build/edit/yolo/auto，默认 yolo；原生 permission callback 的 optionId 逐项映射，响应必须仍属于
active Session/Turn。未知交互返回不支持或拒绝，不自动批准。旧 read-only workspace 收紧为原生 plan。

Skill group `zcode` 投影到 `.zcode/skills`，继续保护项目已有内容。External MCP 为 native + assigned union，同名
Rovai assignment 优先；原生用户 MCP 与项目 MCP 的冲突遵守 ZCode 用户配置优先规则。MCP 集变化 fence Host，避免
warm resume 忽略新配置。仅有原生 cwd 的 MCP 使用固定参数的 cwd launcher 保留启动目录。

## Usage 与能力差异

Usage 只读取唯一匹配终态、source=provider 的本轮 input/output/cacheRead 聚合；不会累加 Session totals。
cacheWrite/reasoning 原生缺值可能被补零，因此保持 NULL；不能由缺少 cacheWrite 的总量推导 uncached，
也不能由 Turn 聚合推导单次请求命中率。没有价格证据不补造 cost。

本次仅接 BYOK，不接 Z.ai/BigModel 账户登录、GUI 浏览器/Computer Use 回调或结构化 prompt 图片。
macOS arm64 在完整资格证据冻结前为 Preview；其他平台 NotQualified。Read/Write/Edit 与 Diff 见
[File Change v5](runtime-file-change-observation-v5.md)。
