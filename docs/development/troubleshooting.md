---
document_type: development-guide
authority: local-development-troubleshooting
last_updated: 2026-07-30
---

# 常见问题排查

## `pnpm dev` 启动了旧 Core

先单独重建 Debug Core：

```bash
pnpm core:build:debug
```

确认 `resources/bin/rovai-core` 的修改时间已更新，再重新启动 `pnpm dev`。开发窗口已经
运行时，重新复制二进制不会替换现有 Core 进程。

## 打包后仍看到旧行为

确认打包命令成功结束，并彻底退出旧 App：

```bash
pnpm package:mac
open "$(pwd)/dist/mac-arm64/Rovai-ai.app"
```

可按[打包文档](packaging.md)比较 release Core 与 App 内 Core 的 Mach-O UUID。

## Runtime 未找到或未 Ready

1. 在“设置 → 执行引擎”执行重新检测或深度检查；
2. 查看诊断页报告的路径、版本、认证和 blocker；
3. 从登录 Shell 验证对应 Runtime 是否可执行；
4. 仅在 PATH 无法表达目标时，临时使用
   [Runtime override 环境变量](environment.md#agent-runtime-是按用途选择的能力)；
5. 不要通过复制用户级 Runtime 配置到 fixture 来绕过探测。

一个 Runtime 缺失不应阻止普通 App 启动，也不意味着其他 Runtime 不可使用。

## 普通目录或空 Git 仓库被误判

产品工作区不要求 Git 或首个 Commit。先确认报错来自哪一层：

- 路径安全检查要求目录存在、可读且通过 canonical 边界；
- Git capability 可以是 `not_git`、空仓库或有效仓库；
- 某个 Smoke 可能自行要求系统 Git 来创建 fixture。

不要为了通过普通目录准入而自动执行 `git init` 或创建无意义 Commit。

## Smoke 超时、产生授权请求或费用

真实 Runtime Smoke 继承上游账户、模型和权限策略。先查看
[测试表](testing.md#真实-runtime-smoke)，确认命令是否调用模型以及支持哪些 selector。

超时排查顺序：

1. 对应 Runtime 的 Discovery/Deep Probe 是否 Ready；
2. 上游认证、额度、网络和模型名是否有效；
3. 是否有未处理的 Runtime 原生 Approval；
4. 临时 fixture 是否被保留并包含 Core stderr；
5. 重跑时是否会产生第二次费用或重复外部副作用。

不要把扩大预算、关闭审批或重复真实副作用作为默认重试策略。

## `codesign` 校验失败

先确认目标是本次生成的 `dist/mac-arm64/Rovai-ai.app`，再运行：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Rovai-ai.app"
codesign -dv --verbose=4 "dist/mac-arm64/Rovai-ai.app"
```

本地 `package:mac` 是 ad-hoc 签名，不会产生 Notarization 票据。正式证书或公证问题按
[打包文档](packaging.md)单独处理。

## SQLite 被占用或验收修改了日常数据

立即停止相关 App/Core 进程，不要在运行中的数据库上直接复制文件或执行修复 SQL。
从诊断页确认真实路径，使用 SQLite Backup API 创建副本，并在隔离目录复现。具体步骤
见[桌面 UI 验收](ui-acceptance.md#从明确来源创建只读隔离副本)。

## 文档与命令不一致

优先检查 `package.json#scripts`、目标脚本和当前版本实施计划。若常青文档与它们不一致：

1. 不要把历史版本说明当作当前命令；
2. 在同一改动中修正文档入口和交叉链接；
3. 不记录个人绝对路径或即时工具版本；
4. 新增或删除 `smoke:*`、`accept:*`、`package:*` 命令时同步更新开发文档表。
