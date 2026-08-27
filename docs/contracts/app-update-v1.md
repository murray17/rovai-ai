---
document_type: protocol-contract
contract: app-update-v1
authority: desktop-application-update-state-actions-and-prompt-generation
status: accepted
version: 1
last_updated: 2026-08-26
---

# App Update v1 Contract

本合同冻结 Rovai AI 桌面应用的主动检查、显式下载、显式安装、全局提醒与 Renderer 投影。它只适用于
正式打包 App；开发构建和 updater 不可用的包仍暴露同一快照，但不得伪造可下载版本。

## 1. Main ownership and schedule

Electron Main 中的单例更新服务是唯一状态源。Renderer 打开页面时先调用 `get()`，随后订阅
`onChanged()`；事件丢失、窗口晚创建或重建不能改变 `get()` 返回的当前事实。

正式打包版本在主窗口首次 `did-finish-load` 后 5 秒开始第一轮自动检查。每轮自动检查完成后再等待
6 小时安排下一轮，不使用会和长检查重叠的固定 `setInterval`。Main 退出时取消 timer。开发构建不自动
检查；隔离验收只有同时满足隔离实例 admission 和专用禁用变量时才能关闭自动检查。

同一轮 `check` 只存在一个 in-flight Promise。`startup | interval | manual` 参与者可以合并；只要该轮
含任一自动来源，成功发现新版时就保留自动提醒语义。检查、下载或安装正在进行时不启动第二轮检查。
自动检查失败只写日志和快照，不打开 dialog 或错误提醒。

## 2. Snapshot

```ts
type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'ready_to_install'
  | 'installing'
  | 'check_failed'
  | 'download_failed'
  | 'install_failed'

type AppUpdateCheckSource = 'startup' | 'interval' | 'manual'

type AppUpdateRelease = {
  version: string
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string | null
}

type AppUpdatePrompt = { id: string; version: string }

type AppUpdateSnapshot = {
  currentVersion: string
  status: AppUpdateStatus
  availableRelease: AppUpdateRelease | null
  lastCheckSource: AppUpdateCheckSource | null
  checkedAt: string | null
  lastSuccessfulCheckAt: string | null
  downloadPercent: number | null
  transferredBytes: number | null
  totalBytes: number | null
  bytesPerSecond: number | null
  failureReason:
    | 'network'
    | 'updater_unavailable'
    | 'invalid_release'
    | 'download_failed'
    | 'install_failed'
    | null
  pendingPrompt: AppUpdatePrompt | null
}
```

`status` 描述当前操作或最近一次结果；`availableRelease` 是独立的最后一次有效新版事实。新检查开始或
失败不能清除旧 release，因而 `checking | check_failed` 可以和非空 `availableRelease` 同时存在。只有成功
返回 up-to-date 才清除 release、下载进度和 prompt。

`checkedAt` 是本轮尝试开始时间；`lastSuccessfulCheckAt` 是最近成功取得有效 available 或 up-to-date
结果的完成时间。下载或安装失败不改写两者。进度仅在下载真正开始后从 0 出现，`available` 时四个
进度字段均为 `null`。

版本必须是有效稳定 semver；发布日期必须可解析；名称最多 500 字符；更新日志规范化后最多
100,000 字符。`electron-updater` 的 release-note array 按输入顺序确定性合并，未知项丢弃。Renderer 必须
使用 Safe Markdown，忽略 HTML、图片与非 `https://` 链接，不能执行远程内容。

## 3. Prompt generation and dismissal

`pendingPrompt` 只存在于 Main 内存，不写磁盘，也没有 `snoozedUntil`。自动检查成功且发现新版时创建新的
不可预测 `id` 并绑定版本；手动检查不创建 prompt。Renderer 只能通过
`dismissPrompt(exactPromptId)` 清除当前一代；过期、空或不匹配 ID 返回 `false`，不能关闭后来的一代。

“稍后”和关闭按钮精确 dismiss 当前一代。下一轮自动检查仍发现新版时创建新 ID，所以同一进程每六小时
可以再提醒；重启后启动检查也可以重新提醒。“查看更新内容”只有在成员未保存草稿 guard 通过、About
页面真实渲染同一版本并成功定位更新日志后才 dismiss。导航取消、渲染失败或版本不匹配时保留 prompt。

专用更新提醒是非 modal、无自动消失、不抢焦点的右下角轻量浮层。它不得和普通通知 heads-up、任一 modal
dialog、Onboarding、受控关闭或同一版本的 About 页面叠放；普通通知优先。窗口不可见或没有焦点时不显示。

## 4. Actions and idempotency

Preload 只向当前主窗口暴露：

```ts
interface AppUpdatesApi {
  get(): Promise<AppUpdateSnapshot>
  check(): Promise<AppUpdateSnapshot>
  download(): Promise<AppUpdateSnapshot>
  install(): Promise<boolean>
  dismissPrompt(promptId: string): Promise<boolean>
  onChanged(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}
```

- `check()` 始终是 `manual`，只更新共享快照，不生成全局提醒；
- `download()` 只从持有 release 的 `available | download_failed` 进入 `downloading`，重复调用返回同一个
  in-flight Promise；provider 的 reject 与 `error` event 对一轮最多结算一次；失败后的主动作是重试下载；
- 下载成功进入 `ready_to_install`，绝不自动安装或退出；
- `install()` 只从 `ready_to_install | install_failed` 进入 `installing`；重复安装幂等；同步 installer
  启动失败回到 `install_failed` 并返回 `false`，App 和 Core 继续可用；
- `autoDownload=false`、`autoInstallOnAppQuit=false`、`allowPrerelease=false`，检查结果不能绕过用户确认。

## 5. UI projection and fallback

普通“设置”主按钮始终恢复 `lastSettingsSection`。存在可操作 release 时，按钮旁显示独立、可键盘聚焦的
状态徽标，点击它才深链到 About；这个临时深链不覆盖设置记忆。“关于与更新”行同步显示非交互徽标。
`available/checking/downloading/ready_to_install/installing/check_failed/download_failed/install_failed` 必须拥有
可访问文字，不能只靠颜色区分；无可操作 release 时不显示徽标。

About 始终显示当前版本，且在 release 存在时显示目标版本、可用发布日期和更新日志。长日志在页面内部
有界滚动并可换行；空日志显示明确空态。下载显示百分比、已传输/总量和速度。`ready_to_install` 只有用户
点击“安装并重启”才进入 `installing`。

官方 GitHub Releases / 支持链接只在 `updater_unavailable` 或 `download_failed` 时出现。普通网络错误和
无效 release 不提供安装 handoff；无效 release 不能产生下载或安装动作。

## 6. Install and controlled shutdown

Updater 必须先同步 stage/启动安装器，再触发 native quit。只有 updater 已接受安装，Main 的
`before-quit` 协调器才把 reason 冻结为 `update_install`，取消 update timer，复用唯一 Core shutdown Promise，
等待受控关闭后以 `app.exit(0)` 完成退出。不得在 installer 接受前预先关闭 Core；否则同步安装失败会留下
不可恢复的半退出 App。普通退出和更新退出共用同一有界 drain，重复 `before-quit` 不能启动第二轮。

真实跨版本升级仍需在签名 macOS arm64/x64 与 Windows x64 正式发布集合上分别验收。单元测试、fake updater
或未签名本地包不能证明签名连续性、发布清单正确或 installer 回滚。

## References

- [Desktop App Updates 架构](../architecture/desktop-app-updates.md)
- [Planned Shutdown](../architecture/planned-shutdown.md)
- [Planned Shutdown v3](planned-shutdown-v3.md)
- [设置工作区 surface brief](../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [V1.28-D13](../versions/v1.28/decisions.md#v1-28-d13)
