---
document_type: implementation-plan
version: v1.57
status: in_progress
last_updated: 2026-09-10
---

# 回归预算校准与真实 Judge

用户明确要求提高时间上限、允许有限并行并接通 Judge。复用当前 Case、Runner、Host、双 View、评分和报告；不修改产品上下文或日常数据。

Suite 2.2.0 将十二项时间上限翻倍为 480／600 秒，旧 Case 目录保留；题目、原始材料、参考产物和 verifier 字节不变。新执行配置冻结最多两个 Case 并行，同一 Case 的基线／候选仍顺序执行。配置进入比较身份；两小时手动 campaign 用于完整校准，45 分钟定时上限保持。共享主机并行不代表严格资源隔离或速度收益。

当前没有 API Key。CLI Judge 复用已登录 Codex，使用 gpt-5.6-sol/medium、每次最多 240 秒、不自动重试。独立 CLI 会话只接收其 View 的材料；本地运输探测核验没有工具，原模型目录声明、定制工具配置、二进制和可能残留的用户指令均摘要绑定。只记录 CLI 支持的推理参数，不捏造温度、seed 或 Token 上限。模型目录声明不是不可变权重；该路径用于真实诊断，不能放行需要固定 snapshot 的 Gate，不能作为 Formal Judge。

真实小样本已暴露并保留：Semantic Review CLI 的 process 局部变量遮蔽入口、旧配置 schema 强制 API 参数、未向真实模型提供完整输出字段导致格式不合格。分别补入口回归、独立 1.1 schema、明确结构化输出。未将 pass/fail 或错误字段在事后转换成合法判定。旧证据复制上的发布又遇到生产者版本不一致，未覆盖原记录；完整验收使用当前生产者重新执行。

公开硬性检查与真实 Judge 分开。已保留样本的格式验证中，双副本均返回七个合法 Outcome 判定及闭包内引用；该样本不是全套通过。完整运行、结果、超时及剩余问题在完成后追加；合同和单测不计为任务质量样本。

演示按[操作指南](../../development/evaluation.md)准备 CLI Judge，使用新 Suite 冻结 execution 配置，再通过 owner CLI 提交 weekly。查看报告的实际模型、预算、版本、Case 明细和 Judge 引用；原旧预算失败不被替换。
