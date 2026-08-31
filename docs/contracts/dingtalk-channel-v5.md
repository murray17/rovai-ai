---
document_type: protocol-contract
contract: dingtalk-channel-v5
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 5
last_updated: 2026-08-31
---

# DingTalk Channel v5 Contract

继承 [DingTalk Channel v4](dingtalk-channel-v4.md) 的 Web Session 身份、Cookie schema 2、SSO 续接、SQLite/CAS、
Console 发布、同应用恢复和全部入站/投递边界。本版只替代交互式登录的窗口呈现及取消行为，不改变 Core schema、
Bot 发布、Stream、Owner 身份、项目绑定或断开连接语义，不新增 Migration。

## 1. Rovai 内置扫码

连接钉钉 → Rovai QR Dialog → Main 隐藏加载官方登录页 → 展示该页当前二维码 → 扫码/必要交互
→ `/baseInfo` 读取完整身份 → Core 原子提交 → 激活新 Session。

- 使用同一个 staged、非 persist 的 Electron Session，不借用 Chrome 或日常实例，不打开系统浏览器或独立可见登录窗口。
- 二维码来自官方登录页唯一、可见且未被遮挡的已识别 QR canvas。只允许有界 PNG data URL（≤262,144 字符），
  不把任意图片、整页截图、隐藏 canvas 或猜测 URL 当作二维码。不自行签发二维码或实现另一套认证协议。
- DOM 读取只产出封闭的 `qr/scanned/expired/interaction/loading` 观察；不向 Renderer 传原始页面文本、表单、Cookie、
  Token、身份响应或含凭据 URL。读取当前 frame，不等待无关资源全部加载完毕。
- 官方页面需要企业选择/确认或无法可靠提取二维码时，Dialog 展示 Main-owned `WebContentsView`。
  它没有 Rovai preload、Node 或页面权限，保持 sandbox/contextIsolation；既有官方导航 allowlist 和禁新窗口规则不变。
  Renderer 不使用 iframe/webview，也不获取控制该页 URL、脚本或 Session 的通用能力。
- 原生页只放入 Dialog 的可见内容矩形；缩放、窗口改变、滚动与动画结束后重新测量，越界的迟到矩形隐藏而非覆盖其他区域。
  页面及隐藏 host 在完成、取消、父窗口退出后清理；原生页的 Escape 同样取消登录。

## 2. Main/Renderer 登录投影

继续使用 `ChannelSettingsSnapshot` schema 4 的 `activeQrAttempt`，`kind=dingtalk`；新增 `awaiting_interaction` 阶段。
当前阶段为 `loading_local_session / preparing / awaiting_scan / scan_confirmed / awaiting_interaction / expired /
inspecting_identity / saving_local_session / connected`。detail 是 Main 固定安全文案，不是网页原始文本。

`qrDataUrl` 只在 awaiting_scan 保留，离开该阶段即清除。平台未提供可信绝对过期时间时 `expiresAt=null`，不伪造倒计时；
实际过期由官方页面状态决定。10 分钟本地 attempt 上限是 Rovai 等待期限，不是平台 Session 或二维码有效期承诺。

新增 typed Preload 呈现操作（只允许 Rovai Main window sender）：

```ts
setLoginViewBounds(attemptId: string, bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>
refreshLoginQr(attemptId: string): Promise<void>
```

矩形严格只有四个有限非负数，尺寸大于零、每项不超过32,768；null 表示移出当前 Dialog。只有 exact active attempt
且 awaiting_interaction 可设置非空矩形；失效 attempt 不影响后续登录。刷新仅允许 exact attempt 的 awaiting_scan/expired，
重新加载同一个官方页面，沿用 staged jar 和原 attempt 截止时间；新 page generation 拒绝迟到二维码。
两项操作只改变 Main 临时呈现，不排队等待未完成的 login，不写 Core 或 SQLite。

## 3. 取消与失败

- 取消 exact attempt 立即 abort、移除原生页并清除登录投影。完成清理前仍保留单一 attempt 锁，不能并行开始第二次登录。
- `dingtalk_operation_cancelled` 是成功的 no-op，`connect()` 不通过 IPC 抛出；Renderer 对历史/自定义 Error 包装中的
  同一精确代码也静默。取消不形成 failed state、页面 alert 或 toast，不提交/过期/删除原账号、Session 或 Bot credential。
- 迟到身份、二维码和阶段不能重新打开 Dialog 或提交连接。失败的初始本地读取也必须释放 attempt，使下一次连接可重试。
- 只有 Core 原子提交及激活的短暂 `saving_local_session` 阶段禁用取消；不能在事务提交后以“取消”为由回滚已提交账号。
- 真正的网络、身份、超时、存储失败继续显示安全可操作错误，保留原会话；不能通过吞掉所有异常来达成静默取消。

## 4. 验证边界

单元回归覆盖阶段、刷新、exact-attempt/late callback、旧账号保留和 native view 生命周期。真实 Electron fixture 使用
生产 Renderer、preload、DOM observer 和 `WebContentsView` 验证二维码、慢资源、关闭、缩放/裁剪与秘密隔离。
受控 fixture 或匿名官方 QR 读取不等于用户扫码后的组织/安全挑战、SQLite 原子连接、真实发布及 packaged 验收。
v4 已记录的真实发布/SSO 证据继续有效，尚未完成的外部端到端 NO-GO 项保持原状。

## References

- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md#渠道连接与二维码)
- [Channel Storage v2](channel-storage-v2.md)
- [隔离验收](../development/local-workflow.md#钉钉-web-session-验收前置)
