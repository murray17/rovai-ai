---
document_type: contract
contract: runtime-images
version: v3
status: accepted
source_version: v1.37
last_updated: 2026-09-01
---

# Runtime Images v3

v3 继承 [v2](runtime-images-v2.md) 的结构化来源、混合存储、限额、Run fence、Camp-scoped 读取和
不自动发送规则，仅替代其允许 Runtime 图与显式附件重复展示的条款，并统一两种图片的布局。
不新增 Migration、字段、事件、模型 Context 或渠道行为；[Camp Open v12](camp-open-projection-v12.md)
的 Snapshot/Open wire shape 和版本保持不变，图片集合采用下述展示过滤。

## 已发送图片优先展示

Core 读取 Camp 图片元数据时，仅在以下条件全部成立时省略一张 Runtime supplement：

- 图片保存于 ManagedBlob，具有不可变内容 SHA-256；
- 同一 Camp 内存在 `sourceAgentRunId` 等于该图片 `agentRunId` 的 Agent 消息，且消息未 tombstone；
- 消息已经引用 `kind=file`、`previewKind=image`、`state=available` 的 Managed Attachment；
- 附件 `contentDigest` 与 Blob 的 SHA-256 完全相同。

保留显式消息附件及其原有顺序、操作和投递。过滤只影响展示集合，不删除 AgentRunImage、Blob、
附件或消息，也不改变重放键、图片读取授权和 GC root。附件不可用或消息被删除后，下一次读取
重新保留 Runtime supplement；不同 Run、不同 bytes 和没有来源 Run 的附件不能触发过滤。

只查询已有 SQLite 元数据，不解析 `send` 命令，不按文件名/尺寸或视觉相似性猜测，不读取文件重新
计算摘要。稳定路径是可变引用，不参与此过滤；其零拷贝和读取当前内容的规则不变。

## 同一套图片呈现

Tool/Runtime 图片与发送图片继续复用同一个 Gallery、Tile、decoder 和 Lightbox，且共用会话消息的
内容列、宽度限制和响应式布局。图片区域不能跟随正文长度收缩。

- 一张单列，多张双列，窄内容列单列；全部展示，不改变附件顺序。
- 图片按原比例显示，预览框贴合图片；保留 `contain` 和高度上限，不使用固定宽高补出黑边，
  不裁切、拉伸、重编码或修改原图。大图窗口同样贴合图片，关闭控件覆盖在图片角落，不保留标题留白。
- 两种来源的圆角、细边框、间距和焦点样式一致；颜色继续使用现有主题 token。
- 图片周围不显示文件名、来源/数量标题（如“运行图片 · 1”）、Runtime projection 说明或附件菜单；
  不提供系统打开、显示所在位置、右键菜单或解码失败后的系统打开回退。普通非图片附件的操作不变。
- 仅保留点击/键盘查看大图与关闭；文件名可用于图片的可访问名称，Dialog 标题仅供辅助技术读取。
  首次冷读显示加载占位，失败显示“图片已不可用”并禁用点击；不影响其他图片和 AgentRun。关闭后恢复焦点。
- Renderer 进程可按实际 Blob 大小缓存最多 128 MiB 已成功解码的 payload；每个 Tile 独立拥有并释放
  Object URL，缓存淘汰只删除 payload。缓存命中的消息附件不再读取；任意 Runtime 图片先显示缓存，
  再后台调用既有读取接口。请求异常保留旧图；正常返回 `null` 或候选内容解码失败时清除缓存并显示不可用；
  成功候选完成真实解码后再替换旧图。缓存不持久化，不改变稳定路径读取当前内容的规则，也不承诺浏览器
  不会重新执行内部解码。

这只是本地呈现修正，不自动向飞书或钉钉发送 Runtime 图片。

## 与公开消息同步呈现

来源 AgentRun 仍为 `queued`、`running` 或 `waiting` 且尚无公开消息时，Renderer 不得把 Runtime 图片
作为无作者节点提前插入会话 Timeline。公开消息出现后，图片与该 Run 最后一条公开消息一起进入 Timeline；
同摘要显式附件仍按前述规则优先。只有来源 Run 已为 `succeeded`、`failed` 或 `cancelled` 且仍无公开消息时，
才显示按图片时间定位的独立兜底。缺失来源 Run 不能被当作终态证明。
