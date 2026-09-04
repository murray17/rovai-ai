---
document_type: contract
contract: runtime-images
version: v4
status: accepted
source_version: v1.39
last_updated: 2026-09-03
---

# Runtime Images v4

v4 inherits [v3](runtime-images-v3.md) 的结构化来源、混合存储、限额、Run/epoch fence、Camp-scoped
读取、同摘要显式附件优先、真实 decoder、128 MiB Renderer payload cache、Lightbox 与不自动发送规则。
本版只替代消息内部的展示分区、顺序和响应式几何；不增加字段、事件、Migration、模型 Context、渠道行为或
文件系统权限。[Camp Open Projection v14](camp-open-projection-v14.md) 的 Open schema 6、Snapshot 34 和
图片 metadata/read wire 均不变。

## 与公开消息合并

来源 Run 尚未公开发言且仍为非终态时继续保留图片；公开消息出现后，该 Run/epoch 的 Runtime 图片直接进入
最后一条公开 Agent 消息的图片区，不再生成独立的有作者外节点。只有来源 Run 已终态且仍无公开消息时，才按
图片时间显示独立兜底，并保持在同 Run 的 Files Changed 前。缺失来源 Run 不构成终态证据。

同一 Agent 消息按以下稳定顺序展示：

1. 正文；
2. 图片区；
3. 文件区。

显式 `previewKind=image` 附件先按附件原顺序进入图片区，过滤后的 Runtime 图片再按 Run projection 原顺序加入；
非图片附件按自身原顺序进入文件区。图片与文件必须使用两个独立容器，不因宽度充足而混排；空区域不产生
占位。同摘要过滤仍只省略 Runtime supplement，不删除任何底层记录。

## 作者感知图片几何

Agent 的显式图片附件与 Runtime 图片复用同一个 `agent-output` Gallery variant、Tile、真实 decoder、缓存和
Lightbox。单图保持原比例并限制最大宽度约 560px；多图使用 160–240px 响应式单元，只在图片区换行，窄容器
退化为单列。预览和大图使用 `contain`，不裁切、拉伸、重编码或补固定黑边。

用户消息的显式图片使用同一基础能力，但在正文前的独立 `user-attachment` variant 中显示 72×72px 圆角
缩略图；多图换行，缩略图允许 `cover`，Lightbox 仍完整显示原图。用户消息顺序为“图片区、文件区、正文”。
两种 variant 不能复制读取、decoder、cache 或 Lightbox owner。

所有图片区域仍不显示文件名、来源/数量标题、Runtime projection 文字或附件菜单，也不提供系统打开、显示位置
或解码失败后的系统回退。文件名只作为可访问名称和不可见 Dialog title。冷读、失败、缓存刷新、焦点恢复与
Object URL 生命周期完整继承 v3；解码失败仍显示“图片已不可用”并只禁用该 Tile。

## References

- [Runtime 图片架构](../architecture/runtime-images.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md#runtime-图片与消息图片)
- [Camp Attachment v7](camp-attachment-v7.md)
- [Camp Open Projection v14](camp-open-projection-v14.md)
