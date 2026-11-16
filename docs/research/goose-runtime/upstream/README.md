---
document_type: research-record
authority: non-normative-runtime-evidence
last_updated: 2026-11-15
---

# Goose 1.59.0 stdio 初始化等待局部补丁

基线为官方 5d03ef6ed07ba59826328f1aff18d9a754ff8ad2。
[补丁](stdio-initialization-timeout.patch)仅修改原生 `extension_manager/stdio.rs`：
初始化握手及其失败后的 stderr 收尾共用既有 `ctx.timeout`，超时返回该扩展的 setup error。
不改变工具发现／加载结构，不添加轮询、缓存、文件机制或新的超时配置。

官方 1.59.0 失联 MCP 的两类结果必须分开：直接退出能隔离失败并完成 load/prompt；
完全不回应初始化，即使该扩展已设置 1 秒 timeout，原生 load 仍超出测试客户端期限。
该问题发生在 Rovai 撤回之前，不能靠软性 remove 或提前 remove 解释为已解决。

局部源码验收构建使用 `--no-default-features --features rustls-tls,bundled-mcp`，
只验证 stdio 失败边界，不代表官方完整功能发行包，也不提升 Rovai 资格。
在 Rovai 根目录使用新建隔离 fixture 运行：

```bash
ROVAI_GOOSE_BIN=/absolute/patched/goose \
ROVAI_GOOSE_PROBE_SCOPE=mcp-startup \
ROVAI_GOOSE_EXPECT_BOUNDED_MCP_LOAD=1 \
node scripts/probe-goose-runtime.mjs
```

验收要求 load/prompt 成功、失败项由原生结果报告、无响应子进程退出。
这份补丁不由 Rovai 启动器自动应用，也不覆盖用户的 Homebrew CLI 或配置。
未把本地补丁当成已经发布的官方修复。

补丁沿用原生扩展 timeout，默认值仍为 300 秒；Rovai 既有 session/load 期限为 30 秒。
未配置较短的扩展超时时，Rovai 的恢复期限仍可能先到。本轮只证明配置 1 秒时的失败隔离和后继任务，
没有擅自缩短所有 MCP 的工具调用期限，也不把默认配置的恢复成功列为已验证。
