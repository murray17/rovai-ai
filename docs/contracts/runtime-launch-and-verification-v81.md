---
document_type: contract
name: Runtime Launch and Verification
version: v81
status: accepted
source_version: v1.72
last_updated: 2026-11-09
---

# Runtime Launch and Verification v81

继承 [v80](runtime-launch-and-verification-v80.md)，收口 Kilo 权限回调前提、共享 MCP cwd、取消预算和结果投影。
已确认 Kilo R1 的 B/P、Formatter、Manifest、Bootstrap 与投递证据版本保持；没有新增模型输入或公开 CLI 命令。

## 原生权限回调前提

Kilo 执行准备在追加必需的原生 config 回调时固定 `KILO_PURE=false`，覆盖继承的 pure 开关，
使该回调可以参与原生配置合并。仅查询目录时不覆盖 pure；后台子代理禁用策略保持。
继续使用原生 loader、权限求值器和共享审批，不增加 Core 权限副本或加载握手。
`session/new` 成功本身不作为回调已成功执行的证明。

## ACP stdio MCP 工作目录

Kilo 与 Command Code 继续复用共享 cwd 适配。只有配置 cwd 与 Session cwd 不同时，
将启动入口改为现有受管 bundled `rovai` 的绝对路径，参数为私有模式、cwd、原始 executable 与逐项原始 argv。
私有模式在建立 Core IPC 或异步 Runtime 前进入 cwd，以继承的 stdio 直接执行服务器，不经过 shell。
Unix 用 exec 替换 launcher；其他平台等待子进程并传播退出码，Windows 保持隐藏控制台。
启动失败只写 stderr。相同 cwd、未设置 cwd 与 HTTP MCP 保持原路径。

这条路径不依赖 PATH 中的 Node，也不引入脚本运行时、常驻服务或新的 Agent Tool 入口。
MCP 服务自身声明的执行程序及依赖继续归该配置拥有。

## 取消与清理预算

Core cleanup 统一持有绝对阶段期限：interrupt 为开始后 2 秒，flush 为开始后 2.5 秒；
总预算仍为非 Windows 3 秒、Windows 5 秒，其余时间供进程回收。
同一 interrupt deadline 传入 ACP；Kilo 发送取消后等待当前 route 的已提交 prompt 终态，
不再从内部重新开始一个 2 秒计时。超时继续现有 detach、flush 和进程清理，不删除原生私有文件。
planned stop 与直接 ACP 输入失败取消也使用共享 interrupt 预算。
Steer 多请求收口和使用 Steer 后退役 Host 的策略保持。

## 文件与模型展示

Kilo 原生文件元数据先映射为共享 Diff candidate。单文件且有共同 file-operation 路径时，
在共享 execution-root 路径归一化后核对，允许指向同一文件的相对、绝对及点段路径；真实不匹配仍拒绝。
保留已构造的共同 file-operation；仅在其缺失、原生结果为单文件 add/update 时补 fallback。
delete 只由 Diff 表达，不生成 `operationKind=write, changeKind=delete`。
既有截断、终态、patch 与预算规则保持，不读取磁盘重建前态。

成员摘要和历史消息使用各 Adapter 原生 effort 键：Kilo/Command Code/Claude 为 `effort`，
MiniMax 为 `thinkingEffort`，Pi 为 `thinking_level`，CodeBuddy 为 `thought_level`，其他为 `reasoning_effort`。
TS 的成员与历史选择共用一个纯函数；历史仍读取冻结 Run 配置，不改写历史或新增配置字段。

平台仍为 macOS arm64 Preview。实际边界、失败对照和验证见[收尾记录](../versions/v1.72/kilo-boundary-fixes.md)。
