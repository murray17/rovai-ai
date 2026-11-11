---
document_type: contract
name: Runtime Launch and Verification
version: v80
status: accepted
source_version: v1.72
last_updated: 2026-11-09
---

# Runtime Launch and Verification v80

继承 [v79](runtime-launch-and-verification-v79.md)，接通 Kilo 原生前台策略、Steer 与文件结果投影。
已确认 Kilo R1 的 B/P、Formatter、Manifest、Bootstrap 与投递证据版本保持。

## 原生后台子代理

最终 Kilo 启动环境固定 `KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false`。
该原生开关隐藏 task 的 background 参数并拒绝显式后台调用，前台原生子代理仍可用。
沿共享 Host compatibility 的 `nativeBackgroundPolicy=disabled-v1` 退役旧策略 Host，精确 Session 恢复不变。
不追加 Charter、不重写 task schema，不在 Core 模拟后台执行策略。

## 同 Run Steer

ACP v1、Kilo 7.8.27 起的 7.x 使用同一 Session 的普通 `session/prompt`；该门槛是本次实现边界，
不是最早原生支持版本或所有 7.x 均已验收的声明。
只有相关 RPC 的 `end_turn` 证明这条输入已被接受；断线、超时或缺失终态保持 unknown，不自动重放。
标准明确的无效请求、方法或参数错误保留未接受语义。

复用 Hermes 已有的并发 prompt 收口：原请求与已提交的补充请求全部返回后才能结束 Run、释放 CLI lease。
补充请求失败不能被原请求的成功覆盖；取消沿共享 Run/epoch/Prompt fence 与进程清理。
Kilo 取消通知成功后，沿当前 route 最多等待 2 秒让已提交 prompt 返回终态，再进入既有进程清理；
原生未及时结束时仍按原清理流程收口，不删除其私有 turn/snapshot 文件。
普通模型/工具活动用于确认首条输入，catalog/history/user echo 不作为接受证据。
不增加 Kilo 队列、Session、轮询读取器或后台完成唤醒。
输入提交仍按共享 scheduler 的 Run 内顺序执行；等待完整 RPC 回执期间，后续输入保持既有待投递/收口回队列语义。

## 原生文件结果

Kilo 的模型原生选择 edit 或 apply_patch；GPT 模型可能只暴露 apply_patch，Rovai 不伪装工具名。
成功终态的 `rawOutput.metadata.filediff`（write/edit）和 `metadata.files[]`（apply_patch）
进入 `runtimeDiff.semanticKind=kilo_file_patch`，复用已有原生 unified patch 解析、路径与预算处理。
单文件结果可形成同 Activity 的 file-operation；多文件逐条形成 Diff entry。
write 的原生 Boolean exists 区分 add/update，已有空文件为 update。

只消费已完成、未截断的原生结果，不读取磁盘重建前态；edit 的 oldString/newString 及标准 Diff
可能只是替换片段，不作为完整文件 before/after。缺少合格结果时保留既有路径/文本展示。
文件内容、增删计数与恢复重建沿共享 projection；不新增 Renderer Runtime 分支、classifier 或数据库迁移。

平台仍为 macOS arm64 Preview，其他平台 NotQualified。
验证证据与范围见[实施记录](../versions/v1.72/kilo-files-steer-verification.md)。
