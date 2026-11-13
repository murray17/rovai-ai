---
document_type: implementation-record
version: v1.72
last_updated: 2026-11-13
---

# 飞书与 Lark 长连接恢复

执行 Thread 中响子评审通过的 v2.1 方案。分支 `rovai/feishu-ws-recovery`，初始基线
`f3719e667e260d7227ad0111a77ecbb485c901e1`，worktree 为
`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-feishu-ws-recovery`。无前置治理提交要求。

## 范围与决定

SDK 1.73.0 的握手 watchdog 先 removeAllListeners 再 terminate，ws 在 CONNECTING 阶段异步发出 error，
造成主进程未捕获异常。原 channel 外层 15 秒期限短于单次握手 20 秒，且未成功连接的 disconnect no-op，
使旧客户端继续运行。补丁为 WSClient 增加不可复活的关闭生命周期，持有 pending socket 并在清理时保留
error 接收者；单次尝试与整个 channel dispose 分开，保持 HTTP sender 与 dedup cache。

首个 onReady 前由 Host 调度，之后 SDK 处理断线；终态才交回 Host。身份（含 Token）、endpoint、握手分别
15/15/20 秒，身份请求使用独立受限 HTTP client，取消不会中断稳定外发 client。Host watchdog 防御异常悬挂。
单轮实际重连失败由 SDK 主动发事件，避免轮询和服务端首次周期内的过早提醒。

新增 `memberBot.observeConnection`，只更新 exact 已发布 Bot 的可观测身份。不同的已有非空 botOpenId
拒绝，Owner、绑定、published_at 不变。最新且只差连接验证的 intent 可在本地 CAS 完成，不重放远端 mutation。
普通首次发布保留欢迎卡，自动/手动恢复不补发。网络错误不推断登录失效。

已发布事实与运行期连接状态分开。未知运行期显示 unknown；自动恢复显示 reconnecting；身份/凭据/配置终态
显示需处理并保留“继续核对”。合法 channel 在 WS 重建期间仍可 HTTP 外发及下载附件；身份冲突停止该记录的
所有传输。Core 原有最多五次 delivery 尝试仍适用，终结的 delivery 不因网络恢复自动重放，不保证入站全部补发。

## 验证归属

- `feishu-ws-lifecycle.test.ts`：真实 ws 子进程、CJS/ESM、超时/关闭/迟到 endpoint、首连错误分类和单轮事件。
- `bot-connection.test.ts`：single-flight、责任交接、HTTP 保留、提醒时机、终态与停止。
- `channel-settings.test.ts`：真实 Host 调度边界、Core 切代次、身份冲突、原发布与消息功能回归。
- 原 Rust binding owner：填空、相同 no-op、显示名、冲突、CAS、Owner/发布时间不变。原 Provider owner：交叉 Host 拒绝。
- `ChannelSettings.test.ts` 与 `host-channels.test.ts`：恢复与终态动作、发布事实和显式投影。

Rust 函数与 fixture 净增为零；测试扩展复用各自拥有的不变量。最低命令为相关 Vitest、typecheck、
`cargo test -p rovai-core --features extended-tests --lib member_bot_app_binding`、同入口 `wrong_provider_hosts`、
默认 workspace、Desktop build 与通用文档门禁。验证结果见下表。

## 治理复核

保持 current_version 为 v1.72，沿用既有不可换绑和本地恢复原则；未新增 Version Decision。
Architecture、当前渠道合同、Host Web 合同与渠道 UI 同步。无 Schema/Migration、Runtime 活动映射、
Bootstrap/Dynamic Context/模型 formatter 版本变化；修复既有 botOpenId 缺失不改变模型输入合同。
Runtime 兼容矩阵与根 README 无需更新。本地 SDK/Host 夹具不替代真实租户或跨平台资格。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 全量 Vitest | 278 个文件、3293 项通过，2 项原有 skipped |
| Rust workspace | 484 项通过、1 项原有 ignored；无失败 |
| Rust binding / Provider owners | 两项定向扩展均通过，包含 disabled、身份不一致、CAS 与跨 Host 拒绝 |
| SDK CJS / ESM 子进程 | 超时、取消、迟到 endpoint、真实首连失败后复用 channel、跨 WS 去重和 Retry-After 均通过 |
| TypeScript / Desktop build | 通过；构建只有既有 chunk size 等提示 |
| 通用文档门禁 | docs:test、docs:check 与以初始基线为 base 的 docs:check:ci 通过 |
| 隔离浏览器验收 | 真实 Host + 生产 Web/Main adapter，恢复、终态继续核对、双主题、720px 无横向溢出、审批与独立 Server 边界通过 |

浏览器仅注入 Provider 服务夹具，使用各自临时 data、Skills、MCP 与 Chrome profile，不访问日常数据；
不执行真实租户发布，也不启动 Electron 或调用模型。验收脚本同步修复既有 TS adapter 加载、登录按钮选择器、
缺省 presentation preference 假设和 viewport 切换时的等待。截图与 validation.json 位于本次 Thread 附件目录的
`feishu-ws-recovery-ui/`，生成物不进入 Git。日常安装版未替换。

Core 切代次回归还发现旧 Host stop 未清除 started 标记，已修正；停止时旧发布进度清空，新的状态从持久事实恢复。
本地确认暂不可用时保留已观察到的在线传输并重试保存；SDK 循环中的 connect 等待真实 ready，不能提前报告成功。
