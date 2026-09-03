---
document_type: ui-platform-contract
authority: renderer-windows-interaction-delta
status: accepted
source_version: v1.05
last_updated: 2026-08-22
---

# Windows Interaction Delta

本文只拥有 Rovai AI 在 Windows x64 上相对现有 macOS 产品界面的交互差异。Windows 不是第二套产品：
Renderer 继续使用同一组件树、信息架构、Porcelain Day / Steel Night Token、领域动作和持久状态。平台差异由
只读 `HostPlatformKey` 投影到展示层，不复制业务状态机，也不允许 Renderer 自行推断安全或 Runtime 准入。

生产实现状态由代码、自动化和真实 Windows 证据决定；本文 `accepted` 不表示 Windows UI 已完成。原
[v1.05 HTML 交互稿](../prototypes/windows-interaction-delta/index.html)只保留历史评审上下文，不代表当前
Windows chrome，也不能成为第三份组件、文案或状态真源。

## 1. 保持不变的产品结构

- App Shell 仍使用 270px rail、50px App 顶行及同一 Project / Camp / Quick Chat 导航；
- 设置分类、队员工作区、Camp 工作区、Memory、Diagnostics、Onboarding 和 Planned Shutdown 不增删一级入口；
- Day / Night 是同一生产组件的两套 Token；`system` 只改变解析结果，不改变内容或能力；
- Core command、Draft、selection、focus return、version check、Recovery 和未保存 Runtime 草稿保护保持同义；
- Runtime 平台准入、机器可用性与 Settings Preview 是三个正交事实，任何一个都不得借另一个的视觉状态表达。

配套 HTML 评审稿必须从这些生产页面出发做差异叠加：Quick Chat 使用全幅空状态；Settings 侧栏替换主侧栏；Members
保留 270px 主侧栏、236px 队员列表与既有详情轨道；Runtime 使用真实 Catalog 行与产品 Logo。不得用额外评审侧栏、
舞台留白、圆角/阴影窗口卡片或缩小版导航重画一套“近似 Rovai AI”。原型专用控制只能作为不占布局的、默认收起的
评审层，并必须支持切回无 Windows 投影的 macOS 对照态。

## 2. 平台投影

| 交互面 | macOS | Windows x64 | 不变量 |
| --- | --- | --- | --- |
| Window frame | hidden title bar、系统 traffic lights | hidden title strip、rail-colored 顶层菜单投影与 Window Controls Overlay caption buttons | Renderer 不伪造关闭/最大化/最小化 |
| Drag region | 已有受控 `-webkit-app-region` | 复用同一组受控 drag region | 顶行仍是 App context，不冒充标题栏 |
| Window behavior | 系统全屏/窗口管理 | Snap Layout、Alt+Space、双击标题栏、系统阴影 | 行为归宿主 OS；自动化不能替代真机 |
| 字体 | 系统 SF 优先 | `Segoe UI` 系统字体优先 | 不引入 Windows 专属品牌字体 |
| 快捷键 | `⌘` 展示 | `Ctrl` 展示；实现使用 `CommandOrControl` | 动作、禁用原因与焦点返回相同 |
| 文件管理器 | “在 Finder 中显示” | “在文件资源管理器中显示” | 只打开已验证对象，不把路径字符串当身份 |
| 设备文案 | “此 Mac” | “此电脑”或上下文无关的“此设备” | 不把设备文案写入领域事件或持久标识 |
| 路径 | POSIX path | drive-letter path；超长时可换行 | 普通页面不暴露私有 data root；Diagnostics 仍脱敏 |
| System theme | 跟随 macOS 外观 | 跟随 Windows Apps theme | saved preference 与 resolved theme 分开呈现 |
| Accessibility | VoiceOver/系统对比度 | NVDA、High Contrast/Forced Colors、中文 IME | DOM 语义、Focus 顺序和 live region 保持 |

Renderer 只能消费 Desktop bridge 已投影的平台枚举。不得通过 User Agent、路径分隔符、字体加载结果或
窗口尺寸猜测平台；不得让同一动作在两个组件分支中分别维护。

## 3. Window、App Shell 与全局动作

Windows `BrowserWindow` 保留系统 frame，但以 `titleBarStyle: hidden` 隐去包含 App 图标与 `Rovai AI` 的标题文字层，
同时启用 Window Controls Overlay。Electron application menu model、command、accelerator 与原生 submenu 保持权威；
系统 menu bar 呈现被隐藏，Renderer 只投影 `File / Edit / View / Window` 四个顶层入口并按受限 IPC 打开
对应原生 submenu，不复制或重建 submenu command。

顶层菜单行与 Window Controls Overlay 的 Day / Night 背景都使用 `--rail` 对应颜色，图标使用对应 `--ink`，
主题切换时同步更新。高度读取 WCO CSS environment value，不写死覆盖值，继续采用系统默认值适配多屏 DPI。
隐藏标题文字层后，Windows 复用既有 `.topbar`、
`.window-drag-strip` 与 `.unified-sidebar-drag` 受控拖拽区；既有按钮继续保持 `no-drag`。

Windows 的统一侧栏只把 traffic-light 预留从 38px 收至 8px；品牌、一级导航、Project / Camp、设置和所有右侧
页面结构、内容与尺寸不变。关闭按钮继续进入 Planned Shutdown；Renderer 不劫持 Alt+F4、caption close 或系统关机
来显示另一套关闭流程。

全局快捷键由一个平台文案映射提供。例如 Command Palette 在 macOS 显示 `⌘K`、Windows 显示 `Ctrl+K`；页面
缩放继续执行 `CommandOrControl + / - / 0`。可访问名称描述动作，不把符号作为唯一名称。

## 4. Runtime 平台准入与机器可用性

[Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)在 discovery 之前生效。设置、队员编辑和
Onboarding 先呈现准入，再呈现机器状态：

| Platform admission | 机器 availability | 普通 UI | 可执行动作 |
| --- | --- | --- | --- |
| `qualified` | 正常状态机 | 继续现有 checking / 可用 / 需登录 / 未安装等文案 | 按现有合同检查、选择、保存、执行 |
| `not_qualified` | 不存在 | `Windows 尚未验证`，并说明不是本机安装故障 | 无检查、安装、选择或执行 |
| `preview` | 真实本机状态 | `实验性开放`，并继续显示检查/安装/登录结果 | 允许检查、安装、选择与执行；不宣称 qualified |
| `unsupported` | 不存在 | `此平台不支持`，并显示稳定产品级说明 | 无检查、安装、选择或执行 |

禁止把 `not_qualified` 画成 `not_installed`、`unavailable`、红色健康失败或永不结束的 checking；禁止显示“重新扫描”
暗示本机操作可以改变产品准入。Diagnostics 可显示 platform row、Host envelope 与 evidence revision，但不启动被拒绝
Adapter 的进程。

### 历史配置精确保留

若已有队员引用当前平台未准入的 Runtime，运行配置区显示冻结值与 `Windows 尚未验证`。Runtime、模型、权限和
参数控件只读，不自动换默认值、不清空、不创建 Installation。用户仍可修改姓名、职责、头像等无关字段；保存时
必须原样回传 Runtime 子对象。只有触碰 Runtime 子对象才显示字段级拒绝，不能用整页错误阻塞无关编辑。

## 5. 文件、工作区与路径失败

Windows 目录选择继续使用系统 Dialog。选择后，Core 的 Host/Storage Admission 决定是否接受；Renderer 只显示稳定
结果和下一步：

- local NTFS 且在 tested envelope 内：继续现有添加 Project 或保存流程；
- UNC、network、removable、non-NTFS：保留 Dialog 前的页面、Draft、选择和焦点，显示不支持的存储类型；
- host long-path policy 未满足或路径超出 tested envelope：显示精确 blocker，不建议用户修改注册表；
- Explorer 动作只在对象仍通过 Core identity 验证时可用；失败保留对象上下文并允许重试或重新选择。

路径使用等宽数字/证据字体、`overflow-wrap: anywhere` 和可复制原文；不全局小写、不用盘符字符串决定同一对象。
普通设置、队员和 Camp 页面不显示 `%LOCALAPPDATA%` 私有目录；需要诊断时沿用 allowlist/redaction 和显式 Save Dialog。

## 6. Installer、Upgrade 与 Uninstall

Windows 安装器属于独立系统流程，不嵌入 App Shell：per-user 安装默认不要求管理员权限；安装完成后的首次启动进入
现有 Onboarding gate。升级检测到运行中的 App 时要求先关闭，等待 Planned Shutdown 完成后才替换 sidecar；不能
提供“仍然继续并强制覆盖”。

卸载默认保留用户数据。删除数据必须是未默认选中的显式选项，并在执行前二次确认范围；卸载器不得把“删除程序”
与“删除工作区”混为一谈。schema-incompatible downgrade 由启动前检查阻断，并提供当前版本、目标版本和安全下一步。

## 7. 可访问性与真机矩阵

自动化应覆盖 DOM 语义、四个顶层菜单入口、受限 native submenu 路由、平台文案映射、Windows chrome 主题同步与
8px 侧栏顶部留白、Admission/Availability 正交状态、历史配置精确保留、
Forced Colors CSS 与 IME composition 不触发提交。真实 Windows 验收至少覆盖：

- Windows 10 22H2 与 Windows 11；100%、125%、150%、200% display scale；
- `1040×700`、`1440×920`、Snap、最大化/还原、多屏不同 DPI 和 200% page zoom；
- Day、Night、System、reduced motion、High Contrast/Forced Colors；
- keyboard-only、NVDA 浏览/表单模式、中文 IME 组合/候选/提交；
- Explorer、local NTFS blocker、clean install、running-App upgrade、保留/删除数据的 uninstall。

固定 Windows Server CI 只证明构建、打包和自动化行为，不证明客户端标题栏、原生 submenu、Snap、DPI、NVDA、IME、SmartScreen 或
Installer UX。缺少真机证据时，对应 Checkpoint 保持未完成。

## References

- [App Shell 与统一侧栏](components/app-shell-navigation.md)
- [Renderer 无障碍基线](qa/accessibility.md)
- [Renderer 主题覆盖矩阵](qa/theme-matrix.md)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [v1.05 实施计划](../versions/v1.05/implementation-plan.md)
