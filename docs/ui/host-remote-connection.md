---
document_type: ui-interaction-draft
authority: host-remote-connection-settings-review
status: draft
target_version: v1.59
last_updated: 2026-09-12
---

# 设置 · 远程连接交互稿

用户要求在拉取 main 后，以当前设置风格为基准新增“远程连接”菜单设计稿。本稿针对现有 Desktop
浏览器访问入口与 Web 当前连接状态；不是更换 Host 的客户端、服务发现平台或新的 WebUI。菜单尚未接入
正式产品。模拟数据与当前 Host 能力分开说明；阶段 1–3 的范围仍见[宽屏对照](host-web-parity.md)。

## 可直接查看的稿件

运行 `pnpm review:remote-connection`，打开输出的
`out/review-delivery/remote-connection/remote-connection-review.html`。它是可离线打开的单文件交互稿，
外层工具栏提供 Desktop/Web、日夜主题、状态与三种宽屏尺寸。工具栏属于评审器，不进入产品。
菜单中的“通用”“外观”直接挂载当前生产页面，便于同视口对照。

[Renderer 入口](../../scripts/fixtures/remote-connection/renderer.tsx)和
[构建脚本](../../scripts/review-remote-connection.mjs)沿用现有 Vite/React fixture 方式。
开启、轮换、关闭、工作区选择与登录只修改该稿的内存。地址、路径、会话数、令牌均为固定示例；
不连接 Host、不打开监听端口、不读写工作区、不启动 Runtime。复制动作只复制稿中示例。

## 风格如何还原

以 main `f30024ae` 合入后的生产源码为基线，使用 UI-UX-Pro-Max 的表单与状态指导补齐交互：
`settings form inline validation --domain ux` 的 Inline Validation、Focusable Error Summary、Submit Feedback，
以及 `form async state effects --stack react` 的事件内处理与派生状态建议。这里只采用适用的部分，
不引入生成的配色、字体、动效库或新的全局设计系统。单字段错误就近显示；开启失败后焦点回到对应字段。
稿件沿用 macOS 对照基准；生产浏览器快捷键仍取客户端设备平台，Host 的操作系统和 Runtime 能力另行读取。

| 部位 | 直接复用的源码 | 本稿处理 |
| --- | --- | --- |
| 应用壳层 | `styles.css` 的 `.app-shell`、`WindowDragStrip` | 270px 侧栏，50px 顶部占位；没有第三套壳层 |
| 分组与选中行 | `CampNavigation`、`SettingsSidebarNavigation`、`SETTINGS_SIDEBAR_GROUPS` | “应用”组内，位于“提醒”之后；能力/支持顺序不变；选中行沿用中性底色 |
| 页头 | `SettingsPageHeader`、`settings-workspace.css` | 24px/620 标题、12px 说明、无装饰边线；和通用页同一内容轴 |
| 内容区 | `.settings-panel-general`、`.general-settings`、`.general-settings-section` | 880px 开放阅读面、24px 分区间距与细分隔线；保留稳定滚动条占位，避免短页标题移动 |
| 控件 | 通用设置的开关、quiet/primary button、输入边界 | 中性按钮、白色关闭态滑块、6px 控件圆角；只有状态使用语义状态色 |
| 图标与弹窗 | `NavigationIcon`、`AppDialogContent/Header/Body/Footer` | 在同一 1.7px 线条体系中增加设备图标；取消优先获焦点，Escape 可取消 |
| 双主题 | `packages/ui/src/theme.css`、生产 `styles.css` | 同一组件树，全部颜色取语义 token；无按主题分叉的布局 |

[新增 CSS](../../scripts/fixtures/remote-connection/review.css)只拥有连接状态、地址、目录与令牌行的局部组合，
不复制侧栏、按钮、开关、Dialog 或主题实现。页面与样式处于 fixture 中，不进入正式 Web 构建。

## 页面与交互

Desktop 以“浏览器访问”开关和明确的状态文字开头，后续按连接方式/地址、可访问工作区、登录与会话展开。
关闭状态显示访问范围、端口；选择局域网才出现控制台地址与明文访问确认。默认仅此电脑。
开启前验证输入，失败保留编辑；提交中阻止重复操作，成功后显示实际返回的连接地址。

已开启状态显示可复制的地址、已授权目录以及会话总数。不会从会话总数编造设备名称、IP 或活动时间。
工作区由本机选择器授权，运行中不编辑；首次开启或轮换令牌后才出现遮掩的令牌输入与显式复制/显示操作。
离开该页清除一次性令牌展示；再次需要时通过轮换获取新令牌。

关闭浏览器访问和更换令牌均使用现有确认 Dialog，说明会话影响以及执行继续的语义。
点击取消、按 Escape 或关闭 Dialog 都保留连接；提交后依据 Host 返回状态更新，不能以开关动画代替结果。
原错误仍需按现有 `HostWebSettings` 逻辑重读状态后判断，不自动重试未知结果的开启请求。

Web 页面显示固定 Host 地址与当前连接状态，提供本页退出/重新登录，不提供 Host 开关、授权目录编辑或令牌轮换。
连接中断与认证失效分别呈现：前者等待重连、编辑保留；后者通过登录表单更新认证，保留当前编辑归属并核对原命令。
这个“当前连接”设置页是稿件，实际入口目前仍使用既有登录覆盖层与侧栏连接提示。

## 接入时复用什么，还缺什么

| 交互 | 现有能力 | 接入边界 |
| --- | --- | --- |
| 开启、读取状态、关闭、轮换 | `HostWebApi.status/start/stop/rotate`、`HostWebSettings` | 移动原生命周期协调逻辑，不能新建 Host 或公开本机管理 RPC |
| 局域网配置 | `HostWebStartInput.listen/publicOrigin/allowInsecureLan` | “范围＋端口”仅组装既有参数，后端继续做最终校验；HTTPS 的外部配置由受信 Host 负责 |
| 工作区选择 | `selectWorkspaceDirectory`、`authorizedWorkspaces` | 沿用本机目录授权，不允许 Web 任意提交路径 |
| 已开启后回看配置 | `HostWebStatus` 当前只有 enabled/origin/sessions/sessionLifetimeSeconds | **缺口**：正式展示授权目录与监听配置需要受信本机 status 的安全读回，或同次启动的已确认内存快照。未读到时显示未取得信息，不能拿表单草稿冒充生效配置 |
| 令牌展示 | start/rotate 才返回 administratorToken | 不扩展成“读取旧令牌”；不持久保存，不写 URL、日志或剪贴板以外的自动输出 |
| Web 连接与登录 | `ConsoleClient` 的认证、SSE、logout、重新登录和命令核对 | 将现有状态适配给共享设置页；认证代次与编辑作用域继续独立，不因打开菜单而重建 client |
| 设置菜单落地 | 当前正式设置 section 尚无 remote | 评审确认后接入路由与记忆的 section，同时从通用页移除原块；本稿没有提前改变持久导航合同 |

## 验证

`pnpm test:remote-connection-review` 先检查 fixture 类型，再使用独立 Chrome profile，检查生产通用页与新稿的侧栏宽度、顶行、
标题字号/字重/位置、背景色，以及双主题状态矩阵。实际交互检查字段校验与焦点、局域网显式确认、
提交中禁用、令牌遮掩/离页清除、轮换与关闭的取消/确认、Web 重新登录，以及不同窗口尺寸和 reduced motion。
720×460 仅表示 1440×920 在 200% 时的等效 CSS 布局检查，不冒充浏览器原生缩放实测。
缺少 Chrome 时明确跳过；没有通过就不写为已验收。结果写入环境变量 `ROVAI_REMOTE_REVIEW_OUTPUT` 指定的目录。

2026-09-12 最终单文件交互稿已通过 14 个日夜主题状态以及上述交互检查，0 跳过。
[检查记录与稿件 SHA-256](../versions/v1.59/evidence/remote-connection/remote-connection-review.json)固定交付内容。
对照图：[生产通用页（日间）](../versions/v1.59/evidence/remote-connection/baseline-general-day.png)、
[远程连接（日间）](../versions/v1.59/evidence/remote-connection/desktop-enabled-day.png)、
[生产通用页（夜间）](../versions/v1.59/evidence/remote-connection/baseline-general-night.png)、
[远程连接（夜间）](../versions/v1.59/evidence/remote-connection/desktop-enabled-night.png)。
另有[开启前](../versions/v1.59/evidence/remote-connection/desktop-off-day.png)、
[首次开启成功](../versions/v1.59/evidence/remote-connection/desktop-first-enable-day.png)、
[关闭确认](../versions/v1.59/evidence/remote-connection/desktop-stop-confirm-day.png)与
[Web 当前连接](../versions/v1.59/evidence/remote-connection/web-enabled-night.png)。这些图片均为模拟稿。
