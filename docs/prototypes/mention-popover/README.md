---
document_type: ui-prototype-readme
status: selected-design-input
selected_variant: 2-portrait-side
last_updated: 2026-08-06
---

# Camp 会话区 Mention 侧边照设计稿

> **已确认方向。** 用户于 2026-08-06 再次确认：Mention 视觉采用方案 A，信息弹窗
> 采用方案 2“4:5 角色卡侧栏”。生产交互的稳定合同见
> [Arctic Dawn](../../ui/components/structured-mentions.md#不得回退的交互合同)；不得把本原型误标为废弃，
> 也不得擅自替换为角色 Toast 或队员页跳转。

这是 Camp 会话区 Mention 视觉与成员信息弹窗的交互式 HTML 设计稿，源自
`rovai-mention-popover-prototype-v2.zip` 附件。它用于评审视觉层级和交互行为，
不直接替代生产 React 实现。

## 查看

直接在浏览器打开 `index.html`，或从仓库根目录运行一个静态服务器：

```text
python3 -m http.server 4173 --directory docs/prototypes/mention-popover
```

然后访问 `http://127.0.0.1:4173/index.html?preview=fox`，可直接查看小狐狸的
4:5 侧边照弹窗。

## 本轮范围

- 会话历史与 Composer 的 Mention 均使用默认无底色的轻量蓝色行内样式，并可通过
  Enter/Space 打开成员信息；
- 成员弹窗保持非模态，支持点击空白处或按 Esc 关闭，并将焦点返回原 Mention；
- 成员信息按名称、状态、职责、工作准则和性格底色组织，侧边照只承担身份识别。
- `@所有成员` 展示发送时冻结的收件人范围，不随之后的成员变化重写历史语义。
- 右侧检查器和弹窗在窄窗口下收敛，避免横向溢出。

生产实现必须继续使用现有 `agentProfileId`、受控 portrait rendition 与 Core-owned
Structured Content；视觉稿不能改写寻址语义。当前回归命令是
`pnpm accept:structured-mentions-ui`。

## 文件

- `index.html`：静态会话区和 Inspector 结构。
- `styles.css`：Arctic Dawn Day 视觉样式与响应式规则。
- `app.js`：Mention、弹窗、焦点和 Composer 原型交互。
- `PLAN.md`：方案选择与实现边界记录。
- `assets/role-card-fox-4x5.png`：小狐狸 4:5 角色卡资源。
