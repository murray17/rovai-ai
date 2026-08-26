# Rovai AI 主动更新探测交互稿

这是一份自包含、可交互的 HTML 评审稿，用于确认 Rovai AI 从“手动检查后自动下载”调整为：

```text
应用启动或周期任务自动检查
→ 发现新版本并提醒
→ 用户确认下载
→ 后台下载并同步进度
→ 用户确认安装并重启
```

自动检查可以主动发生；下载、安装和重启都不能替用户决定。

本目录只包含原型和评审说明，不修改生产代码、当前 Contract、版本文档或 surface brief。示例版本、日期、
Release 名称、更新日志、文件大小和速度均为交互演示数据，不证明对应 Release 已经存在。

## 文件

- `index.html`：自包含交互稿，无外部字体、图片、脚本、样式或网络加载依赖。
- `README.md`：状态合同、评审路径、生产边界与后续文件清单。

## 预览

可直接双击或运行：

```bash
open docs/prototypes/proactive-app-update/index.html
```

也可以从仓库根目录启动一个只读静态服务器：

```bash
python3 -m http.server 4173 --directory docs/prototypes/proactive-app-update
```

然后打开 `http://127.0.0.1:4173/`。

页面底部的虚线区域明确标为“原型评审工具 · 非产品界面”。它用于切换页面、操作状态、独立的 Release
事实、Release Notes 变体与 Day/Night；可收起，不属于生产 App。

## 推荐评审路径

### 1. 自动检查与精确 dismiss

1. 初始进入普通 Camp，可看到 `v0.0.3` 更新提醒。
2. 点击“稍后”或关闭按钮。
3. 点击“设置”文字区，进入 `lastSettingsSection` 保留的“通用”页；返回后点击右侧“更新可用”徽标，才直接进入“关于与更新”。
   两者是相邻但独立的键盘目标，不让同一个设置入口随更新状态改变去向；徽标成功打开同版本 About 后会
   精确 dismiss 当前 `pendingPrompt`，返回 Camp 不会再次弹出同一代提醒。
4. 点击评审工具中的“模拟下一轮自动检查”，会产生新的 `pendingPrompt` 代次，并再次显示提醒。
5. 点击“查看更新内容”，只有导航成功后才清除该代次，并把焦点和滚动位置送到更新日志。

评审工具中的 `pendingPrompt` 和“最近 dismiss”只是帮助验证 Main-owned 代次语义；生产 UI 不应显示内部
prompt ID。提醒是非模态的 polite live region，出现时不主动移动焦点。

### 2. 用户确认下载与互斥反馈

1. 在全局提醒或“关于与更新”页点击“下载更新”。
2. 按钮立即进入 disabled/`aria-busy` 状态，并持续显示百分比。
3. 进度区显示百分比、已传输/总量与速度；设置入口和“关于与更新”行同步显示进度徽标。
4. 同一下载期间没有第二个可点击的下载入口；重复调用在生产合同中应合并为同一 in-flight Promise。
5. 下载完成后进入 `ready_to_install`，只有“安装并重启”能进入 `installing`。

### 3. 手动检查不弹提醒

在“关于与更新”页点击“重新检查”或“检查更新”。页面进入 `checking`，检查完成后回到 `available`，但
不会创建新的 `pendingPrompt`。如果此前已有未处理的自动提醒，手动检查不应伪造新代次或篡改其来源。

### 4. 操作状态与有效 Release 分离

在评审工具中依次选择：

- `检查中（保留旧 Release）`；
- `首次检查中（无旧 Release）`；
- `检查失败（保留旧 Release）`；
- `检查失败（无旧 Release）`；
- `发布信息无效`；
- `自动更新不可用`。

在“保留旧 Release”变体里，页面上方描述当前操作，更新日志继续显示最后一次成功检查得到的 `v0.0.3`；
低打扰徽标表达仍成立的“更新可用”事实，而不是把一次检查失败误当成 Release 已失效。原型把时间含义
呈现为：

- “本次检查”：最近一次 attempt 完成时间与来源；
- “上次成功”：最近一次成功完成检查的时间；
- Release 名称、日期、版本与日志来自 `availableRelease`，不会在下一次 check 开始时清空。

“Release 事实”选择器只在检查中、普通检查失败和自动更新不可用这些允许两种事实组合的状态启用。将它
切到“无有效 Release”时，页面隐藏目标版本与日志；首次检查的 attempt 显示“进行中”，尚未发生的 attempt
与 success 显示“尚无”。`invalid_release` 不会伪造目标版本，也不会提供备用安装入口。

正式 Contract 应明确 `checkedAt` 的语义；建议将其定义为最近一次 attempt 的完成时间，并另外保留
`lastSuccessfulCheckAt`，避免“开始时间 / 完成时间”歧义。

### 5. 安装、受控退出与恢复

选择 `可安装`，点击“安装并重启”：

- 页面进入 `installing`，并说明窗口可能随即关闭；
- 原型不承诺一个 Renderer overlay 会持续到 Core drain 完成；
- UI 只证明用户已发起安装，不证明 planned shutdown、安装或重启已经成功。

再切换到 `安装失败`：已下载的 Release 仍保留，主动作是“重试安装”，且不出现 GitHub fallback。目标
生产协调器必须保证同步安装失败时 App 与 Core 仍可继续使用，不能先永久关闭 Core 再尝试安装。

### 6. Release Notes 边界

评审工具提供四种内容：

- 常规：标题、列表与正文；
- 为空：显示“此版本暂无更新说明”；
- 超长内容：验证纵向阅读、长中文与窄窗口，不产生页面级横向滚动；
- 安全 Markdown：展示标题、列表、行内代码、代码块、HTTPS 链接与非 HTTPS 惰性文本；HTML、图片和脚本
  不进入 DOM。

原型使用安全的 DOM API 构建示例内容，没有把 Release Notes 传给 `innerHTML`。生产 Renderer 应复用现有
`SafeMarkdown`，Main 先完成长度限制、日期校验，以及 `string | unknown[] | null` 到 `string | null` 的
确定性归一化。

## 视觉与交互决定

- 延续 Porcelain Day / Steel Night，同一组件树只切换语义 token。
- 普通 Camp 保留 270px rail 与 50px topbar；设置页仍使用 270px 分组导航和 1040px 内容轨。
- 全局更新提醒复用“协作完成”通知的 340px heads-up 骨架、单层 raised surface、文字层级、关闭位置与入场
  节奏；去掉独立图标块、强调色顶边、版本分隔行和有底色的动作栏。它仍是 update 专用状态，不伪装成
  Notification Episode，只在正文下追加一行紧凑动作以保留“稍后 / 查看更新内容 / 下载更新”。
- Camp 中的 heads-up 位于右下操作区，但为固定 composer 预留 126px（矮窗口为 124px），不遮挡输入框和发送按钮；设置页没有
  composer，浮层贴近右下 18px。
- 全局 overlay slot 同时只能容纳 update heads-up、普通 heads-up、Dialog、首次训练或 shutdown surface 中的
  一个。生产实现需定义仲裁顺序；本原型只挂载 update slot，不演示叠放。
- 当“关于与更新”正在展示同一目标版本时，不在页面上再叠一张更新提醒。
- 徽标同时使用图标、文字、颜色和稳定位置：`更新可用 / 百分比 / 可安装 / 重试下载 / 重试安装 / 重启中`。
- “设置”主按钮始终恢复持久化的 `lastSettingsSection`；只有用户在设置侧栏显式选择分区才更新该值。旁边的
  更新徽标是独立深链，存在更新、下载、可安装或失败事实时一键打开“关于与更新”，但不覆盖主入口记忆。
  无相关状态时徽标隐藏，“设置”的去向仍不变。
- 浮层只使用现有通知体系的一层 elevation；设置正文保持开放分区、分隔线和少量 raised row，不形成卡片墙。
- Focus 使用 2px `--focus` 与 2px offset；导航到设置、返回 App、关闭提醒以及动作按钮变为 disabled 时，
  焦点会落到对应页面或稳定状态区域。“查看更新内容”会把焦点与滚动位置送到更新日志。
- 动效只有提醒的短入场、busy 旋转和进度变化，并遵守 `prefers-reduced-motion`。

## fallback 状态矩阵

| 状态 / 原因 | 主动作 | 官方 Releases / 支持入口 |
|---|---|---|
| `available` | 下载更新 | 不显示 |
| 普通 network `check_failed` | 重试检查 | 不显示 |
| `invalid_release` | 稍后重试检查 | 不应引导安装未验证包 |
| `updater_unavailable` | 重试检查 | 显示 |
| `download_failed` | 重试下载 | 显示 |
| `install_failed` | 重试安装 | 不显示 |

## 已采用的生产快照与 API 边界

生产实现已经按以下分离思路写入正式 Contract；权威定义见
[`docs/contracts/app-update-v1.md`](../../contracts/app-update-v1.md)：

```ts
type AppUpdateCheckSource = 'startup' | 'interval' | 'manual'

type AppUpdateRelease = {
  version: string
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string | null
}

type AppUpdatePrompt = {
  id: string
  version: string
}

type AppUpdateSnapshot = {
  status: AppUpdateStatus
  currentVersion: string
  availableRelease: AppUpdateRelease | null
  lastCheckSource: AppUpdateCheckSource | null
  checkedAt: string | null
  lastSuccessfulCheckAt: string | null
  pendingPrompt: AppUpdatePrompt | null
  downloadPercent: number | null
  transferredBytes: number | null
  totalBytes: number | null
  bytesPerSecond: number | null
  failureReason: AppUpdateFailureReason | null
}
```

Renderer API 为：

```text
get / check / download / install / dismissPrompt / onChanged
```

`check()` 对 Renderer 永远表示 `manual`；`startup` 与 `interval` 只由 Main 内部调度。Main 需要持有
`checkInFlight`、`downloadInFlight`、安装/退出协调器和 `pendingPrompt`，而不是依赖瞬时 Renderer 事件。

## 从原型到生产实现的同步范围

本分支已完成下列代码、合同、文档与测试同步；这份清单特意保留在原型旁，避免把实现范围误缩为最初方案中的
6 个文件。跨平台真实旧版升级仍属于 Release acceptance，而不是 HTML 原型或单元测试能够证明的事实。

### Main、Preload 与合同

- `apps/desktop/src/main/app-updates.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `packages/contracts/src/index.ts`
- Main 初始化局部降级、一次性调度注册、完成后再排 6 小时 timeout 与退出时 timer disposal
- 可测试、幂等的更新安装 / planned shutdown 协调器

### Renderer

- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/CampNavigation.tsx`
- `apps/desktop/src/renderer/src/AboutUpdatesSettings.tsx`
- `apps/desktop/src/renderer/src/SafeMarkdown.tsx`（已复用，未重新实现解析器）
- `apps/desktop/src/renderer/src/styles.css`
- 现有成员页未保存草稿保护与“关于与更新 → 更新日志”的成功导航 / focus 路径
- 全局 update heads-up 与普通 heads-up、Dialog、首次训练、shutdown surface 的互斥仲裁

### 测试与确定性验收

- `apps/desktop/src/main/app-updates.test.ts`
- `apps/desktop/src/renderer/src/AboutUpdatesSettings.test.ts`
- `apps/desktop/src/renderer/src/App.test.ts`
- `CampNavigation` 徽标与可访问名称测试
- “设置”主入口恢复 `lastSettingsSection`、更新徽标独立深链 About、返回焦点回到真实触发按钮的测试
- `SafeMarkdown` 的超长、HTML、图片、数组归一化与 HTTPS-only 复用测试
- `scripts/accept-app-updates-ui.mjs`
- 自动检查隔离开关或 deterministic fake updater fixture，避免 packaged UI 验收受真实网络竞态影响
- 自动 / 手动并发、dismiss 精确代次、窗口重建恢复、双击下载 / 安装幂等和失败后重试测试

### 文档与平台验收

- `apps/desktop/.impeccable/surfaces/settings-workspace.md`
- `docs/ui/components/app-shell-navigation.md`
- `docs/development/packaging.md`
- `docs/development/ui-acceptance.md`
- 当前版本 overview、implementation plan 与 acceptance 文档
- 若该取舍需要跨版本长期保存，再写入当前版本 Decision；不要创建数字 ADR
- macOS arm64、macOS x64 与 Windows x64 的真实旧版 → 新版升级证据：Core planned shutdown、安装、重启、
  新版本启动与安装失败恢复都必须在 Release acceptance 中各自得到证明

修改任何上述当前权威文档时，需按仓库文档治理运行通用门禁。本原型不替代 Architecture、Contract、
版本范围或真实打包验收。

## 原型边界

- 没有真实 Electron updater、IPC、Main timer、GitHub Release 请求、签名、校验、安装或重启。
- 下载进度和状态切换是本地演示；刷新页面会复位。
- “下一轮自动检查”只模拟新代次，不实现六小时调度。
- 没有实现成员页未保存草稿；“查看更新内容”的路径只演示导航成功后的 dismiss、scroll 与 focus。
- 没有实现 Core drain、Runtime planned stop、Desktop watchdog 或安装器进程。
- 外部 Releases / Issues 链接是 fallback 动作，不是页面渲染依赖；离线打开原型不受影响。

## 视觉验收目标

- `1440×920`：Day / Night，Camp 提醒、available、downloading、ready、长日志。
- `1040×700`：Day / Night，Camp 提醒、check/download/install failure、长日志。
- 键盘顺序、focus-visible、非模态提醒不自动夺焦点。
- `prefers-reduced-motion` 下内容与状态不依赖动画。
- 页面、设置主区、Release Notes、fallback 链接和评审工具均无页面级横向溢出。

原型完成时应同时执行静态 HTML / JavaScript 语法检查、Impeccable detector 和真实浏览器截图检查；这些
只证明原型自洽，不证明生产实现已完成。

## 本次验证记录

- HTML5 解析、内联 JavaScript 语法、重复 ID、可访问名称、`aria-labelledby` 引用、HTTPS 外链保护、
  selector 引用、尾随空白与关键主题对比度均已做静态检查。
- Impeccable detector 已执行一次；本机未安装它的可选解析器，因此以降级模式运行，唯一可执行告警
  `transition: width` 已修正，其余为既有产品字体、圆角和 macOS traffic-light fixture 的提示。
- 项目提供的 in-app Browser 在交稿时返回“没有可用 Browser”；随后使用本机缓存的 Chromium headless
  shell 补做了真实浏览器验收。已检查 `1440×920` 的 Day/About available 与 Night/Camp heads-up，及
  `1040×700` 的 Night/downloading、Day/超长日志和 Night/download failed；视觉层级、内部滚动和主题可读性
  均正常。
- 在 `1040×700` 下对 14 个状态分别跑完 Day/Night，共 28 个组合；document、body 与产品 frame 的
  `clientWidth` 均等于 `scrollWidth`，没有页面级横向溢出。
- 浏览器行为检查确认：下一轮自动检查生成新 prompt 且不夺走 Camp composer 焦点；精确 dismiss 后徽标保留
  并把焦点接回 composer；“查看更新内容”把焦点送到更新日志；手动检查完成后不生成 prompt；下载动作立即
  disabled 且带 `aria-busy=true`；安装只从 ready 状态进入；`prefers-reduced-motion: reduce` 命中且动画时长
  降为近零。
- 本轮将更新提醒收敛到“协作完成”通知样式后，又用本机 Google Chrome headless 重渲染了 Day/Camp 初始态
  的 `1440×920` 与 `1040×700`：340px heads-up、紧凑动作行、右上关闭与底部评审工具均完整可见，没有
  页面级横向溢出或动作折行。
- 本轮移至右下并拆分设置入口后，再次在 `1440×920`、`1040×700` 实际渲染，并通过 Chrome DevTools
  Protocol 走完路径：矮窗口 heads-up 与 composer 外框相隔 6px、与输入框相隔 42px；“设置”进入上次的
  “通用”页并回焦原按钮；更新徽标进入 About、精确 dismiss 同版本 prompt 并回焦徽标；无更新时徽标隐藏且“设置”
  仍恢复“通用”。页面级横向溢出为 0。
