---
document_type: contract
contract: file-preview
version: 21
status: accepted
authority: desktop-file-preview-wire
source_version: v1.72
last_updated: 2026-10-03
---

# File Preview v21

继承 [v20](file-preview-v20.md) 的文件来源、读取能力和预览行为。本版补齐 HTML 内部 HTTP 诊断请求的
CSP 归因与降级；不改变作者 HTML、安全策略、文件访问范围或预览来源隔离。

## 内部策略拒绝

仅当浏览器产生的可信、实际执行拦截的 `securitypolicyviolation` 同时满足以下条件，桥接器才将其
归因为自身辅助功能：

- 当前文档已经启动 HTTP 资源诊断，且不是无该诊断流的 Web 静态壳；
- 生效指令为 `connect-src`，被阻止 URL 精确等于当前预览 origin 下的
  `/__rovai-preview/events?documentId=<当前文档 ID>`；
- 请求来源精确等于本次同步加载、捕获的注入桥接脚本 URL。

来源缺失、不符、其他文档、其他 URL、仅报告策略或非可信事件均不通过该归因；沿用原有问题采集。
作者自己的请求即使使用相同诊断 URL，也不得仅凭地址被过滤。

已确认的内部策略拒绝只更新 HTTP 诊断不可用状态，不进入作品诊断列表，不增加问题数，不标记页面资源失败。
作者的脚本、Promise、资源和业务请求策略错误继续记录。不得删除、改写 CSP 或绕过浏览器安全检查。

## 状态与生命周期

沿用既有受校验的 source/origin/previewId/generation/connectionId/documentId 通道，扩展可选原因：

```ts
{ type: 'server-diagnostics', state: 'waiting' | 'connected' | 'unavailable', reason?: 'policy' }
```

`reason: 'policy'` 仅在已确认内部 CSP 拒绝的 `unavailable` 状态中有效。缺少或未知原因仍使用通用不可用提示；
恢复为 waiting/connected 时清除原因。宿主拒绝旧文档状态，同页重复握手保留已确认原因，新文档独立初始化。
诊断不可用仅通过默认折叠的中性详情说明，不宣称检查全部通过；文案由[文件预览区](../ui/components/file-preview.md#html-运行反馈)拥有。

明确策略拒绝停止当前文档的诊断请求与待执行退避，包括 fetch 已拒绝后才到达的 CSP 事件。
停止只作用于诊断支路，不取消页面消息、错误监听、查找、滚动或已确认的加载状态；同页握手不重启已停止的流。
临时断连保留 v14 的有限恢复与额度，关闭、离开或淘汰释放请求和计时器，新文档重新判断。

## 验收

真实浏览器保持原 `connect-src 'none'`，确认内部拦截事件不进入作品列表、诊断默认折叠且页面输入、交互、
滚动和文档实例保留。浏览器侧记录覆盖原退避周期，证明明确策略拒绝后没有重复尝试；仅统计服务端请求不足以证明。
混合错误页同时保留作者脚本错误、缺失资源、业务 CSP 错误及作者主动请求相同诊断地址的错误。
临时断流恢复、重复握手、关闭和跨文档导航继续覆盖原有状态与资源释放不变量。
