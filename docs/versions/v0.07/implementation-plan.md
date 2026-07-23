---
document_type: implementation-plan
version: v0.07
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-23
---

# Lumen AI v0.07 实施计划与验收清单

> 状态：待实施
>
> 版本范围：[README.md](README.md)
>
> 稳定 UI 规范：[UI 规范索引](../../ui/README.md)与
> [Hearth & Camp 详细规范](../../ui/hearth-and-camp.md)
>
> 文档规则：[文档导航](../../README.md)

## 实施原则

- 分成五个可独立验证的检查点；每个检查点完成代码、测试和文档状态更新后形成独立 Commit。
- 先建立主题状态、首次绘制和 Token 真源，再迁移组件；不得在组件中临时堆叠主题判断。
- Day 必须在迁移过程中维持现有可用性；Night 不能通过反色或单一滤镜伪造。
- 每个阶段执行自动化测试和 Agent 自主 App 检查，不等待用户中途验收。
- 只有全部页面、状态和最终 App 验收完成后，版本才可以标记为已完成。

## 检查点 1：主题基础设施与首次绘制

> 实施状态：未开始。

目标：建立唯一的主题偏好、解析和原生同步路径。

实施内容：

- 增加 `ThemePreference = system | day | night` 与 `ResolvedTheme = day | night` 的纯函数模型。
- 在 Renderer 首次可见绘制前读取持久化偏好、解析系统外观并设置根 `data-theme` 和 `color-scheme`。
- 仅在偏好为 `system` 时监听系统主题变化；无效旧值直接回退为 `system`。
- 将解析主题同步给 Electron `nativeTheme`、BrowserWindow 背景和可控原生菜单/Dialog。
- 在“设置 → 外观”增加三项主题选择，保存成功后原子切换，不刷新页面。
- 覆盖初始化、持久化、无效值、系统变化、手动覆盖、IPC 失败和窗口重开测试。

完成门：

- 首次绘制没有错误主题闪烁。
- 主题切换不改变草稿、Tab、滚动、选择和焦点。
- Renderer 与可控原生界面保持一致。
- TypeScript、Renderer/Main 测试和生产构建通过。

## 检查点 2：Token 系统与 App Shell

> 实施状态：未开始。

目标：让基础表面、状态和所有共享控件只依赖 Day/Night 语义 Token。

实施内容：

- 在共享样式层建立基础、状态、证据、Diff、身份和 Overlay Token。
- 修正 Day/Night 对比度，固定 `brand-contrast`，禁止组件自行猜测前景色。
- 迁移 App Shell、Sidebar、Topbar、导航、基础 Button、Form、Badge、Dialog、Popover 和菜单。
- 保持当前 `220px` Sidebar、`60px` Topbar 与组件几何。
- 临时别名只映射旧变量到新语义；不得增加反向双写。
- 增加 Token 完整性和关键前景/背景对比度测试或确定性校验。

完成门：

- App Shell 和基础控件在两种主题下完整可用。
- 无组件级 Day/Night 硬编码色值。
- Night Primary 使用固定深色前景；Focus、Hover、Pressed、Disabled 可区分。
- 相关测试、构建和两种主题真实启动检查通过。

## 检查点 3：大厅、Camp、成员与设置

> 实施状态：未开始。

目标：迁移全部高频业务页面，不改变信息架构和交互流程。

实施内容：

- 迁移大厅新对话和空状态，仅使用主题色、现有图标、轻微非图片纹理和克制文案。
- 迁移 Camp 消息、状态条、Composer、提及、活动标记和公共讨论。
- 迁移成员列表、成员编辑、Runtime/模型/权限配置和成员状态。
- 迁移设置页全部分区，包括新外观设置、Runtime 安装、安全、数据、诊断与关于。
- 按 `AgentProfile.id` 计算稳定身份色，确保同一成员跨 Camp 一致。
- 覆盖 Loading、Empty、Error、Disabled、Runtime not ready、Core disconnected 和版本冲突。

完成门：

- 不存在独立首页、插画资产、RPG 文案或核心工作区装饰。
- 大厅、Camp、成员和设置在 Day/Night 下功能等价。
- 身份色不硬编码成员名称、不表达系统状态。
- Typecheck、Renderer 测试、生产构建和真实 App 主路径检查通过。

## 检查点 4：Inspector 与证据优先区域

> 实施状态：未开始。

目标：完成 Task、活动、上下文、审批、审计、Diff、错误和恢复的专业双主题表现。

实施内容：

- 迁移 Inspector Tabs、分组、计数徽标、Sticky、滚动和焦点。
- 迁移 Task 创建、编辑、终态、版本冲突、Assignee 和权限状态。
- 让命令、日志、JSON、Diff 和审计详情只使用独立证据 Token。
- 迁移 Approval 的范围、后果、阻塞、最安全初始焦点和危险操作表现。
- 迁移 Recovery、未知副作用、错误和重试状态，保留所有不确定性说明。
- 验证长路径、命令、JSON、日志和 Diff 不撑破两种窗口尺寸。

完成门：

- 证据区域在 Day 为高对比浅色、Night 为高对比深色，且无品牌装饰。
- 状态均有文字与图标/结构，不依赖颜色。
- Dialog、Tabs、键盘和 Focus 行为不回归。
- 相关测试、构建和真实审批/Task/恢复路径检查通过。

## 检查点 5：清理、全量回归与最终验收

> 实施状态：未开始。

目标：删除旧视觉系统，证明全 App 没有主题断层，并准备用户最终人工验收。

实施内容：

- 删除无使用者的旧 Token、临时别名、散落颜色和不可达主题代码。
- 扫描 Renderer 中的十六进制、RGB、白色透明层和主题专属硬编码，逐项收口或明确例外。
- 完成主题逻辑、Renderer、Main、Core 回归、生产构建和 macOS 打包验证。
- 使用隔离数据目录验证首次启动、持久化、窗口重开、系统主题变化和手动覆盖。
- 由自动化/脚本启动以下四组真实 App 场景，并由实现 Agent完成视觉检查：
  - Day `1440×920`
  - Day `1040×700`
  - Night `1440×920`
  - Night `1040×700`
- 覆盖大厅、Camp、成员、设置、Task、Approval、Activity、Audit、Error、Recovery、Dialog 和 Popover。
- 更新 README、版本状态、本地开发说明和实际验收记录。

完成门：

- 全部页面和状态无亮暗断层、不可读文字、焦点丢失或整页横向滚动。
- 主题解析、持久化、系统变化和首次绘制测试通过。
- 全量测试、生产构建、macOS 打包和真实 App 四组检查通过。
- 不存在无使用者旧 Token、临时兼容路径或未解释散落颜色。
- 所有步骤完成后才交给用户进行一次最终人工验收。

## 最终验收矩阵

四组尺寸/主题都必须覆盖：

- App Shell、Sidebar、Topbar、导航选中和本地健康状态。
- 大厅新对话、Camp 消息、Composer、提及和运行状态。
- 成员、Runtime 配置、模型/权限与外观设置。
- Task 的 Loading、Empty、编辑、冲突、Completed 和 Cancelled。
- Inspector、命令、日志、上下文、审批、审计和 Diff。
- Error、Disabled、Runtime not ready、Core disconnected 和 Recovery。
- Dialog、Popover、菜单、键盘焦点与长内容。

## 实施状态摘要

| 检查点 | 状态 | 证据 |
|---|---|---|
| 1. 主题基础设施与首次绘制 | 未开始 | — |
| 2. Token 系统与 App Shell | 未开始 | — |
| 3. 大厅、Camp、成员与设置 | 未开始 | — |
| 4. Inspector 与证据区域 | 未开始 | — |
| 5. 清理、回归与最终验收 | 未开始 | — |

