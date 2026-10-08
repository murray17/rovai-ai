---
document_type: contract
name: Runtime Launch and Verification
version: v53
status: accepted
source_version: v1.72
last_updated: 2026-10-08
---

# Runtime Launch and Verification v53

继承 [v52](runtime-launch-and-verification-v52.md)。仅覆盖 Cline 的认证交付、登录结果与 Host 生命周期；
其他 Runtime、权限、事件、未知输入不重发、资源上限、历史恢复、MCP、Skills 和压缩合同不变。

<a id="cline-native-hub"></a>
## Cline Native Hub

用户选中的实际 Cline 安装拥有 Provider、凭据读取、刷新和认证失败处理。Rovai 按已保存程序路径、
普通启动环境与原生配置来源启动自有 Native Hub；所有认证形式直接引用同一选中 Provider 文件。
Host 私有目录只承载冻结 Rule、MCP、运行偏好、discovery/连接认证和临时文件，不生成 Provider 副本。
原生 Session 历史继续使用既有持久路径，不与凭据或成员配置合并。

Rovai 不按 Provider 名、tokenSource、auth、accountId、静态 Key 与 OAuth 是否并存或端点白名单决定认证准入。
可识别的 Provider/模型/地址元数据仍按会话交付；未知来源由原生执行确认，不推断登录状态，不伪造 API key。
实际安装能自行读取 Key 时不向 sessionConfig 注入 Key；不提取或改装 OAuth token，不重写认证优先级、
端点、刷新算法或计费来源，不在失败后自动切换来源。普通运行、保存和检查不得发起登录。

用户授权 Cline 原生保存所选持久源的刷新结果；Rovai 不写回、覆盖、迁移或删除凭据。
无论认证形式，Host 均按共享 Fleet 的兼容性、settled、空闲与失效规则进入 IdleWarm 或回收。
同源多个成员可有独立 Hub 并行，不设凭据文件级独占、scope_busy、串行队列或账号强制 cold。
旧 `.rovai-auth-*` 记录不再读取或参与启动，不因 starting 状态拒绝运行。未证实归属与空闲的旧记录保持原样；
通用 Managed Process 内核身份账本、generation fencing、崩溃回收与取消清理继续生效。
Host/Camp/App 清理只处理已确认自有资源，不删除持久凭据或原生锁，不终止外部 Cline。

兼容性只观察生效的 Provider 配置和模型目录，正常 access/refresh token、到期时间、updatedAt 及无关 Provider
更新不改变 Binding。可读 accountId 仅是兼容性观察，缺失不阻断；程序、Provider、模型、端点、来源、
静态 Key 或其他生效配置变化仍按共享兼容性处理。没有新增账号状态机或凭据数据模型。

现有显式登录继续使用同一安装的原生帮助和参数数组，保留私有有界交互、取消及整树退出确认。
`runtime.clineLogin.*` wire shape 与状态沿 v52。completed 只表示原生命令成功退出且自有进程清理完成，
不要求 Rovai 自定义账号字段，也不证明模型请求成功。界面表述为“原生登录流程已完成”；后续可沿既有检查
或普通任务取得原生结果。零模型 Session 探测成功只证明协议可用，authenticationStatus 保持 unknown。
原生明确拒绝及匹配回复中 finishReason:error 沿共享封闭错误分类反馈，不公开错误原文；
原生明确缺凭据报告 credentials_unavailable，不自行推断账号登录状态。网络失败不删除凭据，传输未知不重发输入。

保持 Preview。实际刷新、首次完整授权、外部 Cline 并发刷新与多平台未验证范围写入证据，不成为普通
warm/并行的额外前置条件。账号 first/warm/cold、同源双成员并行与 BYOK 的真实结果分别记录；允许原生
尝试不等于所有 Provider 和刷新场景通过。取舍见 [V1.72-D24](../versions/v1.72/decisions.md#v1-72-d24)。
