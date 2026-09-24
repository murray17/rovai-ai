---
document_type: version-decisions
version: v1.66
authority: decision-rationale
lifecycle: historical
last_updated: 2026-09-22
---

# v1.66 版本决定

<a id="v1-66-d01"></a>
## V1.66-D01：普通 Tool 输出在统一持久化 seam 永久有界

- 状态：accepted
- 日期：2026-09-22
- 当前权威：Execution Evidence 基础不变量与 Run Process Detail Surface v42

### 背景

旧路径把长 Tool 结果转存 Managed Blob，首屏只看预览但详情仍能恢复全文。这既不能限制本地数据增长，也会让同一
普通输出通过 payload、result Blob、Core Envelope 或事件别名重复存在。只在 Renderer 截断会保留全部存储成本，并让
“是否还能加载全文”继续依赖偶然实现。

### 选择

Runtime 仍把协议结果完整交给 Agent；其后由 Core 唯一 `PersistableResult` seam 把新普通 Tool 输出限制为 7,680
UTF-8 字节，并在所有持久化、事件和详情分支之前永久舍弃后缀。结构化文件事实、输入、状态、错误码和附件维持独立
合同。更新类型由 Adapter/Core 明确标记为完整快照、连续增量或纯元数据，历史 marker 保持 nullable unknown。

### 后果

- 本地详情无法恢复被舍弃的普通输出；Renderer 必须诚实提示，而不是继续显示“完整结果”。
- SQLite 与 Blob 的结果 JSON 仍可因完整结构化 diff 超过 inline 阈值而进入 Blob，但其中普通输出已经有界。
- digest 可以证明 Built-in Shell 载体与 Core 操作相同，却不能成为重建输出的旁路。
- 未来若要改变预算或保留额外结构化结果，必须在同一持久化 seam 和合同中显式准入，不能新增隐蔽全文副本。

### 未选择方案

- **只截 Renderer 预览、Blob 保留全文**：无法实现存储上限，也保留了恢复承诺。
- **每个 Adapter 各自截断**：判断和字节语义会漂移，且可能在 Core Envelope/事件中遗漏副本。
- **删除所有结构化结果**：会破坏 Command Diff、Files Changed 与附件等独立产品能力；这些事实不应与普通输出共用预算。
