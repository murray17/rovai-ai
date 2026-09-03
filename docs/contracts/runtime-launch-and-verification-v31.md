---
document_type: contract
name: Runtime Launch and Verification
version: v31
status: accepted
source_version: v1.39
last_updated: 2026-09-03
---

# Runtime Launch and Verification v31

v31 replaces [v30](runtime-launch-and-verification-v30.md). v30 的 Pi JSONL wire、无 Prompt Machine Ready、private exact
Session locator、Resident Host/Fleet/LRU、managed system prompt/receipt、Skills、External MCP、Action、Final、Cancel、
Usage、unsupported capability 与 cleanup 语义全部保持不变。v31 只替换 Pi 的平台准入与产品开放边界。

## 1. Pi platform preview

Pi 的 macOS arm64、macOS x64 与 Windows x64 行均为
`preview / runtime_platform.qualification_evidence_missing / evidenceRevision=null`。三行都可以进入普通 discovery、
Availability Check、managed Installation、Onboarding/Member selection、Diagnostics 与 AgentRun Dispatch Preflight。
release build 不再依赖或读取 `ROVAI_PI_RUNTIME_QUALIFICATION_ADAPTER` debug override。

`preview` 只开放用户主动测试，不构造 qualification artifact，也不把 Machine Ready、deterministic fixture 或 macOS
arm64 开发 smoke 改写为其他平台证据。Renderer 在 Runtime 目录和成员选择中显示“实验性”或“实验性开放”，同时继续
展示真实 machine availability；缺安装、需要登录、版本不兼容、Probe 失败和 Dispatch blocker 不得被预览状态覆盖。

## 2. Qualification remains independent

Pi 仍不是任一 shipped platform 的 First-Class/qualified Runtime。每个平台完成当前 Runtime Integration Checklist、
生成 immutable digest-bound artifact 并经单独审查后，才可把该精确行升级为 `qualified`。升级不改变 v30 已冻结的
Pi runtime/session/context/approval/MCP/usage wire。

Cursor Agent 仍在三个平台 `not_qualified` 且不进入普通产品表面；DeepSeek Harness 仍是 Renderer-only Settings Preview。
其他 Runtime 的平台状态和证据 revision 不变。

## References

- [Runtime Launch and Verification v30（historical）](runtime-launch-and-verification-v30.md)
- [Runtime Platform Admission v2](runtime-platform-admission-v2.md)
- [V1.39-D06](../versions/v1.39/decisions.md#v1-39-d06)
- [Pi parity matrix](../research/pi-runtime-reintegration-parity-matrix.md)
