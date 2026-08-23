# Qualification Evidence

`qualification/` contains committed synthetic demos, frozen acceptance registries and historical
diagnostic evidence used to test Rovai's qualification machinery.

## Directory roles

| Directory | Purpose |
| --- | --- |
| `demo/` | Small synthetic projects with public prompts, fixtures, verifiers and reference implementations. |
| `acceptance/` | Frozen registries proving that named qualification scenarios have deterministic test or Core evidence. |
| `diagnostic/` | Historical diagnostic portfolios and outcomes that preserve their original limitations. |

## Public-boundary rules

- Committed cases are intentionally public. Their prompts, references and verifiers are not secret
  benchmark material.
- A manifest field such as `disclosure: withheld` means the check is withheld from the Agent during
  that run. It does not mean the repository file is confidential.
- Public demo cases are contaminated for benchmark purposes once committed. They must not be used as
  hidden Formal Qualification cases or as evidence of model generalization.
- Future private evaluation cases, unpublished reference answers, provider credentials and private
  model transcripts must remain outside this repository.
- Qualification outcomes do not define the Product Runtime Catalog, platform support or a model
  leaderboard. Those claims require their own current authority and evidence.

Run the committed demo validation with:

```bash
pnpm qualification:demo:check
```

The repository's ordinary test suite also validates the qualification schemas, demos, evidence
bundles and historical acceptance registries.
