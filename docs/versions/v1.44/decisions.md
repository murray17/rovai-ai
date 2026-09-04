---
document_type: version-decisions
version: v1.44
lifecycle: historical
last_updated: 2026-09-04
---

# v1.44 决定

<a id="v1-44-d01"></a>
## V1.44-D01：Rovai 投递普通 Pi Prompt，Pi 拥有原生资源解释

### 背景

v33 同时恢复 Pi 原生 ResourceLoader，又由 managed extension 把相同 `.pi/skills` root 追加进
`resources_discover`，并由 Core 读取 `get_commands`、解析 `/command`、读取 Skill/Prompt 文件并生成第二份
Runtime payload。这让普通 Camp 消息意外继承 Pi TUI 命令框语义，也形成两条资源发现路径、重复 catalog 证明和
Prompt Transform 数据合同。启动失败后的 `--no-extensions` fallback 还会让相同 Host identity 静默拥有不同能力。

### 决定

正式 Pi 永远运行原生资源加必要 `rovai-pi-host-v6` 薄 extension。Rovai Skill projection 只负责把冻结 Revision 写入
workspace `.pi/skills`；Pi 是否发现它由原生 ResourceLoader、workspace trust 和用户设置决定。extension 不返回
`skillPaths`，Core 不读取或证明完整 catalog，Skill discovery 使用 `DocumentationOnly`。

Rovai 消息只是一条普通 Agent Prompt。Formatter 22 的 payload 不解析 `/command`，不读取资源文件，不产生 Runtime
transform，逐字节发送为 `prompt.message`。图片独立从 ContextManifest attachment refs 与授权生成，直接留证到
Delivery。只有明确 Session continuity failure 可以创建一次 replacement；其余 activation 错误保留真实分类。
Pi External MCP 继续 `Unsupported`，部分审批和 managed receipt/accepted 原子性不变。字段合同由
[Runtime Launch v34](../../contracts/runtime-launch-and-verification-v34.md)拥有。

### 后果与被拒绝方案

- 项目原生 Skill 与 Rovai 投递 Skill 只有 `.pi/skills → Pi ResourceLoader` 一条发现链，不绕过 Pi trust。
- `/new`、`/compact`、template、Skill 和 Extension command 在 Rovai 消息中都是普通文本；这不禁用 Pi Extension
  hooks、tools、resources 或其原生 lifecycle。
- 不再证明完整 Skill/Tool/Extension catalog；Receipt 只证明本轮必要绑定、Bootstrap 和三个 governed Tool。
- 拒绝保留 command expansion 作为“方便兼容”：它会重新引入文件读取、二次语义和不可见 payload 改写。
- 拒绝 managed-only fallback：启动错误比能力静默降级更符合可诊断、同 identity 同语义的 Host 合同。

<a id="v1-44-d02"></a>
## V1.44-D02：Fleet 用 Starting reservation 把耗时启动移出全局锁

### 背景

Pi Adapter 的 per-Run gate 已允许不同 Run 独立创建，但公共 Fleet 仍在全局 operations mutex 内执行完整
`spawn().await`。任何 Runtime 的进程创建、协议连接或 handshake 都会阻塞其他 Run，Adapter 私有 gate 也无法证明
公共容量、LRU 和 shutdown 与在途创建之间的线性化。

### 决定

Fleet `acquire` 固定为 `Reserve → Spawn outside lock → Commit`。Reserve 在短锁内选择现有 lease/Idle Host、容量与
eviction，并登记计入容量的 `Starting`；耗时 stop/spawn/handshake 在锁外执行；Commit 只允许仍未被 generation、
shutdown 或 invalidation fence 退役的 reservation 进入 Busy。相同 Run/epoch 的请求等待同一 completion，不产生
第二个进程；不同 Run 与不同 Runtime 可并发启动。所有删除、force stop 和 shutdown 都先退役 Starting，迟到进程
必须关闭并 reap。

### 后果与被拒绝方案

- Resident 容量包括 Starting，避免并发 reservation 超配；LRU 选择仍在同一短锁下保持确定性。
- spawn failure 原样通知全部同 Run waiter，并释放 reservation/capacity；成功 waiter 取得同一 lease identity。
- Fleet 正确性不依赖 Pi 或任何 Adapter 的私有 singleflight，Adapter gate 可以保留为局部防重层。
- 拒绝在全局锁内等待 spawn：它把单一 Runtime 延迟放大为全局队头阻塞，并妨碍可靠 shutdown fencing。
