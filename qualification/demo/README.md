# Public executable demo cases

这些 Case 是公开、可执行的 demo lane，用于真实模型 smoke/benchmark 试跑；它们不是正式 Team
Qualification，也不产生 Pass Rate、Pass@k 或跨模型排名。每个 Case 都保留自己的 fixture、reference、
verifier、公开回归检查和 admission Seal。

| Case | 主题 | 主要边界 |
|---|---|---|
| `DEMO-001` | 连续事件分组 | 相邻 actor 分组、默认 actor、输入不可变 |
| `DEMO-002` | 版本事件归一化 | v1/v2 shape、identity 去重、稳定顺序 |
| `DEMO-003` | 幂等重试计划 | 成功抑制、attempt 上限、重复记录 |
| `DEMO-004` | 版本状态迁移 | v1/v2/v3、旧值保留、未知版本 fail closed |
| `DEMO-005` | 受限 patch 事务 | 相对路径、原子回滚、输入不可变 |

运行全部 Case 的 admission/Seal 检查：

```bash
pnpm qualification:demo:check
```

`qualification/diagnostic/v0.36` 中的 `DC-001` 至 `DC-004` 仍是历史私有 Pack 身份；它们没有被复制、
重算或改写。公开 demo Case 只借鉴主题，不冒充历史诊断结果。
