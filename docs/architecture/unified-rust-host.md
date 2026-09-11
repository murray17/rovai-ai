---
document_type: architecture
authority: unified-rust-host
last_updated: 2026-09-12
---

# 统一 Rust Host

本文拥有已确认的 Host 目标结构。实施与平台资格见[当前版本](../versions/README.md)及
[Runtime 兼容性](../runtime-compatibility.md)，不能由目标结构推断完成。
现有准入、事务、Runtime 与关闭合同继续有效；新增 wire 合同随对应实现明确发布。
初始 CLI 的精确路径、初始化准入和停止适配由[Host Lifecycle v1](../contracts/host-lifecycle-v1.md)拥有；
当前只读网络入口由[Host Web v1](../contracts/host-web-v1.md)拥有。

当前已实现父进程匿名管道与进程内请求共用一个 Host/Core，以及只读 Axum 入口。以下 UDS/Named Pipe 身份握手、
完整公共 DTO 生成、客户端草稿/上传与控制面隔离均是后续目标，不由现有管道推断完成。

## 组件和唯一权威

`rovai-host` 在进程内组装 `rovai-core` 应用运行层。Desktop 通过受保护本机 IPC 访问，独立 Server
直接运行相同 Host。`rovai-web` 使用 Axum 0.8、HTTP JSON 与 Fetch SSE，只接受已有应用服务句柄，
不创建数据库、第二份 Core 或调度器。`rovai-protocol` 拥有封闭公共 DTO，Rust Serde 为源生成 TS；
不能把任意内部 Core RPC 转为网络能力。React/TS/Vite WebUI 和 Desktop 共用客户端接口、组件与 tokens。

Host 独占 data-dir lease、SQLite 准入、执行、恢复与后台驱动。普通业务命令保留串行入口和已有独立通道；
HTTP 并发不改变领域调度，SSE 不占命令队列，取消与审批不等待长 Runtime 执行。
Desktop-only 窗口、原生交互与更新保留 Electron；基础 Server 不要求 Electron 或 Node。
Runtime 自身依赖单独声明。Automation 时钟迁 Host；日报、评测与渠道未迁移驱动初始保留可选 Desktop
适配，并在 Headless capabilities 明确关闭。实际 Main 归属见当前实施计划。

macOS/Linux 本机传输为 UDS，Windows 为受保护 Named Pipe，另有可信身份、实例与代次握手。
同一目录不能被两个 Host 抢占；不自动 attach、抢锁或双写。Desktop Web 默认关闭；关闭 Web 仅关闭
网络入口、连接与 Session，Core 及任务继续。Desktop 主动退出和 Server 受控停止复用现行
[Planned Shutdown](planned-shutdown.md)，客户端断开不取消已准入工作。

## 身份与控制面

服务端从验证过的本机身份、Remote Session 或 Agent Built-in 上下文确定能力；不信任客户端自报用户身份。
Web 管理令牌交换短期可撤销 opaque Bearer Session；不使用认证 Cookie。令牌仅页面内存，刷新可重新登录。
仅固定控制台 origin 的封闭 API 使用显式 Authorization；登录和认证 Fetch 拒绝重定向，SSE、图片、下载同样
走认证 Fetch，必要时生成并释放 Blob URL。不把凭据写 URL、预览链接、日志或浏览器长期存储。

管理令牌使用 256-bit 系统随机数，受保护本机入口初始化/轮换/恢复；只存带类型区分摘要、恒定时间比较。
过期、撤销、轮换和关闭 Web 撤销已有订阅。登录限流，Host/Origin 封闭校验，请求/上传/并发/订阅有界；
可信代理和外部 origin 必须显式配置。默认 loopback；LAN 明文必须显式开启并说明风险，不可信网络用
HTTPS/VPN。二维码只含地址，既有执行台身份仍只读。不自建域名、证书、Relay 或预览代理。

OS socket/文件权限不单独证明同 UID Runtime 隔离。Windows/Linux 阶段 1 内实测受管 Runtime 及后代无法
读取控制凭据、冒用 IPC 或调用恢复入口，同时能访问授权工作区并被回收；覆盖文件、环境、句柄及必要进程
访问边界。复用系统已有隔离，不承诺抵御宿主管理员/root。失败先交用户确认最小修正、替代与影响，
未通过组合不声明安全发布；不自动扩大为通用沙箱或容器平台。

当前 [Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md) 与
[User Automation v5](../contracts/user-automation-v5.md) 已移除 Rovai 外层 macOS 沙箱及同 UID 防冒用承诺。
本轮同步该实现，不重新引入旧沙箱；上述 Host 控制面保护仍是待验证的目标，不能从现有目录权限或 CLI
误用防护推导成立。接入管理凭据、用户 IPC 与恢复入口前，需要明确该目标与当前 Runtime 合同的差距和最小修正。

## 草稿与用户文件

每个客户端草稿有独立身份与后端验证的归属，贯穿读取、保存、附件、队列与发送消费。
作用域含 Host/Owner/client/Camp，私聊再含 Conversation。客户端提交 ID 不是授权；保留 revision、
原子消费、命令幂等与 Core FIFO，不做跨端同步、实时合并或多人共编。

Web 上传写 Host 临时文件后绑定当前客户端草稿，复用现行 source reference。
失败或可确认未绑定文件由入口清理；绑定结果未知按原命令查询回执，不能证明未绑定就不删除。
Core 接受后由 OS 决定临时文件寿命；发送失败、退出或删除一个引用不删除源文件。
草稿/Pending/消息交接由 Core 原事务管理，重启或 OS 清理后按实际可用性处理；不承诺永久历史下载。
Agent Managed 与 legacy 机制不变，不建对象存储、附件目录库或用户 Managed 资产。

资源读取按精确身份、owner locator 与作用域授权；路径规范化、符号链接和读取时变化不能逃逸授权。
Host 工作区由本机受信入口授权，Web 只选择已允许范围。静态服务只挂应用构建产物。
首版用户 HTML/SVG 等主动内容只作为安全文本或下载；不执行上传 HTML，保留 CSP、清洗与安全图片格式。

## 命令、事件与兼容性

复用 commandId、请求摘要及持久结果，先授权再回放；同 ID 不同请求冲突。断网后按原 ID 核对，
不以新 ID 自动重发，不承诺外部工具 exactly-once。两端审批只产生一个有效结果，验证精确 Run、审批与原生选项。
SSE 只输出授权投影，快照与水位连续，过期/缺口重取快照；有心跳、有界队列与慢客户端限制。
缓存和迟到响应以 Host/连接代次隔离，协议不兼容阻止危险写入，敏感响应不缓存。

Runtime Catalog、平台矩阵与 Adapter 唯一维护。Server 目标为 macOS arm64/x64、Windows x64、Linux x64，
实际原生、Desktop、系统服务、容器分别验收。Linux Desktop、额外 CPU 架构、三平台一键服务安装器不在本轮。
同版 Host/Web 配对发布，数据库升级与回退遵守 authority 准入，不能用旧程序打开新 schema。
Mobile 最后复用同一 Web：宽屏 >=1040px，紧凑 768–1039px，手机 <768px；不引入离线执行队列或原生移动 App。
