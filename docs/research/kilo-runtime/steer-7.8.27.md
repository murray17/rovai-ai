---
document_type: research-record
authority: non-normative-runtime-evidence
status: implemented-preview
last_updated: 2026-11-09
---

# Kilo 7.8.27 ACP Steer 可行性

结论：原生接续基础已用于 Core Steer，仍为 macOS arm64 Preview。
本页保留原生调查范围；实际 Core/开发版结果见[后续实施记录](../../versions/v1.72/kilo-files-steer-verification.md)。
没有专用 Steer method 或 capability 广告，不能直接把第二个普通 prompt 当成已经准入的 Core Steer。

官方 7.8.27、macOS arm64、全新 HOME/XDG、loopback Provider 的实测：

1. 首个普通 `session/prompt` 进入模型请求后，Provider 暂停该响应。
2. 同一 Host、同一完整 Session ID 提交第二个普通 `session/prompt`。
3. 首响应尚未释放时，原生 SQLite 已记录更正输入；随后模型实际收到更正。
4. 两个 RPC 分别返回 `end_turn`。首个终态不能代表所有后继原生请求已经结束。

这是原生接续行为证据，不证明 token 级即时替换。它不经过 Core Steer、Binding/epoch 或 CLI lease，
不冒充已经可在 Rovai UI 使用。原始结果由[原生探针](../../../scripts/probe-kilo-runtime.mjs)复现并归档，精简结果见[机器证据](steer-7.8.27-macos-arm64.json)。

## 接入条件

- 复用共享 Steer ledger、当前 Run/epoch/Prompt fence、原 Native Session 与当前 CLI lease。
- 在首个终态到达前登记所有已提交的后继 RPC；所有请求收口后才能完成同一 Run，不能抢先结束 lease。
- 只有原生接收证据才能提交 accepted；断线/超时属于 unknown，不能自动改成普通输入重放。
- 验证首请求结束竞态、连续更正、取消时全部 pending 请求、迟到回复和后续普通 Run。
- 保留公开发送去重、原生失败优先级及已发生副作用；不增加独立 Session、私有队列或 nonce。

当前实现复用共享输入、版本准入与多请求收口；本页原生结果不替代后续 Core 验证。

## 官方源码

- [ACP service](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/service.ts)：普通 prompt 交付同一 SDK Session，没有专用 Steer 方法。
- [Session prompt](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/session/prompt.ts)：用户输入 intake 与原生 prompt queue。
- [ACP event](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/event.ts)：每个请求拥有独立的响应消息/idle waiter。
