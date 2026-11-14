---
document_type: implementation-record
version: v1.72
last_updated: 2026-11-14
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
watchdog 在 transport ready 时即结束，不覆盖 Core 本地收尾；已在线而保存结果失败时维持在线并重试本地确认。
endpoint 先分类 code，成功才读取 data；body 错误、HTTP 错误与身份阶段共享安全分类。
endpoint 显式保留响应头；HTTP 200 业务限流仍取两个等待头的较大值，同时兼容默认客户端包装响应和自定义客户端直接返回业务体。
限频码 99991400/HTTP 429 可重试并保留平台 reset 秒数与 Retry-After，IP 白名单 99991401 为配置终态；
Host 不再以通用 permission_denied 标签推断凭据被拒。SDK 导出 connection cause 类型，身份超时与取消使用同一错误形态。

新增 `memberBot.observeConnection`，只更新 exact 已发布 Bot 的可观测身份。不同的已有非空 botOpenId
拒绝，Owner、绑定、published_at 不变。最新且只差连接验证的 intent 可在本地 CAS 完成，不重放远端 mutation。
普通首次发布保留欢迎卡，自动/手动恢复不补发。网络错误不推断登录失效。
历史 Owner 映射未验证时暂缓观测与 intent 收尾，保留入站；可信 Owner 首条消息补验证后继续。Core 快照对
空 open_id_digest 的行显示未验证。新的观测尝试不复用旧 Owner 状态下的拒绝回执；CAS 收尾固定原 intent，
出现更新 intent 即停止，冲突耗尽保留可恢复失败。

已发布事实与运行期连接状态分开。未知运行期显示 unknown；自动恢复显示 reconnecting；身份/凭据/配置终态
显示需处理并保留“继续核对”。合法 channel 在 WS 重建期间仍可 HTTP 外发及下载附件；身份冲突停止该记录的
所有传输。Core 原有最多五次 delivery 尝试仍适用，终结的 delivery 不因网络恢复自动重放，不保证入站全部补发。
首发只差连接时返回“Bot 已发布，正在重连。”进度，不返回普通发布错误；Dialog 可关闭，隐藏重复提交。
保留窗口直到后台 completed 时只显示“完成”，不能再次发起发布；不自动关闭用户仍在查看的结果。
仅在自动重连或已观察到离线时于发布文字旁显示用户选定的 A 断链图标，原因通过悬浮、聚焦或点击提示；恢复后图标消失。
正常在线、首次连接中、运行期未知和本地确认未完成不显示图标或连接描述。
普通超时、断网和限频合并呈现自动恢复；持续不可用时仅在 Tooltip 中提示检查网络或代理。
只有明确配置终态保留核对动作。读屏原因只由按钮名称播报一次。
品牌迁移、身份冲突和 IP 白名单错误在提示中准确说明；品牌迁移不提供无效核对动作。

## 验证归属

- `feishu-ws-lifecycle.test.ts`：真实 ws 子进程、CJS/ESM、超时后迟到 101/endpoint、关闭后请求/socket 不增长、
  null/缺失 data 与 HTTP 错误分类、默认 HTTP 客户端 HTTP 200 endpoint 业务限流与成功解包、身份/Token 限频、
  无限重连真实计划时间、稳定 channel 终态后复用及去重。
- `bot-connection.test.ts`：single-flight、责任交接、watchdog 与慢 Core 的时序、只取消当前尝试、HTTP 保留、提醒与终态。
- `channel-settings.test.ts`：Host/Core 代次边界、Owner 暂缓与补验证、最新 intent/CAS/耗尽且不重放远端 mutation、
  重连期间真实 Host delivery 走 HTTP、身份冲突后 delivery/附件被拒、原发布与消息回归。
- 原 Rust binding owner：填空、相同 no-op、显示名、冲突、CAS、Owner/发布时间不变。
  原 Provider owner：交叉 Host 拒绝、Feishu/Lark 空 Owner digest、disabled 和绑定不符拒绝。
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
| 全量 Vitest | 278 个文件、3305 项通过，2 项原有 skipped（maxWorkers=4） |
| Rust workspace | 484 项通过、1 项原有 ignored；无失败 |
| Rust binding / Provider owners | 两项定向扩展均通过，包含 disabled、身份不一致、CAS 与跨 Host 拒绝 |
| SDK CJS / ESM 子进程 | 迟到 101/endpoint、首连/终态/取消后复用、单轮真实计划、跨 WS 去重、身份/Token 分类与两类限频头均通过 |
| TypeScript / Desktop build | 通过；构建只有既有 chunk size 等提示 |
| 通用文档门禁 | docs:test、docs:check 与以初始基线为 base 的 docs:check:ci 通过 |
| 隔离浏览器验收 | 真实 Host + 生产 Web/Main adapter，恢复 Dialog 无失败 alert/重复提交、信号图标与 Tooltip、终态操作、双主题、720px 两列重排且单元格不越界、审批与 Server 边界通过 |
| 独立实现复审 | 响子对代码提交 `975ddd998` 复审通过，SDK 与 Host/Core 恢复闭环无剩余阻塞；独立重跑三个连接相关测试文件，106 项通过 |
| UI 定向复审 | 响子对 `c89ef5b76` 复审通过，无阻塞；独立重跑 Renderer 21 项通过。收尾保留持续故障指引、去除重复描述关联，并扩展正式 smoke 的聚焦/点击/失焦/外部点击/滚动/resize/右侧夹取断言 |
| 信号图标呈现 | Renderer/Host adapter 定向 38 项、typecheck、Desktop build 通过；生产 Host/Web 验证悬浮提示与恢复动作，离线交互稿 18 项通过，含聚焦、点击、Escape、视口边界；SDK/Core 未变化 |
| 仅连接异常显示 | 正常在线、首次连接中、未知与本地确认等待均隐藏图标；自动重连/离线显示。上述 38 项、类型与构建通过；生产 Host/Web 验证恢复后图标和已打开的 Tooltip 一同消失，发布事实与动作保留 |
| A 断链图标定稿 | 用户选定的 A 图形落入正式组件，替换信号强度柱；Renderer 21 项、typecheck、Desktop build 与生产 Host/Web 浏览器验收通过，原 Tooltip 与恢复后隐藏规则保留；SDK/Core 未变化 |
| 两项 P2 收尾 | 在 `d1890569c` 独立复现 HTTP 200 业务限流丢失 180 秒等待头，以及开窗后台完成后重新出现发布按钮；修复后五个相关测试文件 144 项、typecheck、Desktop build 和真实 Host/Web 浏览器回归通过。CJS/ESM 兼容默认包装与原有自定义业务体；完成态只有“完成”，操作记录未增加发布请求 |

浏览器仅注入 Provider 服务夹具，使用各自临时 data、Skills、MCP 与 Chrome profile，不访问日常数据；
不执行真实租户发布，也不启动 Electron 或调用模型。验收脚本同步修复既有 TS adapter 加载、登录按钮选择器、
缺省 presentation preference 假设和 viewport 切换时的等待。截图与 validation.json 位于本次 Thread 附件目录的
`feishu-ws-p2-ui/`；新版单文件交互稿位于 `feishu-ws-recovery-prototype-p2/`，生成物不进入 Git。日常安装版未替换。
真实租户、Electron 进程和 Windows 尚未验收。独立复审建议合并前在隔离 userData 下使用真实飞书或 Lark Bot
完成一次断网后恢复冒烟，并确认没有未捕获异常；已有自动验收不能替代这项结果。分支保留为 ready，尚未合并。

Core 切代次回归还发现旧 Host stop 未清除 started 标记，已修正；停止时旧发布进度清空，新的状态从持久事实恢复。
本地确认暂不可用时保留已观察到的在线传输并重试保存；SDK 循环中的 connect 等待真实 ready，不能提前报告成功。

全量前端首轮并行运行中，既有真实文件 watcher 用例一次等待超时；单独复跑 59 项通过，
随后限制四个 worker 的全量 278 文件通过。未改该用例或文件预览实现。
频控事实参考[飞书消息 FAQ](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/guide/faq)，
reset 头的秒数语义参考[官方 Lark CLI 解析器](https://github.com/larksuite/cli/blob/main/internal/ratelimit/headers.go)。
