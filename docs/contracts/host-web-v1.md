---
document_type: protocol-contract
contract: host-web-v1
authority: shared-host-web-transport
status: accepted
version: 1
source_version: v1.59
last_updated: 2026-09-12
---

# Host Web v1

本合同拥有当前共享 Axum 网络入口与 Desktop 管理入口。当前只开放只读能力；accepted 不等于
草稿、上传、真实 Runtime 或三平台安全资格已完成。目标结构与隔离前置条件见
[统一 Host](../architecture/unified-rust-host.md)，实际完成范围见[版本计划](../versions/v1.59/implementation-plan.md)。

本文件为被 v2 替代的历史协议。一次性令牌、唯一公开地址与同 UID 隔离前置均不再属于当前模型；
以 [Host Web v2](host-web-v2.md) 的明确替代条款为准，原证据不改写为通过。

## 进程与管理

`rovai-web` 只接收既有 `CoreService`，不打开数据库、不创建 runner、不驱动业务调度。
`rovai-host` 兼容 Desktop 原有显式路径参数和父进程 stdio；其 in-process 请求与管道请求进入同一个
应用运行层。Web UUID 回执只交给对应进程内等待者，不写入 Desktop stdout；Core 事件和 startup frame
继续向 Desktop 投影。父管道 EOF 仍结束 Desktop 子进程；独立 `run` 的 stdin 则只用于可选令牌输入。

Desktop Main 通过单独的本机 IPC 请求 `host.web.status/start/stop/rotate`，Renderer 不能指定 UI 文件根。
四个方法不进入通用 Renderer Core allowlist，也不进入 Web operation enum。start 参数为 `listen`、可选
`publicOrigin`、`allowInsecureLan` 和由 Main 选择的绝对 `uiDirectory`。start/rotate 只向本机调用者返回
新管理令牌；status 永不返回它。端口占用、重复开启、无效配置与缺失 WebUI 返回失败，保留 Core。
stop 撤销全部 Session/订阅并停止 listener；Core 继续。Desktop 和 Server 两种入口共用 Router、认证和 WebUI。

当前管理通道是父进程拥有的匿名管道，尚不是带身份握手的 UDS/Named Pipe 服务。匿名管道与文件权限
不能单独证明同 UID Runtime 不可冒用；该安全资格保持未通过，不因只读 Web 或默认关闭而自动成立。

## 会话与请求边界

所有请求要求 Host 精确匹配配置的控制台 authority；如有 Origin，也必须精确匹配。拒绝 query 参数，
不启用 CORS、不读取代理转发头、不使用认证 Cookie。LAN 监听要求显式开启明文访问及配置 public origin；
HTTPS/VPN 由部署环境提供。本模块不终止 TLS，不自建域名或代理。

`POST /api/v1/login` 接收唯一字段 `administratorToken`，验证 256-bit 系统随机管理令牌，交换新的
随机 Session Token 与独立 `clientId`。有效期 1800 秒；最多 32 个 Session、全局每分钟 12 次登录尝试。
两类凭据按类型域分隔后只保存 SHA-256 摘要，管理令牌恒定时间比较。logout、过期、rotate 和 stop 撤销会话；
stop 后仍存活的旧连接不能再次登录。

认证 API 只接受显式 `Authorization: Bearer <Session>`。浏览器令牌只保存在页面内存；管理令牌提交后
清空输入。登录、API 和 SSE 均固定控制台 origin、`credentials: omit`、`redirect: error`、`cache: no-store`。
令牌没有 URL、Cookie、日志或长期浏览器存储表示。连接代次隔离迟到响应；旧 401 不得注销新会话。

`GET /api/v1/capabilities` 声明当前只读能力，composer/uploads/approval/nativeFilePicker/desktopWindow 为
false，releaseQualified 为 false。`POST /api/v1/request` 的 operation 由 Rust Serde 封闭 enum 逐项准入；
不是任意 Core RPC 网关。默认请求体上限 1 MiB、最多 64 个同时处理请求、15 秒读取期限。
Core 进程内入口仍保留 128 普通/16 控制准入；HTTP 断开不释放已准入命令的 Core 所有权。

公开 app.info 不含 dataDir；MCP 只投影名称、transport、启用状态与分配成员，不传输 definition JSON、
endpoint、env、headers 或源文件。只读结果清除 availableActions，不能用 UI 隐藏代替服务端准入。
所有响应包含 no-store、nosniff、no-referrer、CSP 和权限策略；错误也不进入缓存。

## 实时与静态文件

`GET /api/v1/events` 用认证 Fetch 流读取。每个 Session 最多两个流；Core 事件广播容量 256，流最多约
每 100ms 一次失效通知，10 秒心跳。只输出无业务内容的 resync/invalidate，包含进程 epoch 与该连接 revision。
原始 Core 事件、另一客户端草稿、凭据和内部响应不得进入此流。

这是失效通知协议，不是持久事件回放。首次连接、重连或广播缺口必须重新读取授权快照；客户端依赖 Core
快照自己的 throughGlobalSequence，不能把连接 revision 当数据库水位。撤销或到期关闭流；断线只重连和重读，
不重发业务命令。SSE 不占普通命令队列。

静态路径只服务配置的应用构建目录，拒绝路径分隔异常、父目录、越界符号链接及非白名单类型。
单文件最多 16 MiB；没有上传目录、工作区根目录或任意 Host 文件下载。当前 Markdown 不执行 HTML，
不自动加载远端图片。源附件的 source reference 合同不因本入口改变；后续上传、资源下载和写入须先满足
草稿身份、精确资源授权与 unknown outcome 门禁。

## 验证 owner

- `rovai-web::auth::tests`：纯内存凭据生命周期、有效期、撤销、限流与容量；旧 Core 测试不拥有该新状态机。
- `rovai-web::operations::tests`：公开 MCP 投影排除秘密和未来未知字段，封闭操作准入不接受本机管理或旧草稿写入。
- `apps/web/src/client.test.ts`：浏览器固定 origin、显式头、拒绝重定向、连接代次与分帧；HTTP 服务测试不能证明客户端行为。
- `scripts/lib/host-web.test.mjs`：真实 Host 父管道/HTTP/SSE/同一 Core/stop seam，临时目录且不调用模型；纯内存测试不能证明进程所有权。
- 原 Core transport 测试继续拥有已准入请求、乱序回执与事件缓冲；未创建平行数据库 fixture，也未禁用测试。
