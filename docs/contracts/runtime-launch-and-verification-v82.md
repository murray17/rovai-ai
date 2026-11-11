---
document_type: contract
name: Runtime Launch and Verification
version: v82
status: accepted
source_version: v1.72
last_updated: 2026-11-09
---

# Runtime Launch and Verification v82

继承 [v81](runtime-launch-and-verification-v81.md)，仅收窄 Kilo 成功 Steer 后的 Host 退役条件。
普通 `session/prompt` 传输、输入回执、串行派发、多请求收口、B/P 和相关证据版本保持。

Kilo 原请求及所有已提交的补充请求共同收口为正常 `end_turn` 后，解除本次 Steer 的退役标记，
沿现有 detach、Fleet quiescence 与兼容条件复用 Host 和原 Session。明确未接受的补充请求
不覆盖原请求的正常结果，继续沿既有未接受语义处理。

失败、取消或未收口的 Steer 不获得该成功解除；已有进程清理、unknown 不重发、
Run/epoch fence 与 pending/route 检查保持。其他 Adapter 的退役策略不变。
不新增复用状态、队列、管理器、等待窗口或历史读取器。

文件结果转换及 MCP cwd 适配继续遵守 v81；原生问卷关闭双入口按 User sequence 25 保持。
平台仍为 macOS arm64 Preview，其他平台资格不变。
实际失败对照、连续复用与取消后继范围见[实施记录](../versions/v1.72/kilo-steer-reuse.md)。
