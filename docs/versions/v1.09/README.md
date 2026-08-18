---
document_type: version-overview
version: v1.09
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-19
---

# Rovai-ai v1.09：完整会话查找、Mode-aware CLI 与 Tool 结果交互

> 当前状态：两组方案均已完整实现；合并后的单一 v1.09 产物已通过集成门禁与打包版隔离验收。
>
> 前置版本：[v1.08 取消 Run 的活动停止投影](../v1.08/README.md)。v1.08 以 `complete`
> 冻结；本版不改写其 Renderer Activity 展示结论。
>
> 后续版本：[v1.10 Claude Code 与 Antigravity 的安全公开 Runtime 失败](../v1.10/README.md)。

## 版本目标

本版同时补齐两个 Camp 阅读面：Desktop 会话提供符合系统习惯的 `Command/Ctrl+F`，精确查找当前 Camp
完整公开正文并按需定位未加载命中；Built-in CLI 则不再把 `camp.read` 四分支联合输入拍平成误导性的
参数表，并让执行台完整保留 Tool chronology、原位展开与复制 `camp.read/search` 公共结果。

## 交付范围

### 当前会话精确查找

- 新增 Renderer-facing `camp.messages.find` 精确读接口，只返回总数与一个选中命中；
- 搜索 Unicode scalar 正文投影，大小写不敏感、非重叠计数，支持稳定前后循环；
- 复用 `camp.messages.around` 加载屏幕外或未加载的命中窗口，不扩大 Camp 首屏投影；
- Camp 会话面以紧凑悬浮条承载输入、计数、前后定位、重试与关闭；
- `Enter` / `Shift+Enter` 前后定位，`Esc` 关闭并恢复打开前焦点与阅读位置；
- 地图状态按 `Command/Ctrl+F` 自动切回会话；非 Camp 页面不注册该会话查找快捷键；
- Day/Night 使用独立语义高亮 token，当前命中同时提供非颜色提示和可访问结果播报。

### CLI help 与 Tool 结果

- exact operation help 从 canonical `inputSchema.oneOf` 识别稳定 discriminator，保持 Schema 分支顺序；
- `camp.read --help` 按 item / around / thread / timeline 展示各自 required、optional、const、enum、数值与
  长度约束、CLI flag、JSON field 和独立示例，`campId` 只显示一次 common optional；
- direct flags 继续先由 flattened argument map 构造完整对象，参数顺序任意；direct、JSON stdin/heredoc 与
  `--input-file` 随后共用 canonical Schema validator；
- 本地 schema failure 在 IPC 前返回 `builtin_tool.invalid_input + fix_input`，最多 4 条安全、稳定排序的
  字段 issue，不回显用户正文、文件路径、Schema path、IPC/lease 或凭据；
- 不接受或改写 older/newer/backward/forward，不补 direction 默认值，不把 `cursor=0` 当成未传；
- 删除 Renderer `steps.slice(-12)`，完整保留已读取的 Tool chronology，不增加“较早 N 项”；
- Built-in `camp.read/search` 从 Core 公共 result/error 形成可展开 Tool 详情；
- 长结果仍有界预览，完整复制入口只存在于当前展开结果内；删除 standalone“查看完整工具调用”和 raw
  Envelope 展示。

## 明确不做

- 不修改 Agent-facing `camp.search`、`camp.read` 或 `history.search` 的 Top-K、Camp 授权、Manifest fence、
  read service 或 cursor 分页语义；
- 不建立新的 FTS 索引、Migration、全文缓存或跨 Camp Desktop 查找；
- Desktop 查找不搜索附件、Task、Run/Tool output、Approval、Inspector、地图文案或系统消息；
- 不把完整命中列表或完整 Camp 历史一次性送入 Renderer，不在非 Camp 一级页面劫持系统查找快捷键；
- 不拆分四个新 CLI command，不要求 `--mode` 位于其他 flag 之前，不放宽 `additionalProperties: false`；
- 不修改 Core 权威校验、Built-in Transport/Envelope/receipt/capability 版本；
- 不从 Runtime 文本、命令相似度或 Evidence 内容猜 Tool identity；
- 不增加独立 Rust 测试文件或重复同一失败语义的 `#[test]`；CLI 断言扩展既有 owner test；
- 不在本版实现 Tool chronology 的“较早 N 项”提示或虚拟化策略。

## 验收结论

- Core 与 Contract 测试证明会话查找的精确总数、大小写、Unicode scalar、非重叠、anchor、wrap 与公开
  正文排除边界；
- 打包 App 以 65 条消息和 4 个公开正文命中验证完整历史，未加载的较早命中通过有界 around-window
  进入时间线；
- 同一条超长消息的首尾命中均以精确文字 Range 定位到悬浮查找条之外的安全可视区，无需再次手动滚动；
- `1440×920` Day 与 `1040×700` Night/reduced-motion 均无查找条重叠或横向溢出；真实键盘验收覆盖
  Enter/Shift+Enter、Esc 恢复、地图按钮焦点、地图返回会话与非 Camp 页面边界；
- CLI help 分支、字段作用域、合法枚举、minimum/maximum 与四类示例均来自 canonical Schema；
- timeline 缺少 direction、非法同义词、误用 before、cursor=0 以及 JSON 输入均返回预期字段 issue；
- 15 个 Tool operation 的首尾均保留；`camp.read/search` 结果可展开，长结果只在原 Tool 行复制；
- Rust、TypeScript、Renderer、Desktop build、文档治理、macOS package、签名和隔离 App 验收通过；
- Impeccable finish review 结论为 `ship`；稳定规则已进入局部 UI、Theme、Contract 与版本文档，根
  `DESIGN.md` 无需改变。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.08 以 `complete` 冻结为 historical；本概览、计划与版本索引建立唯一 current v1.09。 |
| Decisions | 确认无需更新 | v1.09 未形成需要独立保留的重要版本决定；数字 ADR clean break 属于后续 v1.11 文档治理，不回写本历史版本。 |
| Contracts | 已更新 | [Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md)固定精确查找 wire；[Run Process Detail Surface v8](../../contracts/run-process-detail-surface-v8.md)固定完整 chronology、Built-in 公共结果和原位复制。 |
| Architecture | 已更新 | [Camp Open Read Path](../../architecture/camp-open-read-path.md)记录完整会话查找与 around-window；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)记录 union-aware help、统一 pre-IPC Schema validation 与安全字段 issue。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)和 Day/Night 主题记录查找、高亮、完整 Tool 顺序、Built-in disclosure 与移除 standalone raw Evidence。 |
| Runtime Activity | 确认无需更新 | 查找不读取 Runtime Activity；Tool 详情只消费既有公共字段，不改变 classifier、operation identity、phase/outcome、Evidence schema 或 registry mapping。 |
| Runtime compatibility | 确认无需更新 | Runtime 启动、协议、实测版本、capability、coverage 与平台资格结论均未变化。 |
| Documentation routing | 已更新 | 文档导航、版本、Contract、Architecture、ADR CURRENT 与 UI acceptance 提供本版两组当前入口。 |
| Root README | 确认无需更新 | 两组改动均为 Camp 阅读与执行详情修正，不改变项目定位、常青能力或支持范围。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md)
- [Run Process Detail Surface v8](../../contracts/run-process-detail-surface-v8.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [ADR-0013](../v0.06/decisions.md#adr-0013)
- [ADR-0108](../v0.40/decisions.md#adr-0108)
- [ADR-0166](../v0.65/decisions.md#adr-0166)
- [ADR-0111](../v0.41/decisions.md#adr-0111)
- [ADR-0112](../v0.41/decisions.md#adr-0112)
