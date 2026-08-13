# Notification settings interaction options

Open [`index.html`](index.html) in a browser. The standalone prototype compares three arrangements
for “设置 → 通知”, supports Porcelain Day / Steel Night, and simulates immediate save, rollback and
retry without connecting to Rovai Core or the daily App data.

- A uses one direct master/child list.
- B groups the four categories into “需要响应 / 本轮结果”.
- C pairs the switches with an illustrative heads-up preview.

B is the selected production direction. The prototype remains a design record rather than a
Renderer or notification-domain authority; current behavior comes from
[`NotificationSettings.tsx`](../../../apps/desktop/src/renderer/src/NotificationSettings.tsx), the
[settings surface brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md), and the
current notification contracts.
