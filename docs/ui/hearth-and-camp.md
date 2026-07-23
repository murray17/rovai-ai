---
document_type: ui-design-system
authority: renderer-ui-detail
status: accepted
design_direction: hearth-and-camp
theme_modes:
  - day
  - night
last_updated: 2026-07-23
---

# Hearth & Camp 详细设计规范

本文定义 Lumen 当前可执行的双主题、视觉 Token 和组件外观契约。稳定总则与
Coding Agent 阅读入口见 [UI 规范索引](README.md)；v0.07 的迁移进度与验收事实见
[版本文档](../versions/v0.07/README.md)。

## 1. 体验边界

### Hearthlight Day｜家园晨光

- 暖白纸张和浅灰绿色构成安定的日常协作环境。
- 苔藓绿承担品牌和建设性操作；营火橙只提供少量温度。
- 表面轻盈、边界清晰，不堆叠纯白悬浮卡片。

### Night Camp｜夜色营地

- 深森林和炭黑构成低眩光、适合长期执行的工作环境。
- 苔藓绿提高亮度以保持品牌连续性；营火橙保持克制。
- 面板依靠明度和边界区分，不使用玻璃拟态、霓虹或持续发光。

两种主题只改变视觉材料，不改变信息架构、尺寸、功能或状态含义。

## 2. 主题契约

```ts
type ThemePreference = "system" | "day" | "night"
type ResolvedTheme = "day" | "night"
```

- 偏好全局持久化，推荐键为 `lumen.theme-preference`。
- `system` 通过系统原生外观解析，并只在该偏好下监听系统变化。
- 根节点使用 `data-theme="day|night"`，同时设置正确的 `color-scheme`。
- Electron 原生主题与 Renderer 解析结果一致；平台不允许覆盖的系统界面除外。
- 初始化必须早于首次可见绘制；无有效偏好时回退到 `system`。
- 无效或旧值直接丢弃，不保留兼容枚举。
- 切换为原子替换，不设置 `transition: all` 或全局颜色过渡。

## 3. 基础 Token

以下值是当前设计契约。实现可以在迁移期间提供旧变量别名，但不得长期维护两套含义重叠的色系。

### 3.1 Hearthlight Day

| Token | 值 | 用途 |
|---|---:|---|
| `--canvas` | `#F4F1E8` | App 背景 |
| `--surface` | `#FCFBF6` | 主工作表面 |
| `--surface-raised` | `#FFFFFF` | Dialog、Popover、菜单 |
| `--surface-subtle` | `#ECEFE4` | Sidebar、次级区域 |
| `--surface-muted` | `#E6E1D6` | Hover、Disabled、弱分组 |
| `--ink` | `#222824` | 主文字 |
| `--muted` | `#59635A` | 次级文字 |
| `--faint` | `#687269` | 元数据；仍须满足普通文字对比度 |
| `--line` | `#D5D8CE` | 常规边界 |
| `--line-strong` | `#B9C1B8` | 输入、选中和强边界 |
| `--brand` | `#3F6F5A` | 品牌与主要操作 |
| `--brand-hover` | `#315A49` | 品牌 Hover |
| `--brand-contrast` | `#FFFFFF` | 品牌底上的文字/图标 |
| `--brand-soft` | `#DDE9E1` | 品牌弱背景 |
| `--ember` | `#C87945` | 低频叙事强调 |
| `--ember-soft` | `#F4E4D7` | 营火弱背景 |
| `--focus` | `#176C8C` | Focus ring |
| `--overlay` | `rgba(24, 31, 27, 0.42)` | Modal 遮罩 |
| `--shadow-dialog` | `0 28px 90px rgba(35, 34, 29, 0.28)` | 浮层阴影 |

### 3.2 Night Camp

| Token | 值 | 用途 |
|---|---:|---|
| `--canvas` | `#121915` | App 背景 |
| `--surface` | `#1B2420` | 主工作表面 |
| `--surface-raised` | `#28332D` | Dialog、Popover、菜单 |
| `--surface-subtle` | `#222D27` | Sidebar、次级区域 |
| `--surface-muted` | `#303A34` | Hover、Disabled、弱分组 |
| `--ink` | `#F1F4EE` | 主文字 |
| `--muted` | `#B3BCAF` | 次级文字 |
| `--faint` | `#89948A` | 元数据 |
| `--line` | `#36433A` | 常规边界 |
| `--line-strong` | `#526257` | 输入、选中和强边界 |
| `--brand` | `#86B89B` | 品牌与主要操作 |
| `--brand-hover` | `#9BC8AC` | 品牌 Hover |
| `--brand-contrast` | `#142018` | 品牌底上的文字/图标 |
| `--brand-soft` | `#22392D` | 品牌弱背景 |
| `--ember` | `#E3A06E` | 低频叙事强调 |
| `--ember-soft` | `#3A2A20` | 营火弱背景 |
| `--focus` | `#7CC4E0` | Focus ring |
| `--overlay` | `rgba(2, 7, 4, 0.72)` | Modal 遮罩 |
| `--shadow-dialog` | `0 30px 96px rgba(0, 0, 0, 0.58)` | 浮层阴影 |

## 4. 语义状态 Token

品牌绿、营火橙和身份色不得替代下列状态色。`soft` 只作为弱背景；正文和图标使用对应前景色。

### Day

| 语义 | 前景 | 弱背景 |
|---|---:|---:|
| `success` | `#356647` | `#DFECE3` |
| `attention` | `#7A4E14` | `#F4E7CF` |
| `danger` | `#A2463F` | `#F5E1DE` |
| `info` | `#3D6383` | `#E1EAF1` |
| `neutral` | `#59615B` | `#E8E9E4` |

### Night

| 语义 | 前景 | 弱背景 |
|---|---:|---:|
| `success` | `#82B891` | `#20362A` |
| `attention` | `#E0B268` | `#3B3020` |
| `danger` | `#E28A82` | `#3C2524` |
| `info` | `#89ACC7` | `#223441` |
| `neutral` | `#A2AAA3` | `#2A312C` |

实现变量使用 `--success / --success-soft` 等成对名称。状态必须同时包含文字和图标或形状；弱背景本身不构成状态。

## 5. 证据区域 Token

命令、日志、Diff、审计详情和结构化 JSON 使用独立中性表面，不继承品牌纹理或身份色。

| Token | Day | Night |
|---|---:|---:|
| `--evidence-canvas` | `#F1EFE8` | `#0F1512` |
| `--evidence-surface` | `#FAF9F4` | `#161E1A` |
| `--evidence-ink` | `#202623` | `#EBF0EB` |
| `--evidence-muted` | `#59615D` | `#ABB5AD` |
| `--evidence-line` | `#CDD2CB` | `#344139` |
| `--diff-add` | `#245E3E` | `#92C5A0` |
| `--diff-add-soft` | `#E3F1E6` | `#1B3325` |
| `--diff-remove` | `#873B36` | `#F0A09A` |
| `--diff-remove-soft` | `#F6E2E0` | `#3A2323` |
| `--diff-hunk-soft` | `#E4EBEF` | `#1E3038` |

- Diff 同时使用 `+/-`、行结构和颜色。
- `stdout`、`stderr`、系统错误和退出状态必须有文字标签。
- 大段输出局部滚动或折叠，不能撑破 App Shell。
- 证据区域不使用衬线字体、品牌图案、角色底色、光晕或透明模糊。

## 6. 成员身份色

使用下面的有序色板，通过稳定的 `AgentProfile.id` 映射色板索引：

| 索引 | Day | Night |
|---:|---:|---:|
| 1 | `#A65F4A` | `#E49A7F` |
| 2 | `#39777A` | `#7DB8B6` |
| 3 | `#74628F` | `#A99AD0` |
| 4 | `#9A6A32` | `#D5A56B` |
| 5 | `#4F729B` | `#8FB5D9` |
| 6 | `#8A5C75` | `#D49AB6` |
| 7 | `#547245` | `#91B47C` |
| 8 | `#8C6146` | `#C99D7C` |

- 映射只依赖稳定 ID，不依赖名称、Camp、Assignee、Lead 或 Runtime。
- 同一成员跨 Camp 和重启保持同色；允许不同成员在大规模场景中复用色板。
- 身份色只用于头像环、名称旁细线/小点、发言者和所有权提示。
- 身份色不得用作正文、状态、选中、按钮、禁用或大面积消息背景。

## 7. 字体、间距与表面

- 正文使用 macOS 系统无衬线栈；中文正文通常为 `13–14px`。
- 命令、路径、日志、哈希、JSON 和 Diff 使用系统等宽栈，通常为 `12px`。
- 衬线字体只允许用于大厅欢迎、空状态和品牌级标题；工作区正文与控件禁止使用。
- 间距只使用 `4 / 8 / 12 / 16 / 20 / 24 / 32px`，微型状态允许 `2px`。
- 控件圆角 `6–8px`，常规面板 `8–10px`，Dialog/Popover `10–12px`。
- v0.07 保留现有 `220px` Sidebar、`60px` Topbar 和整体面板几何，不借主题迁移调整信息密度。
- 普通面板、消息、Inspector 行和 Task 行不使用阴影；阴影只属于真正浮层。
- 当前工作区不使用图片纹理。若使用纯 CSS 弱纹理，其对比度不得影响文字和状态读取。

## 8. 组件规则

### App Shell、Sidebar 与 Topbar

- Canvas、Sidebar、Topbar、主工作区和 Inspector 由不透明表面及稳定分隔线组织。
- 选中 Camp 使用 `brand-soft`、稳定边界/标记和文字权重；Hover 不得强于选中态。
- 删除只出现在菜单或确认 Dialog，并始终使用 `danger`。
- 本地 Core/Runtime 状态使用真实状态文字，不使用故事隐喻。
- Topbar 不放装饰，只展示上下文、运行/审批摘要和当前内容操作。

### 大厅与空状态

- 不新增独立首页；大厅新对话就是默认低信息入口。
- v0.07 不制作插画资产。允许克制的主题色、现有图标、轻微非图片纹理和温暖但直接的文案。
- 不显示等级、经验、货币、签到、虚假成长数值或 RPG 术语。
- 空状态必须解释为什么为空，并提供一个明确下一步。

### 消息与 Composer

- 用户、Agent、系统事件、错误、恢复和活动证据使用不同结构。
- 用户消息可使用轻微 `brand-soft`；Agent 消息使用普通表面和小面积身份色。
- 系统事件保持中性、紧凑并包含时间或序号，不伪装成 Agent。
- “正在工作”尽量显示成员、当前目的、最近活动或等待原因，不长期只显示 `Thinking…`。
- Composer 保持可见 Label/可访问名称；发送被 Core 接受后才清空草稿。
- 提及成员时展示 Runtime Ready；禁用发送必须解释原因。

### Inspector、Task 与活动

- Inspector 保留活动、Task、上下文、审批、审计；使用行和分组，避免嵌套卡片。
- Tabs 异步或重内容时使用手动激活，Sticky 区域不能裁切焦点环。
- Task 显示标题、状态、负责人、描述摘要及更新时间/来源中的至少一项。
- `pending / in_progress / completed / cancelled` 使用稳定文字和不同图标。
- 创建或分配 Task 不表现为已经唤醒成员。
- 每次命令作为原子活动块；数据存在时展示命令、`cwd`、状态、时长、退出码、来源和输出。

### Approval、Diff、Audit 与 Recovery

- Approval 说明能力、准确范围、原因、允许/拒绝后果、阻塞影响、请求者和 AgentRun。
- 最安全选项优先获得初始焦点；危险与拒绝不能只靠位置或颜色区分。
- Diff 显示路径、变更类型、折叠状态和行符号，禁止装饰。
- Audit 优先展示时间、Actor、动作、目标、结果和证据，长 ID 可缩写但必须可查看/复制。
- Recovery 持久展示恢复对象、最后状态、输入是否被接收、重复执行风险和用户下一步。
- Error 说明失败、影响、可重试性、已保留数据和下一步，不只显示错误码。

### Button、Form 与 Overlay

- 每个局部区域最多一个 Primary；Night Primary 固定使用 `brand-contrast`，不得机械使用白字。
- Danger 不与 Primary 表现为相同权重。
- 控件覆盖 `default / hover / pressed / focus-visible / disabled`，异步场景增加 `loading`。
- Label 可见，Placeholder 不替代 Label；错误必须说明修复路径。
- Radix Dialog/Popover 具有可访问名称、正确焦点管理、`Escape` 和关闭后焦点返回。
- Loading 展示加载对象；超时后提供状态说明。Disabled 降低强调但保持可读。

## 9. 动效与无障碍

- 常规交互使用 `120–180ms` 的透明度或 `2–4px` 小位移。
- 主题本身原子切换，不设置全局过渡，不播放昼夜、营火或星空动画。
- 禁止循环光晕、脉冲、粒子、视差和大幅弹簧。
- 遵循 `prefers-reduced-motion`；功能性 Spinner 在减少动画时降低运动或补充静态状态文字。
- 普通文字至少 `4.5:1`；大文字、组件边界和状态指示遵循 WCAG 2.2 AA。
- 可点击目标至少 `28×28px`，主要操作优先 `32×32px`。
- `focus-visible` 使用清晰的 2px Focus ring，不被滚动容器、Sticky 或 Overlay 遮挡。
- 状态使用颜色、图标、文字或结构的组合；Icon-only 控件提供可访问名称。
- 重要运行和审批变化可以使用 `aria-live`，不得为流式输出逐字播报。

## 10. 实施约束

- 共享色值只在主题 Token 层定义；组件不得出现主题分支硬编码颜色。
- 迁移别名只允许作为 v0.07 的临时桥梁，完成后删除无使用者的 `--paper` 等旧 Token。
- 允许使用 `color-mix()` 生成 Hover 等轻量派生值，但基础语义必须来自本规范 Token。
- 不新增 UI 框架、CSS-in-JS、字体、图标库、动画库或状态管理库。
- 修改 Token 时必须同时验证 Day/Night 对比度、状态区分和全部使用者。
- 实际实现、测试和截图验收以 [v0.07 实施计划](../versions/v0.07/implementation-plan.md)为准。

