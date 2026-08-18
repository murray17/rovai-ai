---
document_type: prototype-readme
prototype: windows-interaction-delta
status: review-artifact
source_version: v1.05
last_updated: 2026-08-18
---

# Windows Interaction Delta HTML

[`index.html`](index.html)是 [Windows Interaction Delta](../../ui/windows-interaction-delta.md)的可交互评审稿，覆盖
native frame/App Shell、Runtime Platform Admission、历史未准入配置精确保留、Windows 文件系统 blocker 和
Installer/Upgrade。它使用说明性数据，不是 Runtime 资格证据、生产组件或实现完成证明。

评审稿以当前 macOS 产品页为视觉基线，而不是另建一套“Windows 皮肤”：默认画面全幅呈现 App，不再用评审侧栏、
舞台留白、圆角窗口卡片或简化版导航包住产品。右下角“原型控制”默认收起，可在同一页面切换 `macOS 原页` 与
`Windows 差异`；后者只增加 native frame、Windows 快捷键/路径文案和平台能力状态。设置页保持 270px 设置侧栏，
成员页保持 270px 主侧栏 + 236px 队员列表，Runtime 目录复用生产 68px 行、真实产品 Logo 与十项 Catalog。

可直接打开，也可从仓库根目录启动本地静态服务器：

```bash
python3 -m http.server 4173
```

然后访问 `http://127.0.0.1:4173/docs/prototypes/windows-interaction-delta/`。页面、宿主、主题、Runtime 说明态、
路径结果和边界标注均可键盘操作。右下角控制器不属于产品 UI；HTML 中的 caption buttons 也只是 native frame
的位置示意。Windows 真实 100/125/150/200% DPI、系统窗口行为与辅助技术仍须在 Windows 10/11 客户端验证。

视觉方向、复用边界和非目标见 [`PROJECT_DESIGN.md`](PROJECT_DESIGN.md)。
