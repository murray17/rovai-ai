---
document_type: ui-interaction-draft
authority: host-remote-connection-settings-review
status: implemented
target_version: v1.59
last_updated: 2026-09-12
---

# 设置 · 远程连接交互稿

用户要求在拉取 main 后，以当前设置风格为基准新增“远程连接”菜单设计稿。本稿针对现有 Desktop
浏览器访问入口与 Web 当前连接状态；不是更换 Host 的客户端、服务发现平台或新的 WebUI。菜单已接入正式 Desktop/Web；下方离线稿使用同一生产组件。模拟数据与当前 Host 能力分开说明；阶段 1–3 的范围仍见[宽屏对照](host-web-parity.md)。

## 可直接查看的稿件

运行 `pnpm review:remote-connection`，打开输出的
`out/review-delivery/remote-connection/remote-connection-review.html`。它是可离线打开的单文件交互稿，
外层工具栏提供 Desktop/Web、日夜主题、状态与三种宽屏尺寸。工具栏属于评审器，不进入产品。
菜单中的“通用”“外观”直接挂载当前生产页面，便于同视口对照。

[Renderer 入口](../../scripts/fixtures/remote-connection/renderer.tsx)和
[构建脚本](../../scripts/review-remote-connection.mjs)沿用现有 Vite/React fixture 方式。
开启、轮换、关闭、登录只修改该稿的内存。地址、路径、会话数、令牌均为固定示例；
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

[新增 CSS](../../apps/desktop/src/renderer/src/remote-connection.css)只拥有连接状态、地址、目录与令牌行的局部组合，
不复制侧栏、按钮、开关、Dialog 或主题实现。页面与样式由生产组件拥有，fixture 只注入模拟依赖。

## 页面与交互

Desktop 的“应用”组在“提醒”之后提供“远程连接”。通用页不再重复管理入口。
关闭时显示访问范围与端口；默认仅此电脑，明确选择局域网后显示 HTTP 明文说明，不要求手填唯一地址。
开启后显示 Host 返回的实际接口地址列表、独立复制地址、会话数以及遮掩的令牌输入框。
切换地址只更新页面选择；不调用 start/stop/rotate，不授予权限或改变 Host 状态。
198.18/15 接口可展示和选择，但不标记为默认 LAN 推荐。实际网络可达性取决于设备网络和防火墙。

登录成功的 Owner 可直接使用 Host 有权访问的目录；设置中没有目录预授权名单。浏览器“选择工作目录”
使用 `HostWorkspacePicker` 读取 Host 文件系统，支持主目录、根/盘符、上一级、子目录和绝对路径输入。
提交当前目录前必须先成功读取；项目校验与 Camp 创建继续走同一 Core。失败保留输入并明确反馈。

令牌可反复查看/复制，离开页面再返回会从本机 Host 管理入口重新读取；不会要求重新生成。
重新生成是独立操作，和停止服务一样使用现有确认 Dialog，说明旧会话退出、执行继续。
取消/Escape 不变更状态；提交中阻止重复操作。未知响应只重读状态与当前令牌，不自动重试变更。

Web 的同一菜单显示当前 Host 地址及连接状态，可退出本页登录。认证过期使用实际入口的登录覆盖层；
同页重新登录保留编辑身份、Composer 与原命令核对。Web 不需要本机管理密钥读取能力来访问业务页面。
不构建多租户、强隔离执行或用户可配置的安全平台；范围见 [Host Web v2](../contracts/host-web-v2.md)。

## 生产组件与验收

- `HostWebSettings`：Desktop 的实际服务状态、地址选择、令牌读取及生命周期协调。
- `RemoteConnectionStatus`：实际浏览器与离线稿共用的连接状态页面。
- `SettingsSidebarNavigation`、`SettingsPageHeader`、General/Appearance：原生产导航和对照基准。
- `HostWorkspacePicker`：浏览器文件系统适配，不复制 Core 的工作区业务规则。

`pnpm test:remote-connection-review` 在隔离 Chrome profile 验证双主题、几何、键盘错误定位、
开启/关闭/重新生成确认、页面返回后读取令牌、198.18/15 地址选择不改令牌和会话、窄宽屏及减少动效。
该稿使用模拟 API，不能替代实际网络验收。真实 `pnpm test:host-web` 证明无预授权目录的 HTTP 项目操作、
令牌重复读取不撤销登录，以及已有草稿/上传/回执/撤销/关闭边界。真实 Desktop/Web 页面验收由
`pnpm test:host-web-live` 拥有；结果与剩余缺口见[当前实施计划](../versions/v1.59/implementation-plan.md)。

本轮已验证的外观见[日间](../versions/v1.59/evidence/owner-host/remote-day.png)与
[夜间](../versions/v1.59/evidence/owner-host/remote-night.png)；
[交互/产物哈希记录](../versions/v1.59/evidence/owner-host/remote-connection-review.json)明确标记模拟 API。
