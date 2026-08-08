---
document_type: production-design
version: v0.49
authority: desktop-shell-and-renderer-contract
status: frozen
implementation_status: not_started
last_updated: 2026-08-09
---

# v0.49 通用与启动设置生产设计

本文冻结 v0.49 的 Electron Desktop Shell、Preload bridge 与 Renderer 交互合同。全局视觉、
布局、Token、状态和无障碍继续以 [Arctic Dawn V3](../../ui/arctic-dawn.md)为准；Camp、Member、
Memory 与 Navigation 的存在性继续以 Core 当前 Read Side 为准。本文不授权修改 Rust Core、
SQLite、Runtime、审批、执行或恢复协议。

## 1. 设置导航与 General 页面

设置覆盖侧栏固定为以下七项，顺序不可由字母排序或历史默认值改变：

1. 通用；
2. Skill；
3. MCP；
4. Agent 运行时；
5. 外观；
6. 通知；
7. 诊断。

全新安装第一次进入设置默认选择“通用”。每次用户选择分类后，Electron Main 原子保存
`lastSettingsSection`；之后从普通“设置”入口进入时跨 Main Window Session 恢复该分类。队员页
等明确深链到“Agent 运行时”时，该分类同样成为新的最后选择。

设置页仍是临时覆盖面：

- 进入设置前的当前稳定页面继续保存在 Renderer 会话中；
- “返回 App”返回该页面及其 Camp/Member/Tab，不强制进入 Quick Chat；
- 设置分类选择不改变 Restorable Location；
- 在设置中关闭窗口或退出应用，下一个 Main Window Session 仍按进入设置前最后成功显示的
  Restorable Location 解析，永远不直接打开设置。

General 页面只使用一个共享页头：

```text
Settings / General

通用
设置 Rovai-ai 的启动方式与窗口行为。
```

页头下方按“启动 / 窗口”排列两个无外框 section，使用现有 `section-block`、分隔线、Switch、
Radio 和 Button 语法，不增加卡片墙或第二层设置导航。

## 2. 启动区

### 登录时启动 Rovai-ai

第一行使用一个标准 Switch：

```text
登录时启动 Rovai-ai                       [开关]
登录 macOS 后自动打开 Rovai-ai。
```

状态完全来自 Electron Main 对 macOS `mainAppService` 的实时读取：

| Shell 状态 | Switch | 辅助文案与操作 |
| --- | --- | --- |
| `enabled` | checked | 已开启，无额外警告 |
| `not-registered` | unchecked | 默认说明 |
| `requires-approval` | checked | `等待系统授权，当前尚未生效。`；显示“打开系统设置” |
| `not-found` | unchecked | `未找到 Rovai-ai 登录项服务，请重新安装或修复应用。` |
| `development` | unchecked + disabled | `仅在已安装的 Rovai-ai 应用中可配置` |
| `loading` / `submitting` | 保留最近系统值 + disabled | 使用明确读取/保存中说明，不乐观声称生效 |
| `read-error` | 保留最近系统值或 unchecked | 显示可重试错误；不能写入应用 Boolean 作为替代真源 |

`requires-approval` 的 checked 只表示系统已经持有注册请求；同一行必须同时说明“当前尚未生效”，
不能仅靠开关暗示已经成功。用户关闭该开关时调用系统注销，并在读回 `not-registered` 后显示关闭。

“打开系统设置”由 Electron Main 打开 macOS 登录项设置位置。应用从系统设置重新获得焦点、General
页重新显示或用户完成一次开关写入后，都重新读取系统状态。Renderer 不轮询磁盘、不缓存期望值，
也不从上次提交结果猜测最终状态。

Development 判定使用 `app.isPackaged`。未打包的 Electron/Vite 进程不得调用
`setLoginItemSettings`，不得注册 Electron executable、开发目录、Shell wrapper 或隐藏启动参数。
已安装应用只使用 `type: "mainAppService"` 与 `openAtLogin`；禁止设置 `openAsHidden`、额外 CLI
参数、后台 agent/daemon service 或“登录后不显示窗口”。

Rovai-ai 安装或首次启动本身不调用注册 API；全新安装的默认状态因此是系统
`not-registered`/unchecked。若重装后 macOS 仍保留一条有效注册，应用诚实显示该系统状态，
不使用本地“首次运行”标记强制注销。

### 启动后打开

使用一个 `fieldset` 与两个原生语义 Radio：

```text
启动后打开

◉ 上次使用的位置
  恢复最近打开的对话、队员页或记忆页。

○ 快速对话
  每次启动都从快速对话首页开始。
```

默认值是 `last_location`。切换只保存下一 Main Window Session 使用的 Startup Location
Preference，不立即导航当前窗口，也不改变当前 Restorable Location。Radio 提交失败时恢复最近
成功保存的值、保留焦点并显示就地错误。

区末尾固定显示：

> 此设置只决定启动后显示的位置。已有 Camp、草稿、任务、审批和运行记录仍按 Rovai-ai 的
> 既有恢复规则处理。

## 3. Main Window Session 与一次性解析

Electron Main 每次调用 `createWindow()` 建立新的 Main Window Session，并为该窗口冻结一份
`DesktopStartupSnapshot`。启动解析在该会话中只能从 `unresolved` 前进一次，不能因 React
重渲染、Navigation refresh、Core restart 或窗口恢复再次开始。

| 事件 | 是否创建新会话 | 是否解析启动位置 |
| --- | --- | --- |
| 应用冷启动并创建窗口 | 是 | 是 |
| macOS 关闭最后窗口后从 Dock 重新创建窗口 | 是 | 是 |
| 已有窗口时第二实例唤醒 | 否 | 否，只聚焦/恢复 |
| 已有窗口时点击 Dock | 否 | 否，只聚焦/恢复 |
| 最小化后恢复 | 否 | 否 |
| Core restart / Navigation refresh | 否 | 否 |

Main 在创建窗口时读取 Startup Location Preference 与当时的 Restorable Location，随后对同一
窗口的重复 `desktopSession.getStartupSnapshot()` 返回同一冻结值。当前窗口内修改启动偏好只影响
之后创建的窗口。

Renderer 初始显示稳定的“正在恢复上次位置”启动门，不得先闪现 Quick Chat 再跳转。解析结果只
能是：

- `quick_chat`：显示 Quick Chat；
- `camp(campId)`：Core 确认当前 Camp 存在后显示；
- `members(agentId, tab)`：Core 确认 Member 可管理后显示对应队员与页签；
- `members(null, tab)`：进入队员页并按当前权威顺序选择首个可管理队员，或显示空状态；
- `memory`：显示记忆一级页；
- `waiting_for_core`：保留冻结目标，等待并重试权威读取。

用户偏好 `quick_chat` 时不验证旧恢复目标，只为本次窗口选择 Quick Chat。Quick Chat 成功显示后
仍依“成功显示即提交”成为新的 Restorable Location；之后改回 `last_location` 时，下一窗口恢复
的是此后最近成功显示的稳定位置，而不是被跳过的旧目标。

## 4. Restorable Location 提交与验证

Restorable Location 只有四种稳定形态：

```ts
type RestorableLocation =
  | { kind: "quick_chat" }
  | { kind: "camp"; campId: string }
  | { kind: "members"; agentId: string | null; tab: "identity" | "runtime" }
  | { kind: "memory" }
```

明确没有 `settings`、`new_conversation`、`notifications`、`command_palette`、`approval`、
`dialog`、`toast` 或错误页形态。Camp Inspector、Memory 内部过滤、滚动位置、Draft Dialog、
通知焦点和临时 Drawer 也不进入该记录。

### 提交边界

Renderer 只在目标页面满足“权威读取成功并已经成为可见一级页面”后调用 Shell 提交：

- Quick Chat：Navigation 初始读取已经进入可显示状态；
- Camp：`camps.snapshot` 返回当前 Camp 且该 Camp 已激活；
- 队员页：`members.list/get` 已确认可管理集合，最终选中队员与 `identity/runtime` 页签已显示；
- 记忆页：页面初始权威读取完成并显示主页面或合法空状态。

提交发生在稳定导航完成后，不等 `before-quit`。重复提交完全相同目标可以 no-op；文件写失败不
撤销已经完成的页面导航，但要给出非阻塞错误并在下一次稳定导航或显式重试时再次提交。

### 权威验证结果

| 恢复输入 | 权威结果 | 行为 | 是否清除旧目标 |
| --- | --- | --- | --- |
| Camp ID | Camp 存在 | 显示 Camp，随后提交该 Camp | 否 |
| Camp ID | 明确 `not_found/deleted` | 显示 Quick Chat，成功后提交 Quick Chat | 是，以新提交替代 |
| Member ID | 当前且未 removed | 显示该队员与所存页签 | 否 |
| Member ID | 明确 removed/not found | 进入队员页；按 Member Order 先 present 后 away 选择首个可管理队员，保留所存页签；没有则空状态 | 是，提交最终队员目标 |
| 任意 Core-backed 目标 | Core starting/restarting/unreachable/timeout | 保持启动门并继续恢复同一冻结目标；可显示“重试”和诊断入口 | 否 |
| 恢复文件损坏或目标字段不合法 | 本地校验失败 | 回退 Quick Chat，成功后提交完整安全记录 | 是，以新提交替代 |

实现必须使用结构化错误或明确 Read Side 结果区分“确定不存在”和“暂时不可读取”，不得通过错误
字符串、一次 Health failure 或空的旧 Navigation Snapshot 推断删除。Core 暂时失败后成功时继续
验证最初冻结目标，不重新读取偏好并选择另一条启动路线。

## 5. Desktop Shell 持久化与 bridge

v0.49 延续 `appearance.json`、`navigation.json`、`window-state.json` 的 Main-owned 本地偏好模式，
新增两个相互隔离的 Shell 文件：

| 文件 | 内容 | 缺失/损坏默认值 |
| --- | --- | --- |
| `<userData>/general-preferences.json` | `schemaVersion: 1`、`startupLocationMode`、`lastSettingsSection` | `last_location`、`general` |
| `<userData>/restorable-location.json` | `schemaVersion: 1`、一个 `RestorableLocation` | 没有有效目标；本次进入 Quick Chat |
| `<userData>/window-state.json` | 现有 `schemaVersion: 1`、normal bounds | 默认尺寸并在选定显示器居中 |

三个文件分别损坏时不得互相清空。所有写入使用同目录临时文件、`0600`、`wx`、完整 JSON 和原子
rename；失败清理临时文件。Reader 只接受精确 schema、有限 enum、有限长度非空 ID 和 finite
bounds，不透传未知字段。任何 Shell 文件都不包含 Camp title、Member display name、Navigation
Snapshot、用户正文、Runtime 状态或系统登录项 Boolean。

Login Item Registration 不进入上述文件。它每次通过 Electron
`getLoginItemSettings({ type: "mainAppService" })` 读取，并通过
`setLoginItemSettings({ type: "mainAppService", openAtLogin })` 修改后读回。

Preload bridge 在现有 context isolation/sandbox 下增加窄接口：

```ts
interface DesktopSessionApi {
  getStartupSnapshot(): Promise<DesktopStartupSnapshot>
  commitRestorableLocation(location: RestorableLocation): Promise<void>
}

interface GeneralPreferencesApi {
  get(): Promise<GeneralPreferencesSnapshot>
  setStartupLocationMode(mode: StartupLocationMode): Promise<GeneralPreferencesSnapshot>
  setLastSettingsSection(section: SettingsSection): Promise<GeneralPreferencesSnapshot>
}

interface LoginItemApi {
  get(): Promise<LoginItemSnapshot>
  setEnabled(enabled: boolean): Promise<LoginItemSnapshot>
  openSystemSettings(): Promise<void>
}

interface WindowControlsApi {
  getResetCapability(): Promise<{ canReset: boolean; reason: "fullscreen" | null }>
  resetBounds(): Promise<{ performed: boolean; reason: "fullscreen" | null }>
}
```

Main 对所有 Renderer 输入做穷尽 enum/shape/length 校验。Renderer 不获得文件路径、任意 JSON 写入、
任意 Shell URL 或通用 BrowserWindow 控制能力。上述接口不是 CoreMethod，不进入 Core allowlist。

## 6. 窗口区与几何规则

页面固定显示：

```text
窗口

Rovai-ai 会自动保存窗口大小和位置，并确保下次打开时窗口仍位于可见的显示器区域。

[重置窗口大小与位置]
```

窗口状态始终保存，不增加“记住窗口位置”Switch。Main 使用 normal bounds，move/resize 采用现有
debounce，关闭窗口前再进行一次 best-effort flush；全屏 bounds 不覆盖最后 normal bounds。

### 创建窗口

1. 读取并校验保存的 width/height/x/y；
2. 在所有 display work area 中选择与保存 bounds 相交面积最大的显示器；
3. 如果没有有效交集（例如外接显示器已移除），选择 primary display；
4. 将尺寸限制在 `1040×700` 最小值与目标 work area 可容纳范围内；
5. 将 x/y clamp 到目标 work area，保证窗口完整可见；
6. 没有有效保存状态时使用 `1440×920`（受 work area 限制）并居中。

### 重置

Reset 以当前窗口 bounds 匹配的显示器作为“当前显示器”，使用 `1440×920` 默认尺寸（受其 work
area 限制）计算精确居中 bounds，并立即写回 `window-state.json`。它只调用 BrowserWindow 几何
能力，不刷新 Renderer，因此不得改变当前 View、Camp、Member、Tab、Memory、Settings、Draft、
Approval、Run、滚动或焦点链。

若 `mainWindow.isFullScreen()` 为 true：

- Renderer 禁用按钮并显示“请先退出全屏，再重置窗口大小与位置”；
- Main 即使收到伪造/竞态 IPC 也返回 `performed: false, reason: "fullscreen"`；
- 不登记 pending reset，不在退出全屏后自动执行。

窗口进入或退出全屏、目标 display 变化以及 General 页面重新获得焦点时刷新 reset capability。

## 7. 状态、焦点与错误恢复

- General 页面即使某一 Shell 读取失败，页头、另一个 section 和设置导航仍可用；
- 登录项、启动偏好与窗口重置各有独立 loading/submitting/error 状态，不能使用一个全页 busy；
- Radio、Switch 与 Reset 都有可访问名称、文字状态和 `focus-visible`，不只靠颜色；
- 打开系统设置后，焦点回到 Rovai-ai 时恢复到原按钮附近并刷新系统状态；
- `requires-approval`、`not-found` 和写失败使用持久 inline status，而非只显示 Toast；
- 成功保存启动偏好或完成窗口重置可以使用 `aria-live="polite"` 的短反馈；
- Startup Gate 的重试不改变冻结目标，打开诊断也不提交 Settings 为 Restorable Location。

## 8. 负向边界

General 的全部写操作只进入 Electron Main 或 macOS 系统：

- 不调用 Core command；
- 不写 SQLite；
- 不产生 Camp event、CampMessage、Task、AgentRun、Native Session、Approval 或 audit；
- 不改变 Runtime model、permission、Memory policy、Notification rule 或 execution recovery；
- Core 权威读取只用于恢复目标验证，不能被包装成偏好事件或审计动作。

登录启动创建普通可见主窗口，不使用隐藏窗口、Tray-only、后台 silent mode 或自动运行任务。

## 9. 非目标

- 语言、自动更新、系统通知规则；
- 关闭窗口行为和后台驻留策略；
- 默认 Project、模型、Runtime、权限或 Memory；
- 自动批准或是否恢复未完成执行；
- 多窗口并发、窗口布局集合、记住全屏/最大化状态；
- Windows/Linux 登录项实现。
