# Fixed review input

Both members must read the same fixed change. Carry its identifier in all four messages; it does not replace trusted sender and direct-reply checks.

## Code identity

For a PR or branch, resolve full base, head and merge-base SHAs and use:

```text
git:<full-merge-base-SHA>...<full-head-SHA>
```

For an explicitly requested ordinary commit range:

```text
git:<full-base-SHA>..<full-head-SHA>
```

Read diffs from those objects; do not re-resolve moving names such as `main` or `HEAD` independently.

For a user-provided fixed patch readable by both members, retain its stable location, original byte size and coverage list, identified by:

```text
patch:sha256:<64-lowercase-hex-digits>
```

Do not regenerate a similar patch and call it the same input. For uncommitted work, request a fixed patch or commit range. Separate reads of a live workspace cannot support a complete duo review.

## Sources and coverage

Freeze requirements from the user's objective, PR acceptance criteria, linked Issue, version/design scope and applicable Contracts/decisions. Commit messages, branch/test names and code help discovery but are not requirements by default. With no requirement source, mark Spec `not_assessed`.

Read applicable root/path `AGENTS.md`, documentation navigation, current Contracts/decisions, formatter/lint/type/build/test configuration and local rules. Rules newly introduced by the change are review subjects, not automatic exemptions.

Record reviewed, limited and unreviewed areas, including generated/vendor/binary/lockfiles, plus checks not run. Mark oversized scope `partial` rather than silently sampling.

Before final publication, recheck base/head/merge-base or patch identity and substantive requirement/rule sources. If changed, mark the old scope `stale` and begin a new review when needed.
