---
document_type: version-overview
version: v1.09
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.09：当前会话精确查找

> 当前状态：实现与验收完成。
>
> 前置版本：[v1.08 取消 Run 的活动停止投影](../v1.08/README.md)。v1.08 以 `complete`
> 冻结；本版不改写其 Renderer Activity 展示结论。

## 版本目标

为 Desktop Camp 会话提供系统查找习惯一致的 `Command/Ctrl+F`：查找当前 Camp 完整历史中的公开
user/agent 消息正文，精确显示总数并循环定位。未加载的较早命中通过有界锚点窗口按需进入时间线，不能
扩大 Camp 首屏投影，也不能把附件、Task、Tool output、Inspector 或系统消息混入结果。

## 交付范围

- 新增 Renderer-facing `camp.messages.find` 精确读接口，只返回总数与一个选中命中；
- 搜索 Unicode scalar 正文投影，大小写不敏感、非重叠计数，支持稳定前后循环；
- 复用 `camp.messages.around` 加载屏幕外或未加载的命中窗口；
- Camp 会话面以紧凑悬浮条承载输入、计数、前后定位、重试与关闭；
- `Enter` / `Shift+Enter` 前后定位，`Esc` 关闭并恢复打开前焦点与阅读位置；
- 地图状态按 `Command/Ctrl+F` 自动切回会话并打开查找；
- Members、Memory、Settings、Quick Chat 等非 Camp 页面不注册该会话查找快捷键；
- Day/Night 使用独立语义高亮 token，当前命中同时提供非颜色提示和可访问结果播报。

## 明确不做

- 不修改 Agent-facing `camp.search`、`camp.read` 或 `history.search` 的 Top-K/授权语义；
- 不建立新的 FTS 索引、Migration、全文缓存或跨 Camp 查找；
- 不搜索附件名称/内容、Task、Run/Tool output、Approval、Inspector、地图文案或系统消息；
- 不把完整命中列表或完整 Camp 历史一次性送入 Renderer；
- 不在非 Camp 一级页面劫持浏览器/系统查找快捷键。

## 验收结论

- Core 与 Contract 测试证明精确总数、大小写、Unicode scalar、非重叠、anchor、wrap 与公开正文排除边界；
- 打包 App 以 65 条消息和 4 个公开正文命中验证完整历史，未加载的较早命中通过有界 around-window 进入时间线；
- 同一条超长消息的首尾命中均以精确文字 Range 定位到悬浮查找条之外的安全可视区，无需再次手动滚动；
- `1440×920` Day 与 `1040×700` Night/reduced-motion 均无查找条重叠或横向溢出；
- 真实键盘验收覆盖 Enter/Shift+Enter、Esc anchor/focus 恢复、地图按钮焦点、地图 `Command+F` 返回会话与非 Camp 页面边界；
- Impeccable finish review 结论为 `ship`；fresh documenter 确认稳定规则已进入局部 UI、Theme、Contract 与版本文档，根 `DESIGN.md` 无需改变。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.08 以 `complete` 冻结为 historical；本概览、计划与版本索引建立唯一 current v1.09。 |
| ADR | 确认无需更新 | 该功能是既有 SQLite Read Side、Camp Workspace 与 anchored read 的可逆局部扩展，不改变跨版本权威决定；ADR-0013 与 ADR-0108 的既有边界保持。 |
| Contracts | 已更新 | [Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md) 固定 Renderer 精确读 wire、正文范围、offset、错误与有界响应。 |
| Architecture | 已更新 | [Camp Open Read Path](../../architecture/camp-open-read-path.md) 增加完整会话查找与 around-window 定位职责，不扩大 open projection。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)与 Day/Night 主题固定快捷键、状态、恢复和高亮合同。 |
| Runtime Activity | 确认无需更新 | 查找不读取或改变 Runtime Activity mapping、证据或展示分类。 |
| Runtime compatibility | 确认无需更新 | 未改变 Runtime 启动、协议、能力或任何实测版本结论。 |
| Documentation routing | 已更新 | 文档导航、版本索引、Contract 与 Architecture 索引提供当前会话查找入口。 |
| Root README | 确认无需更新 | 局部会话交互不改变项目定位、常青能力说明或支持范围。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0108](../../adr/0108-discovery-only-camp-message-search-and-sequence-paged-reads.md)
