---
document_type: implementation-plan
version: v1.32
status: completed
last_updated: 2026-08-30
---

# 外部附件静默快照实施计划

基线：`3123e885e2ab54a64848646c485434658b6154de`。
工作分支：`rovai/send-external-snapshot`。

## 实施范围

1. 当前 lease context 增加绝对 executionRoot/runTmp，由 Core 当前 Run 生成，CLI 不从可覆盖环境变量推断。
2. CLI 仅处理非空 send files；保留相对路径的 executionRoot 语义。验证原始来源后再 canonical 分类，
   外部源按 request/ordinal 私有快照；成功前不发送 IPC，重试不重读原始文件。
3. 共用安全文件/目录复制、规范名称、no-follow、digest 与大小/节点限制；不改变 Core 两个合法根。
4. 预处理失败清理本次 owned staging；不确定 IPC 保留到 lease 清理；Run tmp 清理支持只读快照。
5. 映射安全且不含来源路径的 CLI 错误；更新已确认的帮助和三份新合同。

## Rust 测试准入

CLI 文件预处理是新的生产 seam；现有 CLI parser/IPC tests 不执行本地附件读取，不能拥有这组 filesystem cases。
以一个低成本临时目录 fixture 覆盖分类/排序、失败回滚、拒绝链接/特殊文件、大小限制，避免 SQLite fixture。
现有 lease owner 扩展 context roots 和只读树清理，现有 IPC owner 扩展同请求快照重试。
现有目录 digest/type/limit 和 Managed v2 持久化测试保留，不建立重复 golden。

评审补充：连接前失败与 dispatch 后无确认响应有不同的清理义务，新增同一 CLI seam 下的有界 socket
fixture 表驱动覆盖连接不存在、非 JSON、无效 UTF-8 和响应丢失；原有无附件 IPC owner 不能观察快照
生命周期，原有成功重试 owner 则继续只验证 request/bytes 不变。验证入口为 `pnpm test:rust:cli`。
链接 owner 扩展根以上 alias 放行和根以下 alias 拒绝；已有 Windows junction owner 同时验证清理不越界，
不增加另一个 junction fixture。promotion 后先转移 owned path，再执行父目录同步，确保同步失败也能回滚。

## 验证记录

2026-08-30，隔离 worktree 内验证：

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过，包含文档/Skills 检查；主 Node suite 219 通过、1 项 Windows 专属测试在 macOS 跳过 |
| `pnpm build:desktop` | 通过，仅构建，未启动 App |
| `pnpm test:rust:staged` | 路由到 `cargo test --workspace`：Library 403、CLI 32、Core 182 通过，4 项既有人工/真实 Runtime 测试保持显式 ignore |
| `pnpm test:rust:slow` | 291 通过，现有 Managed v2 持久化、目录摘要和原子提交 owner 保留 |
| `cargo check --workspace --all-targets` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo fmt --all --check` / `git diff --check` | 通过 |
| 构建后的 CLI 进程 + 临时 IPC 接收端 | 首次请求混合外部文件/目录与内部路径，cwd 和环境变量不覆盖 lease 根；原文件不变，确定响应和未发出请求均清理快照 |
| `DOCS_BASE_REF=3123e885e2ab54a64848646c485434658b6154de pnpm docs:check:ci` | 通过 |

独立 Standards / Spec 复核已闭合 Windows junction 清理、未 dispatch 回滚、根以上路径 alias 和
promotion 后同步失败归属四项问题，无遗留实质发现。Windows 专属测试的共享函数引用随抽取同步修复。

真实 Runtime 和日常 App 均未运行，不以离线结果代替 Runtime 矩阵。Windows 原生验证由既有 PR CI
compile gate、attachment traversal、新增 CLI snapshot 执行步骤和 Named Pipe job 执行；CLI 步骤复用
本次已有的跨平台低成本 fixture，不新增重复用例。此处不宣称本机完成 Windows 实测。
