---
document_type: version-overview
version: v0.07
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-24
---

# Lumen AI v0.07 Hearth & Camp 双主题视觉系统

> 状态：已完成；检查点 1–5 已完成
>
> 文档规则：[文档导航](../../README.md)
>
> 稳定 UI 规范：[UI 规范索引](../../ui/README.md)
>
> 前置版本：[v0.06 Team Task 协作工具](../v0.06/README.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)
>
> 更新日期：2026-07-24

## 版本目标

v0.07 将现有亮色工作台升级为统一的 **Hearth & Camp｜家园与营地**
双主题系统：

- **Hearthlight Day｜家园晨光**提供清新、温暖、安定的长期协作环境。
- **Night Camp｜夜色营地**提供低眩光、专注且适合审批、审计、Diff 和夜间执行的环境。
- 两种主题共享现有信息架构、组件尺寸、状态语义和交互行为。
- 默认跟随系统，同时支持用户在设置页手动选择并持久化偏好。
- 完整迁移全部 Renderer 页面和状态，不保留长期混用的旧颜色系统。

本版本是视觉系统与主题基础设施升级，不改变 Camp、Conversation、Task、AgentRun、
Approval 或 Runtime 的领域语义。

## 已确认决策

### HC-01 统一命名与叙事

- 设计方向统一命名为 **Hearth & Camp｜家园与营地**。
- 白昼主题命名为 **Hearthlight Day｜家园晨光**。
- 暗色主题命名为 **Night Camp｜夜色营地**。
- 家园、营地和成长只构成品牌与语气层，不替换 Camp、Task、Approval、Audit、Recovery 等准确术语。
- 禁止用等级、经验、金币、Quest 或“魔法”等游戏化表达掩盖真实工作状态。

### HC-02 不改变信息架构与组件几何

- 保留当前固定左侧导航、顶栏、中央公共讨论、右侧 Inspector 和 Composer。
- 保留现有 Sidebar、Topbar、面板尺寸、交互流程和最小窗口边界。
- 允许迁移颜色、边框、阴影、圆角、焦点、状态表现以及修复必要的对齐问题。
- 不以主题升级为理由调整导航、页面职责、工作区密度或领域文案。

### HC-03 不新增首页和插画资产

- 不新增独立“家园首页”；大厅新对话、空状态和 Onboarding 是低频故事表达区域。
- v0.07 不制作新的插画资产。
- 允许使用主题色、现有图标、轻微非图片纹理和克制文案建立氛围。
- Camp 核心工作区、命令、Diff、审批、审计和恢复继续坚持证据优先。

### HC-04 主题偏好是全局应用设置

- 用户偏好固定为 `system | day | night`，默认 `system`。
- 主题入口只位于“设置 → 外观”，不增加 Sidebar 快捷按钮，也不支持每 Camp 主题。
- `system` 实时响应 macOS 外观变化；手动选择覆盖系统外观并持久化。
- 主题偏好不写入 Camp、Message、AgentRun、Event Log 或审计。
- 主题切换不得改变 Tab、Composer 草稿、滚动、选择或焦点。

### HC-05 Renderer 与原生界面使用同一解析主题

- Renderer 根节点和 Electron 原生主题共享同一个 `ResolvedTheme`。
- BrowserWindow 背景、原生菜单、右键菜单和系统 Dialog 在平台允许范围内响应用户选择。
- 首次可见绘制前必须解析主题，避免亮色/暗色闪烁。
- 不支持覆盖的系统级窗口由 macOS 管理，不通过自绘模拟。

### HC-06 主题原子切换

- 不做全应用颜色渐变，不设置全局 `transition: all`。
- 不播放太阳、月亮、营火、星空或视差切换动画。
- 主题选择控件自身可以使用普通 Hover/Pressed 动效。
- `prefers-reduced-motion` 不影响主题信息或状态反馈。

### HC-07 证据区域拥有独立中性 Token

- 命令、日志、JSON、Diff 和审计详情跟随 Day/Night 切换浅/深证据表面。
- 证据 Token 与品牌、营火、成员身份色分离。
- Day 使用高对比浅色代码面；Night 使用深色代码面。
- 证据区域禁止插画、纹理、衬线、光晕和角色大面积底色。

### HC-08 成员身份色由稳定 ID 分配

- 使用经过 Day/Night 验证的有限身份色板，根据 `AgentProfile.id` 稳定分配。
- 同一成员跨 Camp 和重启保持同色；不按名称、Lead、Assignee 或 Runtime 分配。
- 不在成员设置页增加颜色配置。
- 不在设计系统中硬编码洛可、沐瓦等成员名称。
- 身份色只表示“是谁”，不表示运行、成功、等待、选中或危险。

### HC-09 允许修正下载方案中的具体色值

- 保留暖白、苔藓绿、深森林和营火橙的色相方向。
- 具体色值必须通过 WCAG 2.2 AA、状态区分和真实组件验证。
- 原方案中对比度不足的 `faint`、Day 状态前景以及 Night Brand 前景已经在稳定规范中修正。
- Night Primary 固定使用深色 `brand-contrast`，不得机械复用白字。

### HC-10 UI 文档使用渐进式索引

- `docs/ui/README.md` 保存简洁稳定原则、阅读路由和 Coding Agent 完成检查。
- `docs/ui/hearth-and-camp.md` 保存当前详细主题、色号、组件和无障碍契约。
  （勘误：该文件及后续 Meridian 规范均已删除，原文见 Git 历史；当前规范见
  [Arctic Dawn](../../ui/arctic-dawn.md)。）
- 本文与实施计划保存版本决策、迁移顺序、状态和验收记录。
- 删除旧 `docs/UI_STYLE.md`，不保留 Legacy 副本；历史由 Git 维护。

### HC-11 全部 Renderer 页面一次完成

- 大厅、Camp、成员、设置、Inspector、Task、消息、活动、审批、审计、错误、恢复、Dialog 和 Popover 均在 v0.07 内完成双主题。
- 实施可以分检查点提交，但任一中间状态不得成为版本完成状态。
- 完成后删除无使用者的旧 Token、散落色值和临时兼容别名。

### HC-12 自动实施，最后统一人工验收

- 实施过程不设置用户人工审核卡点。
- 主题逻辑、持久化、系统变化、首次绘制、组件行为和回归由自动化测试覆盖。
- 每个检查点由实现 Agent 完成测试与必要的真实 App 检查，发现问题直接修复。
- 最终完成全部步骤后，再由用户进行一次统一人工验收。
- 不建立容易受 macOS 字体和 Electron 版本影响的像素级 Golden Test。

## 非目标

- 不新增独立首页、Home Dashboard、成长数值系统或游戏化导航。
- 不新增插画、字体、图标、UI 框架、CSS-in-JS、动画库或状态管理库。
- 不修改 Camp、Task、Conversation、AgentRun、Approval 或 Runtime 协议。
- 不增加每 Camp、每成员或每窗口主题偏好。
- 不把主题切换写入 Core 业务数据库、Event Log 或审计。
- 不在本版本重做布局、响应式策略或组件尺寸。

## 当前状态

- 设计方向、版本边界、文档分层、主题行为、证据区域和身份色决策已经确认并实现。
- Renderer/Main 主题偏好、首次绘制、原生同步、设置入口和 Day/Night Token 已完成。
- 大厅、Camp、成员、设置、Inspector、Task、Context、Approval 与 Audit 已迁移到同一语义系统。
- 旧视觉死代码与散落颜色已清理；主题 Token 完整性、对比度和引用关系已有自动化门禁。
- TypeScript、39 项 Vitest、Rust Workspace、Core/成员 Smoke、生产构建、macOS 打包与签名校验通过。
- Day/Night × `1440×920` / `1040×700` 的首次启动和 Camp 工作区真实 App 矩阵均已通过。
- 详细实施与验收事实见 [implementation-plan.md](implementation-plan.md)。
