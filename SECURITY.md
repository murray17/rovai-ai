# Security Policy

Thanks for helping keep Rovai AI and its users safe.

## Report a vulnerability privately

Please do **not** open a public Issue or Pull Request with vulnerability details.

Use GitHub's private vulnerability reporting form:

```text
https://github.com/murray17/rovai-ai/security/advisories/new
```

If the form is unavailable, open a public Issue titled `Security contact request` without technical
details, logs, screenshots, or reproduction steps. A maintainer will provide a private channel.

## Helpful information

A useful report includes:

- the affected Rovai release or commit;
- operating system and architecture;
- the affected Agent Runtime and exact version, when relevant;
- clear reproduction steps using test data;
- expected and observed behavior;
- possible impact;
- redacted logs or screenshots when needed.

Please remove credentials, tokens, personal paths, private prompts, unrelated model output, and
user data.

## Especially relevant issues

Please report problems such as:

- approval or permission bypass;
- data leaking across Camps, members, Sessions, or workspaces;
- path traversal, symlink escape, or attachment-root escape;
- secrets or private paths appearing in messages, diagnostics, evidence, or exports;
- built-in `rovai` CLI or private IPC authorization bypass;
- Runtime configuration, MCP, Skill, or credential isolation failures;
- cancellation or recovery repeating an external action whose result is unknown;
- packaged-app or update integrity problems.

A poor model answer, an unsupported Runtime, or expected behavior after the user explicitly enables
the highest permission mode is usually not a security vulnerability unless Rovai widened or
misrepresented that permission.

## What happens next

We will review the report, try to reproduce it, and keep the reporter informed while a fix or
mitigation is prepared.

Please allow reasonable time for investigation before publishing details. We are happy to
coordinate disclosure and credit after the issue is resolved.

## Supported versions

Rovai AI is currently pre-release. Security fixes are made against the current `main` branch and,
after public releases begin, the latest public release. Older pre-release builds may require an
upgrade to receive a fix.
