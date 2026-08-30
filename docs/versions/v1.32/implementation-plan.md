---
document_type: implementation-plan
version: v1.32
status: in_progress
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

待实现后填写；真实 Runtime 和日常 App 均未运行，不以离线结果代替 Runtime 矩阵。
