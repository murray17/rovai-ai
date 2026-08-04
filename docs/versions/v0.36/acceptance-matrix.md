---
document_type: acceptance-matrix
version: v0.36
authority: release-acceptance
status: frozen
last_updated: 2026-08-04
---

# v0.36 验收矩阵

自动化fixture只证明协议和实现行为；`DCP-001`八个真实Trial另行产生私有Evidence Bundle。任何fixture
不得冒充真实LLM Judge、Formal Isolation或团队能力结论。

| ID | 场景 | 必须证明 |
|---|---|---|
| V36-001 | v2 compatibility | `DEMO-001`原Seal/admission仍可验证，字节和历史语义不重写 |
| V36-002 | valid v3 Case | 六Requirement、五public Check、四pair、R5、Runner R6全部成立 |
| V36-003 | initial/reference | Target初始fail、Baseline初始pass、reference全部pass，双物化一致 |
| V36-004 | invalid topology | 缺Requirement、额外public Check、重复mapping或private obligation fail closed |
| V36-005 | legacy collaboration | v3出现`collaboration`或旧return/response字段时admission拒绝 |
| V36-006 | hermetic environment | direct Node、UTC/C、isolated HOME/TMP、read-only delivered tree与fixed limits |
| V36-007 | denied ambient effect | verifier network、child process或workspace write被权限模型拒绝且typed报告 |
| V36-008 | mutant classes | 三个mandatory fault class全部存在且稳定ID唯一 |
| V36-009 | precise mutant | 两次实际failure set与声明exact match，undeclared extra failure拒绝 |
| V36-010 | withheld discrimination | 至少一个Mutant通过全部public Checks但被withheld Check拒绝 |
| V36-011 | regression/boundary mutant | R1～R4全pass且只失败R5或R6 |
| V36-012 | private Pack admission | root/location/permission/symlink/locator规则fail closed |
| V36-013 | Canary leak | delivered/evidence/public/Judge任一Canary命中被保留并使Portfolio incomplete |
| V36-014 | immutable Definition | 首dispatch后Definition不可覆盖，config digest绑定全部冻结输入 |
| V36-015 | Ledger integrity | gap、fork、duplicate、digest tamper、unknown transition全部拒绝 |
| V36-016 | preflight replacement | 原Invalid attempt保留，同identity replacement正确link同slot |
| V36-017 | post-dispatch no replacement | accepted attempt之后replacement被拒绝，same Snapshot evaluation可恢复 |
| V36-018 | stable pass/fail |两个canonical Fingerprint相同产生对应稳定态 |
| V36-019 | repeat disagreement | 任一Hard field/Requirement不同产生`investigation_required`且无第三slot |
| V36-020 | incomplete | pending、irrecoverable、drift或leak阻止Completion |
| V36-021 | outcome neutrality | stable Hard fail可完成Portfolio，不触发Case替换或降难度 |
| V36-022 | public projection | 无locator/identity/raw content/Canary/score/rank/Pass Rate/Pass@k/formal claim |
| V36-023 | Judge unavailable | 八Trial Layer 5 unavailable且Hard payload/Fingerprint不变，无fixture attachment |
| V36-024 | four Case admission | `DC-001`～`DC-004` reference、initial和Mutants全部通过admission |
| V36-025 | eight real slots | 八个fresh Trial全部valid+complete+bundle verified+non-leaking |
| V36-026 | Completion verification | 独立重算Definition、Ledger head、Bundles、Fingerprints和Stability通过 |
| V36-027 | full regression | Qualification、Core、Renderer、typecheck、clippy、fmt、desktop build全过 |

## 发布判定

- V36-001～V36-023与V36-026～V36-027必须自动化；
- V36-024～V36-025必须有private、不可变且可独立验证的真实证据；
- 任何Case可得到Hard pass或Hard fail；结果分布不是验收条件；
- `investigation_required`可进入完成Attestation，但该Case不得标记Formal promotion eligible；
- 任一`incomplete`阻止Completion和版本`implementation_status: complete`。
