---
document_type: version-decisions
version: v1.37
lifecycle: current
last_updated: 2026-08-31
---

# v1.37 决定

<a id="v1-37-d01"></a>
## V1.37-D01：Runtime 图片采用结构化来源与混合生命周期，不升级为文件发布

### 背景

稳定 Runtime 图片路径可直接使用，但本机 Run 临时目录必然清理；有些 Runtime 同时返回 bytes 与 path。
把所有图片转成消息附件会混淆中间结果和显式交付，并把本机可视化带到飞书；把所有路径复制或新增目录授权
又会显著扩大实现和交互。用户明确要求可用性优先、最小验证及不限制目录/符号链接。

### 决定

只接收已适配的结构化结果。稳定路径引用原文件，inline bytes 始终保存，仅 Run 临时路径为生命周期保存到
现有 Blob。普通文件检查与真实解码构成最小读取链；失败局部降级。图片拥有独立 Run 元数据，不自动产生
CampMessage/Attachment/渠道投递。当前规范由 [Runtime 图片架构](../../architecture/runtime-images.md)与
[Runtime Images v2](../../contracts/runtime-images-v2.md) 拥有。

### 后果与替代方案

- 保留零拷贝意味着稳定文件修改/删除会改变或失去预览，这是接受的取舍，不承诺历史 bytes 不变。
- 拒绝路径一律优先：会丢失已有 inline bytes，且临时文件清理后不可恢复。
- 拒绝全部复制：稳定文件无需额外副本；拒绝全不保存：Run 临时结果会必然丢失。
- 拒绝自动 Attachment/文件预览授权框架：图片观察不是交付，扩大领域状态与交互不解决本次问题。
