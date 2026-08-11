---
document_type: version-overview
version: v0.56
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-11
---

# Rovai-ai v0.56：Neutral Porcelain + Steel Renderer

> 当前状态：生产实现、自动化门禁、macOS arm64 本地包和多尺寸真实 App 验收已经完成。本版本在不改变
> Core、Runtime、持久化或既有产品功能的前提下，把生产 App 的日间表面统一为 Neutral
> Porcelain + Steel，并收敛导航、会话、设置、队员、记忆与浮层的视觉层级。
>
> 前置版本：[v0.55 Agent 级连续执行过程](../v0.55/README.md)
>
> 后续版本：[v0.57 可恢复的项目侧栏移除](../v0.57/README.md)

## 版本目标

把一次性 P2 HTML 选型中确认的瓷灰底、Steel 强调和克制分隔迁移到现有 React Renderer，
而不是把原型假数据或演示交互复制进产品。现有 Camp、Project、New Conversation、Agent
执行过程、Task、Approval、队员、Memory 与七个设置分类继续读取原生产 Read Side，并保留
各自原有写入、恢复和安全边界。

## 交付范围

- 全局 Day Token 切换到 Neutral Porcelain + Steel：冷瓷灰 Canvas、近白 Surface、Steel
  品牌色、可辨识结构线和低频 Steel wash；状态色、队员身份色与证据色继续语义分离；
- 普通导航保留文件夹式 Project、项目级 `＋`、三点菜单、置顶、分页和 Quick Chat 投影；
  Project 主行本身承担展开/折叠且不显示独立箭头，当前项目使用稳定瓷灰底色；
- Camp 会话保留 v0.55 Agent 级执行过程。用户与所有 Agent 消息同向左对齐；不同 Agent
  不使用不同整块会话底色，身份色只进入头像与名称。A2A footer 显示“发送给@队员”，其中
  `@队员` 使用飞书式蓝色 Mention，并在身份仍可用时打开既有人物信息卡；
- Composer 在 2K 宽窗口扩展到 1040px；可见 `Enter` 提示紧邻发送按钮。日期只从权威
  时间戳和 Camp 创建时间本地化派生，不显示原型中的“今天 · 发布准备”等不可取得阶段字段；
- 七个设置分类、队员、记忆、通知 Drawer 与通用 Dialog 使用同一 Porcelain 页面表面和
  Steel 顶边/标题轨/选中态；语义 attention、danger、success 和 evidence 表面不被品牌色覆盖；
- 队员页继续保留受控半身 portrait、圆形 icon、Presence 与 Runtime 两个状态维度；Header
  中“在队”为静态状态，“{Runtime} 可用 →”具有清晰可点击性并进入现有运行配置；
- 创建新对话 Dialog 保留工作目录选择、安全校验、动态 Git 能力、队员与 Lead、可选名称、
  提交恢复和原子 Active Camp Creation；不新增原型式“创建摘要”区或黄色静态提示。

## 冻结边界

- P2 HTML 与一次性静态原型只作为视觉选型输入，不成为生产 source、数据真源或交互合同；
- 不改变 v0.55 的 Agent 聚合 RunPulse/ExecutionDrawer、Inspector 三 Tab、Approval Dock、
  CampTurn Stop、Task compact 卡或 Message Delivery 底层事实；
- 不增加 Project 领域实体、折叠按钮、会话阶段字段、角色专属消息底色、创建摘要、假 Runtime
  状态或假设置能力；
- 不改变 ThemePreference 类型；`system | day | night` 当前仍统一解析为日间，Night 继续等待
  独立设计；
- 不改变队员头像资产、Memory authority、Runtime 配置、MCP/Skill、Diagnostics 或 Notification
  的领域与安全合同。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.55 已冻结为 historical，v0.56 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 确认无需更新 | 本版本只调整 Renderer Token、视觉层级和既有交互呈现，不产生新的跨版本领域、持久化或高成本架构决定 |
| Contracts | 确认无需更新 | 不改变 wire shape、IPC、Envelope、错误、幂等、Message Delivery 或 Run Process Detail Surface v2 |
| Architecture | 确认无需更新 | 不改变组件职责、进程、传输、真源或安全边界；现有 Renderer 继续消费相同 Read Side |
| UI | 已更新 | UI 索引与详规已切换到 Neutral Porcelain + Steel，并记录导航、会话、设置、队员、记忆与浮层合同 |
| Runtime Activity | 确认无需更新 | Canonical Runtime Activity、Evidence 分类、Adapter coverage 与执行过程投影边界均不变 |
| Runtime compatibility | 确认无需更新 | 不改变支持的 Product Runtime、版本要求、能力或实测兼容性结论 |
| Documentation routing | 已更新 | 文档导航、版本索引与 UI 入口均指向 v0.56 当前视觉规范和验收计划 |
| Root README | 确认无需更新 | 项目定位、常青能力与支持范围不变；根 README 不记录版本局部视觉迁移 |

## References

- [v0.56 实施与验收计划](implementation-plan.md)
- [Neutral Porcelain + Steel UI 详规](../../ui/arctic-dawn.md)
- [UI 规范索引](../../ui/README.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)
- [Run Process Detail Surface v2](../../contracts/run-process-detail-surface-v2.md)
