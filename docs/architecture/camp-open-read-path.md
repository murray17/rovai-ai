---
document_type: architecture
architecture: camp-open-read-path
authority: desktop-camp-enter-and-progressive-read-boundaries
status: accepted
last_updated: 2026-08-15
---

# Camp Open Read Path 架构

字段与窗口见 [Camp Open Projection v1](../contracts/camp-open-projection-v1.md)。本架构把“进入会话”、
“继续阅读”和“检查运行详情”分成三个用途明确的接口，同时保持 SQLite Read Side 为唯一权威。

## Component authority

| Component | Responsibility |
| --- | --- |
| Main Window Session | 只冻结并返回本地恢复目标与设置位置；不等待 Core，也不保证目标领域数据已经加载 |
| Renderer startup controller | 快照返回后立即显示候选目标的一级页面框架；候选 Camp 与 committed active Camp 分离，只有 enter 成功才提交权威 Camp 内容 |
| Renderer enter controller | 生成 trace/command ID、selection generation 与 high-water fence；应用内缓存未命中时保留当前 surface，投影到达后原子 commit 目标 Camp/项目并完成 meaningful paint，再恢复项目导航、确认可见来源和刷新侧栏 |
| Electron Main bridge | allowlist typed method、记录不含内容的 IPC roundtrip/response bytes；不组装或缓存领域投影 |
| Core Camp enter module | 在一次串行 request 中顺序执行 Default Lead reconcile 与 post-reconcile read；rejected 时 fail closed |
| Core Camp open read model | 在单一 SQLite transaction 中组装有界首屏投影、coverage 与 high-water；不加载 Context Manifest/Action history |
| Camp message history read | 以 stable sequence cursor 读取 earlier page；不回放 event 构造第二真源 |
| Run detail read | 在用户展开指定 Run 后复用 Evidence page/content 接口；不扩大普通 Camp open payload |
| Full Camp snapshot | 兼容、诊断与定向测试面；保持纯读，但不服务普通 open/refresh |

## Enter and refresh flow

```text
app click / notification target
  -> Renderer camps.enter(traceId, commandId, campId)
  -> cache miss keeps the current surface; no target route is committed yet
  -> Core serialized reconcile
  -> Core bounded read transaction + throughGlobalSequence
  -> Main parses typed response
  -> Renderer atomically commits target Camp ID + project + recent Camp surface
  -> next meaningful paint
  -> background project restore / campViewed / navigation refresh

cold startup
  -> Main Window Session returns a frozen local target
  -> Renderer paints the target route shell and removes the global StartupGate
  -> Renderer queues camps.enter ahead of Overview/preferences/runtime health
  -> Core reconcile + bounded projection
  -> Renderer commits active Camp + meaningful content
  -> background navigation / campViewed / project restore

Core event invalidates active Camp
  -> coalesced Renderer camps.open(traceId, campId)
  -> accept only non-regressing high-water
  -> preserve explicitly loaded earlier message pages
```

缓存只保存最近的有界投影。cache hit 可立即恢复阅读面，但仍由 high-water refresh 验证；cache miss 不把
当前 Snapshot 清空，也不提前切换 route。普通请求在 400 ms 内不呈现 loading，超过预算只在目标导航行
显示非阻塞进度。schema mismatch、Core restart、Camp mismatch 或 sequence regression 使缓存失效。
Renderer 不通过 event replay 补齐权威对象。

冷启动 route shell 只证明恢复目标已确定，不证明 Camp 存在或 Default Lead 已 reconcile。它不得设置
`activeCampId`、触发 `campViewed`、提交下次恢复位置或启用 Notification navigation。Camp、Members 与
Memory 分别拥有局部 loading/error；全屏 StartupGate 只允许覆盖 Main Window Session 本地快照读取失败。

## Failure boundaries

- enter reconcile/read 失败：保留原 surface 并显示非阻塞错误，不展示未 reconcile 的新 Camp；
- 冷启动 enter 失败：调用一次 `camps.exists`；只有明确为 false 才回到 Quick Chat，true 或存在性检查失败
  都保留候选 shell 并允许重试，不分页扫描 Navigation groups；
- 首屏后项目导航恢复失败：已打开 Camp 保持可用，在导航 surface 报错，不回退快速对话；
- earlier page 失败：保留已加载消息和滚动位置，原位允许重试；
- detail 失败：只影响对应 Drawer/Inspector，不覆盖会话与 Draft；
- 快速 A→B 切换：旧 generation、旧 Camp 或倒退 high-water 响应一律丢弃。

## References

- [ADR-0013](../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0058](../adr/0058-collaboration-v4-presence-aware-admission.md)
- [Camp Open Projection v1](../contracts/camp-open-projection-v1.md)
