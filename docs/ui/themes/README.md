---
document_type: ui-theme-index
authority: renderer-theme-routing
status: accepted
last_updated: 2026-09-12
---

# Renderer 主题

Rovai AI 有两套生产主题：

| `ResolvedTheme` | 主题合同 | CSS 选择器 |
|---|---|---|
| `day` | [Porcelain Day](porcelain-day.md) | `:root` |
| `night` | [Steel Night](steel-night.md) | `:root[data-theme="night"]` |

`ThemePreference = system | day | night` 是用户偏好。`system` 跟随当前宿主 OS 的应用主题并解析为
`ResolvedTheme = day | night`，不是第三套主题。第三套视觉主题进入生产前，必须另行评估
偏好值是否需要与明暗模式、具体主题 ID 解耦。

依赖方向固定为：

```text
Theme Token → Shared Component → Surface Composition
```

主题不得复制页面，组件不得按主题 ID 分叉业务结构，surface brief 不得重新定义主题 Token。

## 首次绘制与运行时权威

1. Electron Main 在建窗前设置 `nativeTheme.themeSource` 和匹配的窗口背景；macOS appearance 与 Windows Apps
   theme 都只解析为同一 `ResolvedTheme`。
2. `index.html` 在 React 启动前按 `prefers-color-scheme` 写入初始 `data-theme`，避免先亮后暗。
3. Renderer 收到 Main 的 `AppearanceSnapshot` 后，以其中 `resolvedTheme` 覆盖初值，同时更新
   `color-scheme`。
4. 主题切换只更新根 Token 与窗口背景；不得重新挂载页面、移动焦点，或改变 Camp、Tab、
   Draft、滚动、选择、Dialog、Core/IPC 事实。

实现真源是 [`theme.css`](../../../packages/ui/src/theme.css)、
[`theme.ts`](../../../apps/desktop/src/renderer/src/theme.ts)和主题测试。若文档与生产 Token
不一致，必须报告文档—实现漂移，不得静默选边。

## 外观与阅读偏好

外观页把主题、字号、阅读疏密、整页缩放与减少动态效果保存在 Desktop Main 的同一份本机偏好中，
不产生 Camp、消息或 Core 领域事件。`AppearanceSnapshot` 同时提供保存的偏好与解析后的主题；
`AppearanceApi.updatePreferences` 只接受封闭字段的增量，主题专用入口继续保留其他阅读偏好。

- 会话字号默认 13px，作用于 Camp／单聊正文与输入框；导航、消息时间、状态和操作按钮保留其原排版。
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

Main 原子保存 schema-v2 偏好，并串行处理连续更新。schema-v1 主题文件按原主题加默认阅读偏好读取，
显式调整后升级；无效文件保持原字节并在内存使用安全默认值，保存失败不发布成功快照。
页面保留未保存的调整和重试入口，恢复默认只重置外观字段。

## 新增或修改主题

1. 从 [`_template.md`](_template.md) 创建主题合同并声明稳定 `theme_id`。
2. 为现有完整语义 Token 集提供值，包括八组身份色、十组 Agent artifact 格式色、状态色、证据色和浮层色。
3. 只修改 canonical Token block；组件选择器不得出现主题专属色值。
4. 按[主题矩阵](../qa/theme-matrix.md)验证相同页面、状态和功能。
5. 运行 Renderer 主题 Token/对比度测试，并完成真实 App 双主题验收。
