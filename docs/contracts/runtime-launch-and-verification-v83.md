---
document_type: contract
name: Runtime Launch and Verification
version: v83
status: accepted
source_version: v1.72
last_updated: 2026-11-10
---

# Runtime Launch and Verification v83

继承 [v82](runtime-launch-and-verification-v82.md)，按 User sequence 48 收敛 Kilo MCP 保存、原生权限与取消释放。
模型／effort、Bootstrap instructions、压缩、Skills、文件 Diff、前台子代理、用量与 MCP cwd 不重构；
B/P、Formatter、Manifest 与 Input Delivery Evidence 版本保持。

## MCP 下一 Run 生效

Kilo MCP 保存只提交配置，不主动使 Host 失效／退役，也不等待闲置连接退出。
当前 Run 使用已经冻结的 MCP 投影。下一 Run 准备时按当前有效配置使用既有兼容性判断：
兼容则复用，不兼容则清理旧 Host、创建替代 Host 并精确恢复原 native Session。

保存 A→B→A 且期间未执行时允许复用原 A Host；实际执行 A→B→A 不复活已退役 Host。
禁用、撤销分配或删除后，下一 Run 不再获得旧工具。没有 dirty 标记、计数器、延迟队列或新 MCP 管理器。
Command Code 的主动 invalidation 策略保持；不同 cwd 的 bundled Rovai 入口保持。

## 完全使用 Kilo 原生权限

Rovai 不提供 Kilo 产品权限档位。新成员的共用 permissions 结构保留 schema 1、空 values，
不再创建 allow 默认值或权限选择器，产品展示“沿用 Kilo 原生权限”。
不生成或注入权限 config Hook，不覆盖 `KILO_PERMISSION`、`KILO_PURE`、question 权限或用户 plugin。
Kilo 继续加载用户／项目／环境／具体工具及 Agent 原生规则并作出判断。
共享 Approval 保留原生选项及对应回传，不根据旧产品档位自动批准请求。

仅对已退役的 Kilo `permission` 键及其旧缓存 required 描述提供兼容：旧成员可读、修改和启动；新 Run 解析执行配置时忽略该键，
不把它带入新冻结配置或 Host 权限摘要。其他未知键、错误值容器和 schema 约束继续校验。
已存在 Run 的冻结配置、事件和审计不迁移或改写。

追加 instructions 仍使用 Kilo 局部的有序配置表示，保持所有继承原生规则及用户 plugin 的顺序和内容。
问卷依靠既有 `KILO_CLIENT=acp`、`KILO_ENABLE_QUESTION_TOOL=false`；后台子代理独立原生开关保持，
不为关闭问卷保留权限插件。环境编辑的 cold-spawn 语义继续遵守 v68，不因本轮扩大为 Warm 配置重载。

## 共享取消与复用

删除 Kilo 专属的等待分支，使用共享 ACP 的关联终态、pending RPC 和多请求汇合，时间预算保持。
普通取消确认收尾且 ingress 已排空后，沿原 Fleet release 检查进入 Warm；未知、异常、超时或退役仍回收。
释放结果与 cleanup ACK 的精确区别、重试、late fencing 和所有权例外见
[Accepted Input Recovery v9](accepted-input-recovery-v9.md)。不增加 Kilo 私有复用机制。

平台仍为 macOS arm64 Preview，其他平台不因本轮提升。实施、失败对照与实际证据见
[简化记录](../versions/v1.72/kilo-simplification.md)。
