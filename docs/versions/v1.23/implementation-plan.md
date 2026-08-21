---
document_type: implementation-plan
version: v1.23
authority: implementation-and-acceptance-status
status: implemented
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
- [x] 隔离验收后安装到规范路径，提交并 fast-forward push 到 `main`。

## 4. 验证结论

- `pnpm test` 通过：71 个 Vitest 文件 / 485 项测试，以及 189 项 Node 测试全部通过；TypeScript typecheck、
  `cargo fmt --all --check`、workspace Clippy、Desktop production build 和三类文档门禁通过；
- Rust CLI 20 项、slow suite 273 项全部通过；全量 lib 与 staged route 均为 298 项通过、1 项既有
  `runtime-compatibility.md` frozen digest 基线失败，和 v1.20/v1.22 已记录结果一致，本版不吸收独立修复；
- `pnpm package:mac` 成功；App、Core、CLI 深度/独立验签通过，三枚二进制均为 arm64，包内 CLI 报告
  `contract-v20 ipc-v2`；根 `--help` 与 `app --help` 各验证一次并保持确认合同；
- 打包 App 使用一次性隔离 `userData` 启动，`rovai app status --json` 返回 `appRunning=true`、
  `authorized=true`、Automation contract 1，随后受控退出且 Core shutdown 完成；
- 产物已安装到 `/Applications/Rovai AI.app`，安装版 User Automation 再次连通，并确认 App/Core 进程均从
  规范安装路径运行；旧 v19 App 备份保留在
  `/Applications/Rovai AI.backup-v1.22-before-v1.23-20260821-195957.app`；
- 实现提交 `3b8902fa` 已 fast-forward 同步到 `origin/main`。

## References

- [v1.23 版本概览](README.md)
- [模型上下文变更 revision 3](model-context-change-cli-help-reuse.md)
- [Built-in Tool Transport v20](../../contracts/builtin-tool-transport-v20.md)
