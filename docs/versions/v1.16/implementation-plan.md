---
document_type: implementation-plan
version: v1.16
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-20
---

# v1.16 Camp 纯附件消息实施与验收计划

## 1. 版本与长期权威

- [x] 冻结 v1.15，建立唯一 current v1.16 与 [V1.16-D01](decisions.md#v1-16-d01)；
- [x] 建立 Camp Composer Draft v3，并同步 Composer Architecture、基础不变量、UI 与文档路由；
- [x] 明确不新增 Migration，不升级 Context Formatter/Manifest/Profile/Run Facts。

## 2. Core 与事务

- [x] `load_structured_draft_submission` 在 body render 后读取 ordered ready Prepared Attachment IDs；
- [x] 只在正文和 ready 附件同时为空时返回 `camp_message.empty_body`；
- [x] 纯附件成功路径保存空 body/空 Structured Content，并原子消费附件、创建消息与 AgentRun；
- [x] 非 ready 附件、publication 失败和 consume 失败不留下 Message、Attachment、Turn 或 AgentRun 半状态。

## 3. Desktop 与 Timeline

- [x] submit guard、App guard 与按钮共享 sendable payload 判断；
- [x] preparing、failed、busy、submitting、Draft 缺失和 recipient repair 继续阻断；
- [x] 纯附件执行使用稳定非空 purpose，但不制造消息正文；
- [x] 纯附件时间线保留外壳、作者、时间、回复和附件卡，不渲染空正文气泡。

## 4. 验证与发布

- [x] Core 定向、slow integration、Renderer 与 Context 回归通过；
- [x] Rust fmt、Clippy、PR suite、TypeScript、Vitest、Desktop build 与文档门禁通过；
- [x] 从最新 main 复验并 fast-forward push；
- [x] 完成 macOS arm64 打包、签名/架构校验和 `/Applications` 非终止安装交接。

## References

- [v1.16 版本概览](README.md)
- [V1.16-D01](decisions.md#v1-16-d01)
- [Camp Composer Draft v3](../../contracts/camp-composer-draft-v3.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
