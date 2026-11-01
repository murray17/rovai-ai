---
document_type: ui-theme-index
authority: renderer-theme-routing
status: accepted
last_updated: 2026-10-30
---

# Renderer 主题

Rovai AI 有五套配色，外观页提供六项偏好：跟随系统、日间、夜间、晨雾、朝霞、绯夜。

| `ThemeId` | 主题合同 | `ResolvedTheme` / `color-scheme` | CSS 选择器 |
|---|---|---|---|
| `day` | [Porcelain Day](porcelain-day.md) | `day` / `light` | `:root` |
| `night` | [Steel Night](steel-night.md) | `night` / `dark` | `:root[data-theme="night"]` |
| `horizon` | [晨雾 / Morning Mist](horizon.md) | `day` / `light` | `:root[data-theme-id="horizon"]` |
| `classic-red` | [朝霞 / Dawn Glow](classic-red.md) | `day` / `light` | `:root[data-theme-id="classic-red"]` |
| `ember` | [绯夜 / Crimson Night](ember.md) | `night` / `dark` | `:root[data-theme-id="ember"]` |

显示名称与稳定 `ThemeId` 分离；更名不改变持久化值或合同路径。

`ThemePreference = system | ThemeId` 保存具体偏好；`ResolvedTheme = day | night` 继续表示明暗模式，
供系统明暗外观、代码高亮与原生控件模式使用。共享 `THEME_MODES` 拥有配色到模式的映射。
Windows caption controls 的背景与图标色按具体 `ThemeId` 的 `--rail` / `--ink` 同步，不只按明暗模式取色。
`system` 仅解析为日间或夜间，不随系统自动选择其他配色。根 `data-theme` 保留明暗模式，
`data-theme-id` 表示有效配色；每次切换均覆盖有效配色属性，避免残留。

依赖方向固定为：

```text
Theme Token → Shared Component → Surface Composition
```

主题不得复制页面，组件不得按主题 ID 分叉业务结构，surface brief 不得重新定义主题 Token。

## 首次绘制与运行时权威

1. Electron Main 在建窗前按偏好设置 `nativeTheme.themeSource` 和匹配的配色窗口背景；macOS appearance 与 Windows Apps
   theme 都只解析为同一 `ResolvedTheme`。
2. `index.html` 在 React 启动前按 `prefers-color-scheme` 写入初始 `data-theme`，避免先亮后暗。
3. Renderer 收到 Main 的 `AppearanceSnapshot` 后，以其中 `resolvedTheme` 覆盖初始明暗模式，按 `preference` 与模式解析具体配色，
   同时更新 `data-theme-id` 和 `color-scheme`。
4. 主题切换只更新根 Token、窗口背景与 Windows caption controls 配色；不得重新挂载页面、移动焦点，或改变 Thread、Tab、
   Draft、滚动、选择、Dialog、Core/IPC 事实。

实现真源是 [`theme.css`](../../../packages/ui/src/theme.css)、
[`theme.ts`](../../../apps/desktop/src/renderer/src/theme.ts)和主题测试。若文档与生产 Token
不一致，必须报告文档—实现漂移，不得静默选边。

## 外观与阅读偏好

外观页把主题、字号、阅读疏密、整页缩放与减少动态效果保存在 Desktop Main 的同一份本机偏好中，
不产生 Thread、消息或 Core 领域事件。`AppearanceSnapshot` 同时提供保存的偏好与解析后的主题；
`AppearanceApi.updatePreferences` 只接受封闭字段的增量，主题专用入口继续保留其他阅读偏好。

- 会话字号默认 13px，作用于 Thread／单聊正文与输入框；导航、消息时间、状态和操作按钮保留其原排版。
- 文档字号默认 15px，作用于 Markdown 文件正文，标题、表格与代码块等比例调整。
- 代码字号默认 14px，作用于源码、纯文本和文件差异正文／行号。长行在阅读器内横向滚动。
- 三种字号只接受 12–24px 的整数；标准／宽松调整正文行距与段落间距，不改变代码行距比例。
- 原生 Electron 缩放默认 100%，设置页与快捷键共用 Chrome 桌面档位：25、33、50、67、75、80、90、
  100、110、125、150、175、200、250、300、400、500%。每次按方向进入相邻档位，到达首尾后停止；
  33% 和 67% 分别以精确的 1/3、2/3 倍率渲染，来源为 [Chromium 缩放常量](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/common/page/page_zoom.cc)。
  已有 10–500% 非预设保存值继续显示和恢复，不重置其他外观偏好；下一次快捷键选择该方向最近的
  档位，没有候选时保持当前值。变化同步到设置页并持久化，重新建窗恢复相同实际倍率。
- 减少动态效果默认跟随系统；始终减少同时覆盖 CSS 动效、程序化平滑滚动和地图运动。
  设置不隐藏状态、进度或动作结果，也不改变 Runtime 执行。

字体偏好不覆盖 HTML 文档自身样式或图片的独立缩放；整页缩放仍作用于应用窗口。
主题切换、字号和疏密调整通过根属性与 CSS 变量应用；不以重新挂载页面实现变化。

Web 使用同一外观页面、主题和阅读偏好模型，由浏览器入口显式注入当前 Host/Owner 作用域的本地偏好适配。
整页缩放由浏览器菜单或快捷键控制；Web 外观页解释这一差异，不显示无法控制浏览器倍率的选择器。
恢复外观默认值不重置浏览器保存的缩放。Desktop 仍使用上述原生 Chrome 档位。

外观保存使用封闭字段校验、串行更新与原子写入；更改主题不重置其他阅读参数。
无效文件保留原字节并使用安全默认值，保存失败不发布成功快照。
页面保留未保存的调整和重试入口，恢复默认只重置外观字段。

## 新增或修改主题

1. 从 [`_template.md`](_template.md) 创建主题合同并声明稳定 `theme_id`。
2. 为现有完整语义 Token 集提供值，包括八组身份色、十组 Agent artifact 格式色、状态色、证据色和浮层色。
3. 只修改 canonical Token block；组件选择器不得出现主题专属色值。
4. 按[主题矩阵](../qa/theme-matrix.md)验证相同页面、状态和功能。
5. 运行 Renderer 主题 Token/对比度测试，并完成生产组件的所有配色验收，并明确原生平台实测范围。

## 配色与交互边界

控件、文字、品牌、状态与身份色的职责遵循 [DESIGN.md](../../../DESIGN.md#colors)，包括 Portal 内的控件。
所有配色沿用相同消息几何与交互，不增加主题专属聚焦装饰、动画或功能。

`--scrollbar-thumb` 拥有通用滚动块与 Mission 文件树底色，不复用选中区域色；
Memory 与 Automation 的滚动块局部使用 `--neutral-selected`；这不把 Automation 的操作色改为无彩色。
透明轨道、尺寸和拖动反馈保持一致。

`--execution-surface` 拥有执行台在底部、浮层和右侧标签中的统一阅读底色，包括头像状态背板与滚动渐隐。
晨雾的会话使用轻暖白、执行台使用中性白；其他配色的执行台与会话底色一致。
手机继续由 `--mobile-page` 同时覆盖会话与执行台底色。

主题选择沿用整卡原生 radio、缩略图、名称与选中勾；980px 内容轨道为六列紧凑卡片，
容器不超过 900px 时三列，不超过 420px 时两列。键盘与焦点遵循共享控件规则。
`--settings-choice-selected-surface` 拥有外观选项的选中底色；朝霞使用淡灰红区域色，
其余配色使用各自 `--home-surface` 色值。选中边线继续由 `--settings-choice-selected-line` 拥有。
