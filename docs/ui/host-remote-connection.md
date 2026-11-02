---
document_type: ui-platform-guidance
authority: renderer-host-remote-connection
last_updated: 2026-10-30
---

# 设置 · 远程连接

远程连接设置管理 Desktop 的浏览器访问入口，并显示 Web 当前连接状态；不提供切换 Host 或服务发现。
Desktop/Web 共用生产组件。Host 能力与授权边界见 [Host Web v4](../contracts/host-web-v4.md)，
平台呈现差异见 [Desktop/Web 共用界面](host-web-parity.md)。

## 共享组件与页面布局

页面遵循 [DESIGN.md](../../DESIGN.md) 与[设置工作区 brief](surfaces/settings-workspace.md)。
单字段错误就近显示；开启失败后焦点回到对应字段。浏览器快捷键取客户端设备平台，Host 的操作系统和 Runtime 能力另行读取。

| 部位 | 直接复用的源码 | 页面规则 |
| --- | --- | --- |
| 应用壳层 | `styles.css` 的 `.app-shell`、`WindowDragStrip` | 270px 侧栏，50px 顶部占位；没有第三套壳层 |
| 分组与选中行 | `ThreadNavigation`、`SettingsSidebarNavigation`、`SETTINGS_SIDEBAR_GROUPS` | 遵循 [App Shell 导航](components/app-shell-navigation.md) 的“能力”分组与中性选中态 |
| 页头 | `SettingsPageHeader`、`settings-workspace.css` | 24px/620 标题、12px 说明、无装饰边线；和通用页同一内容轴 |
| 内容区 | `.settings-panel-general`、`.general-settings`、`.general-settings-section` | 880px 开放阅读面、24px 分区间距与细分隔线；保留稳定滚动条占位，避免短页标题移动 |
| 控件 | 通用设置的开关、quiet/primary button、输入边界 | 共享主题操作色、白色关闭态滑块、6px 控件圆角；状态保留独立语义色 |
| 图标与弹窗 | `NavigationIcon`、`AppDialogContent/Header/Body/Footer` | 侧栏沿用原图标，页面不放设备图标；复用现有 Dialog，二维码关闭后焦点回到触发按钮 |
| 全部配色 | `packages/ui/src/theme.css`、生产 `styles.css` | 同一组件树，全部颜色取语义 token；无按主题分叉的布局 |

[新增 CSS](../../apps/desktop/src/renderer/src/remote-connection.css)只拥有连接状态、地址、目录与令牌行的局部组合，
不复制侧栏、按钮、开关、Dialog 或主题实现。页面与样式由生产组件拥有，fixture 只注入模拟依赖。

## 页面与交互

Desktop 和 Web 的“能力”组在“智能体”之后、“渠道”之前提供“远程连接”；Mobile 保持相同顺序。
独立 Server 隐藏渠道时仍保留远程连接。通用页不再重复管理入口。
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
提交当前目录前必须先成功读取；项目校验与 Thread 创建继续走同一 Core。失败保留输入并明确反馈。

令牌由 Rust Host 在首次本机读取或开启时生成，同一 Host 进程内关闭、再次开启沿用同一令牌。
关闭仍撤销全部浏览器会话；重新开启后需重新登录。正常 Host 退出与重启保留令牌及未过期会话。
底层独立令牌轮换接口保留，设置页不提供该按钮。提交中阻止重复操作；未知响应只重读状态与当前令牌，不自动重试变更。

Windows 正常继承权限不阻止读取或保存凭据，不增加修复窗口、权限警告或管理员启动要求。
真正读取、保存、内容或路径错误在现有错误位置说明原因；Desktop 不显示 Electron 远程调用前缀，
Web 登录/注销消费 Host 的脱敏保存错误，不把磁盘错误说成 Token 无效或网络故障。
具体行为见 [Host Web v4](../contracts/host-web-v4.md#windows-web-凭据可用性)。

Web 的同一菜单显示当前 Host 地址及连接状态，可退出本页登录。认证过期使用实际入口的登录覆盖层；
同页重新登录保留编辑身份、Composer 与原命令核对。Web 不需要本机管理密钥读取能力来访问业务页面。
不构建多租户、强隔离执行或用户可配置的安全平台；范围见 [Host Web v3](../contracts/host-web-v3.md)。

## 验证

按 [UI 验收流程](../development/ui-acceptance.md#独立-ui-验收)分别验证组件交互、Host 授权与真实 Desktop/Web 连接。
