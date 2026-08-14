---
document_type: architecture
architecture: camp-open-read-path
authority: desktop-camp-enter-and-progressive-read-boundaries
status: accepted
last_updated: 2026-08-14
---

# Camp Open Read Path 架构

字段与窗口见 [Camp Open Projection v1](../contracts/camp-open-projection-v1.md)。本架构把“进入会话”、
“继续阅读”和“检查运行详情”分成三个用途明确的接口，同时保持 SQLite Read Side 为唯一权威。

## Component authority

| Component | Responsibility |
| --- | --- |
| Renderer enter controller | 生成 trace/command ID、selection generation 与 high-water fence；先 commit 轻量投影并完成 meaningful paint，再恢复项目导航、确认可见来源和刷新侧栏 |
| Electron Main bridge | allowlist typed method、记录不含内容的 IPC roundtrip/response bytes；不组装或缓存领域投影 |
| Core Camp enter module | 在一次串行 request 中顺序执行 Default Lead reconcile 与 post-reconcile read；rejected 时 fail closed |
| Core Camp open read model | 在单一 SQLite transaction 中组装有界首屏投影、coverage 与 high-water；不加载 Context Manifest/Action history |
| Camp message history read | 以 stable sequence cursor 读取 earlier page；不回放 event 构造第二真源 |
| Run detail read | 在用户展开指定 Run 后复用 Evidence page/content 接口；不扩大普通 Camp open payload |
| Full Camp snapshot | 兼容、诊断与定向测试面；保持纯读，但不服务普通 open/refresh |

## Enter and refresh flow

```text
click / startup / notification target
  -> Renderer camps.enter(traceId, commandId, campId)
  -> Core serialized reconcile
  -> Core bounded read transaction + throughGlobalSequence
  -> Main parses typed response
  -> Renderer commits recent Camp surface
  -> next meaningful paint
  -> background project restore / campViewed / navigation refresh

Core event invalidates active Camp
  -> coalesced Renderer camps.open(traceId, campId)
  -> accept only non-regressing high-water
  -> preserve explicitly loaded earlier message pages
```

缓存只保存最近的有界投影。cache hit 可立即恢复阅读面，但仍由 high-water refresh 验证；schema mismatch、
Core restart、Camp mismatch 或 sequence regression 使缓存失效。Renderer 不通过 event replay 补齐权威对象。

## Failure boundaries

- enter reconcile/read 失败：保留原 surface 或显示可重试打开状态，不展示未 reconcile 的新 Camp；
- 首屏后项目导航恢复失败：已打开 Camp 保持可用，在导航 surface 报错，不回退快速对话；
- earlier page 失败：保留已加载消息和滚动位置，原位允许重试；
- detail 失败：只影响对应 Drawer/Inspector，不覆盖会话与 Draft；
- 快速 A→B 切换：旧 generation、旧 Camp 或倒退 high-water 响应一律丢弃。

## References

- [ADR-0013](../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0058](../adr/0058-collaboration-v4-presence-aware-admission.md)
- [Camp Open Projection v1](../contracts/camp-open-projection-v1.md)
