---
document_type: ui-interaction-draft
authority: host-remote-connection-settings-review
status: implemented
target_version: v1.59
last_updated: 2026-09-18
---

# 设置 · 远程连接交互稿

用户要求在拉取 main 后，以当前设置风格为基准新增“远程连接”菜单设计稿。本稿针对现有 Desktop
浏览器访问入口与 Web 当前连接状态；不是更换 Host 的客户端、服务发现平台或新的 WebUI。生产组件、路由、Host 能力和独立 `rovai-server` 入口保留，当前发布仅隐藏 Desktop/Web 设置菜单中的“远程连接”；下方离线稿使用同一生产组件。模拟数据与当前 Host 能力分开说明；阶段 1–3 的范围仍见[宽屏对照](host-web-parity.md)。

## 可直接查看的稿件

运行 `pnpm review:remote-connection`，打开输出的
`out/review-delivery/remote-connection/remote-connection-review.html`。它是可离线打开的单文件交互稿，
外层工具栏提供 Desktop/Web、日夜主题、状态与三种宽屏尺寸。工具栏属于评审器，不进入产品。
菜单中的“通用”“外观”直接挂载当前生产页面，便于同视口对照。

[Renderer 入口](../../scripts/fixtures/remote-connection/renderer.tsx)和
[构建脚本](../../scripts/review-remote-connection.mjs)沿用现有 Vite/React fixture 方式。
开启、关闭、登录只修改该稿的内存。地址、路径、会话数、令牌均为固定示例；
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
| 图标与弹窗 | `NavigationIcon`、`AppDialogContent/Header/Body/Footer` | 侧栏沿用原图标，页面不放设备图标；复用现有 Dialog，二维码关闭后焦点回到触发按钮 |
| 双主题 | `packages/ui/src/theme.css`、生产 `styles.css` | 同一组件树，全部颜色取语义 token；无按主题分叉的布局 |

[新增 CSS](../../apps/desktop/src/renderer/src/remote-connection.css)只拥有连接状态、地址、目录与令牌行的局部组合，
不复制侧栏、按钮、开关、Dialog 或主题实现。页面与样式由生产组件拥有，fixture 只注入模拟依赖。

## 页面与交互

当前发布从 Desktop 和 Web 的“能力”组隐藏“远程连接”菜单，Mobile 同样不显示；页面组件与内部路由保留。
独立 Server 的入口与运行方式不变。通用页不再重复管理入口。
端口始终显示且可编辑；修改只是下一次开启服务的输入，不重启当前监听、不刷新当前地址或令牌。
未应用的端口保存在当前业务窗口的页面状态中，切换设置菜单后仍保留。初次读取以实际监听端口为准，未启动时默认 `8766`；独立 Server 默认 `8767`，显式端口设置优先。
“远程访问”开关直接开启本机与远程访问，不再选择访问范围；页面保留简短的 HTTP 明文说明。
关闭直接生效，不再二次确认；开启与关闭都不添加成功提示。
开启后分别展示“本机地址／在这台电脑上访问”和“远程地址／在其他设备上访问”。地址使用 `--resource-link` 蓝色超链接，可在新浏览器页打开；普通地址不携带凭据。仅多个远程地址时提供接口下拉选择，当前选中地址仍单独显示为链接。
每行右侧均有复制与二维码图标，复制与会话区共用 `CopyIcon` 和按钮样式，图标具备 tooltip 与可访问名称。
令牌栏文案为“登录 Token”，始终显示，默认遮掩；只保留显示／隐藏和复制两个图标按钮，沿用会话区的尺寸与线条。
不显示刷新／重新生成的环形箭头入口。关闭服务不隐藏或清空令牌，关闭时也能查看、复制，切换菜单后仍可重新读取。
地址与令牌复制成功仅让原图标短暂变勾，随后恢复；不在页面下方追加“已复制”或重新生成成功提示。
图标有明确的可访问名称与悬停说明，复制结果保留不可见的读屏通知；复制失败才显示可操作的失败说明，且不暴露遮掩的令牌。
切换地址只更新页面选择；不调用 start/stop/rotate，不授予权限或改变 Host 状态。
地址发现直接排除 198.18.0.0/15，不作为可复制、可扫码或推荐地址；没有特殊入口，网络层不主动封禁。
普通地址复制不带凭据；显式“扫码登录”二维码由 Host 签发 2 分钟有效的一次性票据，通过 URL fragment 传递，不携带长期登录 Token。没有可展示地址时禁用复制与二维码，服务仍可运行。
实际网络可达性取决于设备网络和防火墙。

登录成功的 Owner 可直接使用 Host 有权访问的目录；设置中没有目录预授权名单。浏览器“选择工作目录”
使用 `HostWorkspacePicker` 读取 Host 文件系统，支持主目录、根/盘符、上一级、子目录和绝对路径输入。
提交当前目录前必须先成功读取；项目校验与 Camp 创建继续走同一 Core。失败保留输入并明确反馈。

令牌由 Rust Host 在首次本机读取或开启时生成，同一 Host 进程内关闭、再次开启沿用同一令牌。
关闭仍撤销全部浏览器会话；重新开启后需重新登录。令牌不承诺跨 Host 进程重启持久化。
底层独立令牌轮换接口保留，设置页不提供该按钮。提交中阻止重复操作；未知响应只重读状态与当前令牌，不自动重试变更。

Web 的同一菜单显示当前 Host 地址及连接状态，可退出本页登录。认证过期使用实际入口的登录覆盖层；
同页重新登录保留编辑身份、Composer 与原命令核对。Web 不需要本机管理密钥读取能力来访问业务页面。
不构建多租户、强隔离执行或用户可配置的安全平台；范围见 [Host Web v2](../contracts/host-web-v2.md)。

## 生产组件与验收

- `HostWebSettings`：Desktop 的实际服务状态、地址选择、令牌读取及生命周期协调。
- `RemoteConnectionStatus`：实际浏览器与离线稿共用的连接状态页面。
- `SettingsSidebarNavigation`、`SettingsPageHeader`、General/Appearance：原生产导航和对照基准。
- `HostWorkspacePicker`：浏览器文件系统适配，不复制 Core 的工作区业务规则。

`pnpm test:remote-connection-review` 在隔离 Chrome profile 验证双主题、几何、键盘错误定位、
图标复制反馈与恢复、令牌显隐、一键开启、直接关闭、端口延迟应用与切页保留、关闭后令牌仍可用、页面返回后读取令牌、地址切换不改令牌、两类地址的二维码解码结果与地址一致、
空地址禁用复制和二维码、窄宽屏及减少动效。
该稿使用模拟 API，不能替代实际网络验收。真实 `pnpm test:host-web` 证明无预授权目录的 HTTP 项目操作、
令牌重复读取不撤销登录，以及已有草稿/上传/回执/撤销/关闭边界。真实 Desktop/Web 页面验收由
`pnpm test:host-web-live` 拥有；结果与剩余缺口见[当前实施计划](../versions/v1.59/implementation-plan.md)。

本轮外观见[日间](../versions/v1.59/evidence/retained-token/remote-day.png)与
[夜间](../versions/v1.59/evidence/retained-token/remote-night.png)与
[复制反馈](../versions/v1.59/evidence/retained-token/remote-copied.png)；
[交互/产物哈希记录](../versions/v1.59/evidence/retained-token/remote-connection-review.json)明确标记模拟 API。
