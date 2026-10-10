---
document_type: contract
name: Runtime Launch and Verification
version: v54
status: accepted
source_version: v1.72
last_updated: 2026-10-08
---

# Runtime Launch and Verification v54

继承 [v53](runtime-launch-and-verification-v53.md)，仅替换 Cline 执行后端、恢复、认证交互和临时配置合同。
其他 Runtime、共享审批、输入归属、进程回收、文件证据及未知输入不重发合同保持。

<a id="cline-official-acp"></a>
## Cline 官方 ACP

Cline 只有用户保存或正常发现的实际安装 `cline --acp`，使用共享 ACP Client、Host、Fleet 与 stdio。
不启动 Native Hub、SDK bridge 或 shim，不设版本白名单，不提供后备后端或自动切换。
按实际 initialize 与方法响应确定能力；广告能力与执行结果分别记录，协议握手不证明真实生成成功。

认证由所选 Cline 读取和刷新。继承已授权的正常环境和原生 Provider 源，不复制 OAuth 文件，不读取 token
字段作为准入条件，不建独占锁或账号状态机。仅在原生 ACP 需要时将所选 Provider 的已有静态 Key 传入
其官方环境参数；不改装 access token，不改端点、账号或计费来源，不重写刷新与原生认证优先级。
普通任务、保存和探测不调用登录。需要授权时反馈原生认证错误，使用所选安装的原生登录入口；
ACP authenticate 只能使用初始化声明的方法，不能猜 methodId。退出命令成功仅表示登录流程完成。
删除 Hub 专属登录 UI 和 `runtime.clineLogin.*` IPC，不保留无消费者接口。

Host 私有目录承载成员 Host 内不可变的 System Rule、只读数值观察和 MCP 投影；认证与原生历史继续持久保存，
不随 Host/Camp 回收删除。Bootstrap 内容和 Dynamic Context formatter 不变：原生 Rule 文件中 B 恰好一次，
user 只交付 P；没有全局可变 active Bootstrap，没有额外 user 身份文本。安装不支持时记录具体失败。
MCP 使用单一原生交付路径；当前安装 ACP 不使用 mcpServers 时才保留经过验证的私有原生配置适配。
不同时向 ACP 与原生配置重复交付同一服务器。工具/权限、取消、Skills、显式发送和数值证据复用共享服务。

账号和 BYOK 按相同 Fleet 规则 warm、cold 与并行。程序、Provider、模型、端点或生效配置来源变化仍按
共享兼容性推进 Binding；正常 token 轮换、到期和无关 Provider 更新不重绑。缺可读账号标识不封禁。
多个 Host 保持成员、Rule、MCP 和审批隔离；真实刷新、外部并发刷新与普通请求资格分别记录。

新会话 session/new，续接 session/prompt；cold 只使用已声明的 session/load，或共享客户端已经支持且
Agent 声明的 session/resume。恢复结束前不发送新输入。load 重放由共享恢复阶段隔离，不进入本轮
公开发送、工具执行、审批、Diff、Usage 或 Missing-Send；原生方法失败保留其事实，不能伪报连续性。
不再读取完整历史数组后提交 initialMessages，不直接读写原生历史文件，不做历史迁移或摘要恢复。

旧 cline-hub-v1 Binding 与 ACP 不兼容。下一次新授权输入按共享替换机制创建 ACP Session 并推进 generation，
明确标记连续性变化；旧 Run accepted/unknown 不重发。公开历史、Memory、工作区和既有文件证据保持。
进行中的旧 Run 必须结束或显式取消后再切构建；不跨后端接管。被动历史协议标识仍可读，不代表可启动后端。
只通过通用内核身份账本回收已确认自有进程；不杀外部 Cline，不清理凭据、原生锁或历史。

ACP compaction 配置缺口仍存在。删除 Hub 配置注入、help 默认解析及所有相关启动依赖；不加入私有字段、
环境 hack、运行时 patch、/compact、模型总结或 overflow 重试器。原生上下文错误如实反馈。
保持 macOS arm64 Preview；其他平台的 workspace 构建与 Runtime 实测资格分别记录。
决定理由：[V1.72-D30](../versions/v1.72/decisions.md#v1-72-d30)。
