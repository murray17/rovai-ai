---
document_type: ui-theme-index
authority: renderer-theme-routing
status: accepted
last_updated: 2026-08-13
---

# Renderer 主题

Rovai AI 有两套生产主题：

| `ResolvedTheme` | 主题合同 | CSS 选择器 |
|---|---|---|
| `day` | [Porcelain Day](porcelain-day.md) | `:root` |
| `night` | [Steel Night](steel-night.md) | `:root[data-theme="night"]` |

`ThemePreference = system | day | night` 是用户偏好。`system` 跟随 macOS 并解析为
`ResolvedTheme = day | night`，不是第三套主题。第三套视觉主题进入生产前，必须另行评估
偏好值是否需要与明暗模式、具体主题 ID 解耦。

依赖方向固定为：

```text
Theme Token → Shared Component → Surface Composition
```

主题不得复制页面，组件不得按主题 ID 分叉业务结构，surface brief 不得重新定义主题 Token。

## 首次绘制与运行时权威

1. Electron Main 在建窗前设置 `nativeTheme.themeSource` 和匹配的窗口背景。
2. `index.html` 在 React 启动前按 `prefers-color-scheme` 写入初始 `data-theme`，避免先亮后暗。
3. Renderer 收到 Main 的 `AppearanceSnapshot` 后，以其中 `resolvedTheme` 覆盖初值，同时更新
   `color-scheme`。
4. 主题切换只更新根 Token 与窗口背景；不得重新挂载页面、移动焦点，或改变 Camp、Tab、
   Draft、滚动、选择、Dialog、Core/IPC 事实。

实现真源是 [`styles.css`](../../../apps/desktop/src/renderer/src/styles.css)、
[`theme.ts`](../../../apps/desktop/src/renderer/src/theme.ts)和主题测试。若文档与生产 Token
不一致，必须报告文档—实现漂移，不得静默选边。

## 新增或修改主题

1. 从 [`_template.md`](_template.md) 创建主题合同并声明稳定 `theme_id`。
2. 为现有完整语义 Token 集提供值，包括八组身份色、状态色、证据色和浮层色。
3. 只修改 canonical Token block；组件选择器不得出现主题专属色值。
4. 按[主题矩阵](../qa/theme-matrix.md)验证相同页面、状态和功能。
5. 运行 Renderer 主题 Token/对比度测试，并完成真实 App 双主题验收。
