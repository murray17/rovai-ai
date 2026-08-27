---
document_type: ui-prototype-readme
status: review-draft
target_surface: camp-member-management
last_updated: 2026-08-25
---

# Camp 增减队员交互稿

这是 Camp 动态名册方案的独立 HTML 交互稿，用于在生产实现前比较三种成员操作入口，并评审当前会话中的添加、移出、
并发冲突、异步收敛、Runtime 展开和最后一位队员保护。它不替代 Core、Architecture、Contract、当前版本范围或生产
Renderer，也不证明相应能力已经实现。

## 查看

直接在浏览器打开 `index.html`，或从仓库根目录运行：

```text
python3 -m http.server 4173 --directory docs/prototypes/camp-member-management
```

然后访问 `http://127.0.0.1:4173/`。

## 可评审状态

- **普通名册：** 从 Camp Inspector 的“队员”页签添加或移出成员；
- **添加多人：** 复用现有新对话成员选择语言，按独立幂等命令顺序提交；
- **部分失败：** 已成功加入的人立即进入名册，失败项保留在 Dialog 内原位重试；
- **移出队长：** Core preview 明确下一任队长、Task、Run 与 Delivery/Gather 的实际变化；
- **移出无在途：** 没有实际影响时，确认框不显示 Run、Task、消息/Gather 空行；
- **版本冲突：** 保留 Dialog，并要求刷新权威影响后再次确认；
- **收敛中：** membership cutover 已生效，但 Run/Delivery 仍在可靠终态化；
- **成员操作菜单：** 可切换横向常显、竖向常显与行内渐显三种无框入口；菜单统一承载“查看/收起模型信息”和“移出当前会话”，Runtime 状态只作摘要；
- **条件式影响：** 只展示实际存在的执行、任务、消息/Gather 与队长变化，不展示“继续保留”；
- **仅一位队员：** 移出动作保持可见但不可执行，并明确说明会话至少保留 1 位队员。

原型顶部的场景条和主题按钮仅用于评审，不属于生产 Camp UI。

## 已确认的术语

- 普通用户只看到“添加队员”，不区分首次加入与底层 membership reactivation；
- Camp 级离开统一叫“移出当前会话”；
- Camp 始终至少保留一位队员，不提供零成员恢复路径；
- “永久移除”只用于全局 AgentProfile removal；
- “发送被受理”“收到停止请求”和“可靠终态已确认”保持三个不同事实。

## 文件

- `index.html`：自包含的 Day/Night 可点击原型；
- `PROJECT_DESIGN.md`：已确认的交互 brief 与生产映射。
