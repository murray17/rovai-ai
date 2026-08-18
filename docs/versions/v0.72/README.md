---
document_type: version-overview
version: v0.72
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.72：Camp 沉浸世界地图会话视图

> 当前状态：会话区双视图、2K 港湾地图、固定路网、真实/闲时双类播报、A2A 只读会合、
> 静态模式和既有执行台复用均已实现；自动化、打包 App 与多尺寸隔离验收完成。
>
> 前置版本：[v0.71 Notification Episode、Skill 管理与受控关闭终态收敛](../v0.71/README.md)
>
> 后续版本：[v0.73 在线长期记忆捕获与 Hearth 审核隔离](../v0.73/README.md)

## 版本目标

在现有 Camp 会话区内增加“常规会话 / 世界地图”双视图。世界地图使用固定地点与固定路网，让当前
Camp 队员以较慢、可停留、可复现的方式在地点之间移动，并把真实 AgentRun 活动压缩成地图上的短
播报。地图是同一 Camp Snapshot 的替代阅读投影，只提供存在感与协作叙事，不代表 Task 进度、
AgentRun 阶段或 Message Delivery 状态，也不向 Core、Runtime 或调度写回任何位置与移动事实。

本版本只改变会话阅读面。左侧菜单、Camp 顶栏、右侧 Inspector、Approval/Recovery Dock、Composer
与可上下拖动的 Agent 执行台保留现有结构和权威；打开地图不会创建第二套执行台、草稿、Task 或
会话状态。

## 交付范围

### 会话区双视图

- 在会话阅读面上提供紧凑的悬浮切换入口；不占用独立工具栏，不改变 Camp Header；
- 常规会话保持现有时间线、滚动位置、消息定位与复制行为；切换地图不清空 Draft、Inspector 选择、
  Approval、执行台焦点或运行中的真实数据更新；
- 世界地图使用项目提供的 2560×1440 港湾城市图；主画面保持完整宽高比，容器余量使用同图的低对比
  模糊背景承接。执行台上下拖动时地图按容器高度收缩，不要求固定窗口高度，也不产生整页横向滚动。

### 地点、路线与队员存在感

- 地点和路线是 Renderer 内部固定配置；路线顺着地图已确认的道路、桥梁和水路，不允许角色在视觉上
  直线穿山、穿林或跨河；
- 当前 Camp 中可呈现的活跃队员使用既有 `MemberAvatar`、显示名与稳定身份色，不把本机示例人物或
  绝对文件路径写入产品代码；
- 闲时队员按 Camp 与 Agent 稳定种子选择路线、慢速移动并在地点停留；等待或结果待确认状态保持静止；
- 地图位置、移动方向、路线高亮与会合动画均为瞬时 UI 投影，不持久化、不进入 Snapshot，也不触发
  AgentRun、A2A 或 Message Delivery。

### 真实执行与闲时播报

- 忙时气泡只读取当前 AgentRun 已有的真实 narration、plan 或 tool activity 摘要；长内容有界截断，
  没有证据时只显示诚实状态，不合成步骤、百分比或成功判断；
- 没有进行中任务时，可从预设的“任务 + 地点 + 动作 + 副词”词库生成闲时文案，且必须明确标注
  “闲时 · 环境预设”，不能伪装成 Runtime 输出；
- 真实执行文字继续随 Snapshot/Runtime event 更新；视觉切换、路线显隐、静态模式或 reduced motion
  都不能暂停、缓存或改写真实输出；
- 用户显式点击有执行过程的队员或忙时气泡时，复用现有 Agent 执行台并遵守既有精确 Run 选择规则；
  后台事件不得自动打开、切换或抢焦点。

### A2A 与静态模式

- A2A 只在已有 AgentRun / Message Delivery 事实足以识别双方时，选择双方当前视觉位置附近的合适
  固定地点并快速集结；视觉会合不表示投递完成、对方已接收或协作成功；
- 无可证明的双方事实、路线不可达或状态不适合时不制造会合；仍由现有会话与执行台展示权威证据；
- reduced motion 或地图静态模式停止角色移动、路线流光、脉冲和会合动画，但保留人物、地点、路线
  显隐状态和实时文字更新。

## 非目标与冻结边界

- 不新增或修改 Core 表、Migration、JSON-RPC、IPC、TypeScript wire contract 或 Runtime Activity 分类；
- 不把地图坐标、地点、路线、停留、会合或闲时文案写入领域模型；
- 不改变 Task、AgentRun、A2A、Message Delivery、Approval、Recovery、Stop 或 Planned Shutdown 语义；
- 不替换左侧导航、Inspector、Composer、执行台或现有 Porcelain Day / Steel Night 主题系统；
- 不引入新的 UI 框架、状态管理器、动画库、字体或图标系统；
- 不把交互稿中的演示控制、区域筛选、起终点选择或模拟执行输出带入生产。

## 发布门槛

1. 世界地图深模块只消费有界的 Renderer projection props；路线、随机移动、闲时文案和视觉会合留在
   模块内部，并有确定性单元测试；
2. 忙时播报测试证明正文来自真实 AgentRun activity，闲时播报有明确预设标签，等待状态不移动；
3. 切换视图、打开既有执行台、可拖动执行台压缩、Inspector 显隐、Draft/Approval 保留均有 Renderer
   回归覆盖；
4. Day/Night、1040×700、1440×920、2560×1440、200% zoom、reduced motion、键盘和长 CJK/emoji
   完成隔离 App 验收，且无整页横向溢出；
5. `pnpm typecheck`、相关 Vitest、Desktop build、文档治理和 Impeccable hardening detector 通过；
6. 版本文档只按可复现代码、测试和隔离 App 证据更新，不用交互稿或模拟内容声明生产完成。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.71 以 `implementation_status: complete` 冻结为 historical；v0.72 成为唯一 current，并新增概览与实施计划 |
| ADR | 确认无需更新 | 本版本是可逆的 Renderer 替代阅读投影，不改变 Task、AgentRun、A2A、Delivery、执行台或 Inspector 的长期权威边界 |
| Contracts | 确认无需更新 | 不新增字段、Envelope、receipt、幂等、错误、IPC 或投递语义；地图只消费既有 Snapshot 与 Runtime activity |
| Architecture | 确认无需更新 | 不改变进程、传输、持久化或 Core/Renderer 职责；地图实现为 CampWorkspace 内部的只读深模块 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)新增双视图、真实/预设播报、容器压缩与静态模式合同 |
| Runtime Activity | 确认无需更新 | 不新增 provider event、Canonical Activity、Evidence 或 classifier 映射，只压缩展示已有 activity |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime Adapter、Native Session、Built-in Transport 或受支持版本 |
| Documentation routing | 已更新 | 当前版本指针和版本索引切换到 v0.72；既有 Camp UI 路由继续指向同一组件合同 |
| Root README | 确认无需更新 | 产品定位、常青能力与 Runtime 支持范围不变，根 README 不记录版本局部视图 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [全局设计系统](../../../DESIGN.md)
- [Agent 级连续执行过程 ADR-0154](../v0.55/decisions.md#adr-0154)
- [聚焦 Inspector 与唯一 Approval Surface ADR-0160](../v0.58/decisions.md#adr-0160)
- [Core-owned Runtime Activity ADR-0111](../v0.41/decisions.md#adr-0111)
- [公共 A2A 与统一 Message Delivery ADR-0130](../v0.45/decisions.md#adr-0130)
