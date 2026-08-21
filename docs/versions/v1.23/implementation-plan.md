---
document_type: implementation-plan
version: v1.23
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-21
---

# v1.23 按需 Built-in CLI Help 与 Charter 精简实施验收计划

## 1. 模型上下文确认门禁

- [x] 记录同一 Native Session 的两个 AgentRun 重复执行 root/send help 的证据；
- [x] 按最新 `origin/main@ef2eab5d` 重建完整前后文本、版本轴、兼容策略与验证矩阵；
- [x] 开发者阅读完整 revision 3 后二次确认；
- [x] 确认记录与 `pnpm docs:check` 通过后才修改实现或当前权威。

## 2. Charter、CLI 与兼容边界

- [x] 替换 Session Charter resource 中的 Principal、catalog、progressive-help 与 `--to-principal` 四处文案；
- [x] 保持当前 `rovai --help` 的 Agent/User Automation 分层输出不变；
- [x] Built-in Tool Transport、CLI command 与 Runtime capability 原子提升到 v20；
- [x] Native Binding context contract 加入内部 `sessionCharterRevision: 2`；
- [x] 保持十五项 operation、Send v12、Bootstrap/Context/Manifest/Profile 与数据合同不变。

## 3. 当前权威与测试

- [x] 接受 Built-in Tool Transport v20 并更新 Contract/Architecture/Documentation routing；
- [x] 更新 Charter、Binding digest、transport 与 smoke golden，并断言所有被替换旧句不存在；
- [x] 运行 Rust PR gate、Clippy、文档和 Desktop build；
- [x] 构建 macOS App，验证签名、架构、内置 `rovai --help` 与 `rovai app --help`；
- [ ] 隔离验收后安装到规范路径，提交并 fast-forward push 到 `main`。

## References

- [v1.23 版本概览](README.md)
- [模型上下文变更 revision 3](model-context-change-cli-help-reuse.md)
- [Built-in Tool Transport v20](../../contracts/builtin-tool-transport-v20.md)
