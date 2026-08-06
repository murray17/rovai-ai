---
document_type: ui-prototype-plan
status: selected-design-input
selected_variant: 2-portrait-side
last_updated: 2026-08-06
---

# Rovai-ai 会话区样式小改版

> 用户于 2026-08-06 再次确认本方向：Mention 视觉方案 A + 信息弹窗布局 2。
> 本文件记录选型；生产权威与回归边界见
> [Arctic Dawn](../../ui/arctic-dawn.md#不得回退的交互合同)。

## 选定方向

采用“4:5 角色卡侧边照”：队员信息浮层左侧放身份图，右侧按名称、团队角色、Presence、运行时状态、专业职责、工作准则和性格底色排列。

## 本次实现

- 会话历史与 Composer 的 Mention 统一为默认无底色的轻量蓝色行内文本。
- 点击 Mention 在当前会话上方打开非模态浮层，不发生页面跳转。
- 队员浮层固定为侧边照布局，不再保留多方案切换器。
- 复用现有受控 4:5 portrait rendition；缺少真实图的成员使用低权重占位图。
- 支持点击外部、`Esc` 关闭，以及 `Enter`/空格键打开；键盘关闭后焦点回到原 Mention。
- `@所有成员` 保持独立范围说明，历史消息与 Composer 分别展示冻结范围和当前范围。
- 桌面宽屏保留右侧检查器；较窄窗口继续按现有 Arctic Dawn 规则适配。

## 验收方式

1. 直接打开 `index.html`，无需构建或网络连接。
2. 点击历史消息或 Composer 中的 `@小狐狸`、`@小兔`、`@所有成员`。
3. 使用鼠标点空白处或按 `Esc` 关闭弹窗。
4. 使用 Tab 聚焦 Mention，再按 `Enter` 或空格打开。
5. 可使用 `index.html?preview=fox` 直接打开小狐狸侧边照浮层，便于截图检查。

生产验收还必须运行 `pnpm accept:structured-mentions-ui`，并以
[桌面 UI 验收指南](../../development/ui-acceptance.md#结构化-mention-门禁)为准。
