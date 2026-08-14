---
document_type: ui-prototype-readme
status: accepted-design-input
target_version: v0.77
last_updated: 2026-08-14
---

# Camp 消息回复与显式接收者交互稿

这是 v0.77 “消息回复链与安全接收者选择”的交互式 HTML 设计稿，用于在生产实现前评审
引用关系、结构化 Mention、Default Lead 与失效作者之间的交互边界。它不替代 Core、Contract、
ADR 或生产 Renderer。

用户已选择方案 C 作为生产方向；同一份交互稿继续保留另外两个方向作为对照：

1. **平衡型：** 回复引用固定为单行，超出以省略号截断；只有异常时展开接收者修复；
2. **接收者优先：** 接收者选择始终可见，安全感最强，但增加 Composer 高度；
3. **轻量无框（已确认）：** 去掉正常引用的独立边框、底色和阴影，作者与摘要仍共用一个可视行，
   超出以省略号截断；危险状态仍完整展开。

三个方向只改变信息密度，不改变安全语义。

## 查看

直接在浏览器打开 `index.html`，或从仓库根目录运行：

```text
python3 -m http.server 4173 --directory docs/prototypes/message-reply-chain
```

然后访问 `http://127.0.0.1:4173/`。

## 可评审状态

- **作者可用：** 点击 Agent 消息的“回复”后保留引用，并在正文开头插入可见的原子 Member Mention；
- **作者已暂离：** 保留引用但不插入失效 Mention，发送前要求用户明确选择新的可用接收者；
- **回复你的消息：** 只建立引用，不从历史收件人或回复关系猜测 Agent；
- **已有多人 Mention：** 展示完整收件人集合，避免“回复某人”掩盖实际 fanout；
- **发送瞬间失效：** 模拟 Snapshot 预检通过、Core 提交时拒绝的竞态；正文、附件意图和引用均保留，
  且绝不回退 Default Lead。

## 冻结边界

- `replyToCampMessageId` 只表达同 Camp 公共引用边；接收者只从 Core-owned Structured Content 派生；
- 回复目标随 Camp Composer Draft 持久化，导航、重启和发送失败不能让 Mention 与引用分叉；
- 已经不可接收的原作者不会被自动写成失效 Mention；
- Core 的 `mention_target_unavailable` 继续是最终竞态权威，Renderer 必须转成原位、可恢复的选择状态；
- 取消引用只移除引用意图，不偷偷删除正文中可见的 Mention；
- 乐观消息没有稳定 ID，不提供回复入口；
- Composer reply dock 与时间线父引用均把作者和摘要放在同一个可视行，超出宽度显示省略号；
- 鼠标点击“回复”仍把光标送进正文编辑器，但不改变 Composer 的边框或阴影；键盘激活与 Tab 导航
  继续显示局部 `focus-visible` 提示；
- 时间线只显示一层紧凑父引用，不创建缩进聊天树。

## 文件

- `index.html`：自包含的 Day/Night 交互稿；
- `PROJECT_DESIGN.md`：交互、状态和生产映射设计输入。
