# Steel Night 全应用交互稿

入口：[index.html](./index.html)

这是一个单文件、无构建依赖的 Rovai AI 夜间模式交互稿，覆盖 Quick Chat、Camp、Members、Memory、七个设置页面，以及新对话、通知、记忆提案、Mention、审批和 AgentRun 恢复等关键交互。

推荐从本目录启动本地静态服务：

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:4173/index.html`。用户提供的原稿未被修改。

设计取舍、页面矩阵与验收记录见 [PROJECT_DESIGN.md](./PROJECT_DESIGN.md)。
该方向已于 2026-08-12 落入 Desktop 生产双主题；此目录继续保留为完整交互参考，不作为运行时代码来源。
