# Verification Workflow

Verification must test both technical correctness and visual quality.

## Technical Checks

Run feasible checks:

- build/typecheck
- lint or tests relevant to changed files
- syntax checks for scripts
- runtime checks for missing assets or broken imports

State checks that could not run and why.

## Visual Checks

When the app can run, inspect browser output or screenshots.
Check:

- desktop and mobile layout
- text readability and contrast
- chart labels and dense data areas
- hover, focus, active, disabled, empty, loading, and error states
- bilingual or long-text overflow
- whether the first viewport communicates the right task
- whether the result still matches the product

Do not claim visual inspection if only code inspection happened.

## Better-Than-Original Check

Compare against the starting UI:

- What is clearer?
- What is more useful?
- What is more tasteful?
- What became worse?
- Should any design choice be rolled back?
