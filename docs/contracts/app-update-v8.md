---
document_type: interface-contract
contract: app-update
version: 8
status: accepted
authority: app-update-release-notes-language-selection
source_version: v1.72
last_updated: 2026-10-29
---

# App Update v8 Contract

继承 [v7](app-update-v7.md) 的 API、发布原文、语言边界、非空准入、回退、定义保留和更新行为。
仅替换显示副本的原始 HTML 处理：统一使用 SafeMarkdown 的 rehype-raw → rehype-sanitize 默认
schema，允许的标签正常渲染，注释和危险内容按库默认规则处理。代码和转义内容保持字面值。

取消 rawHtmlPolicy 调用分支；选中语言与全文回退使用同一渲染流程。
语言元数据仍不可见，原有发布/语言分段的非空检查保持，不修改更新日志解析器、快照或源字节。
