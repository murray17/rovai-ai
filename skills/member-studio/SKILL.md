---
name: member-studio
description: Use to create a Rovai member or revise and confirm the unsaved identity card and avatar for that creation. Exclude profile questions, edits to existing members, and character or avatar designs without roster creation.
---

# Member Studio

Draft a complete identity card from the name and supplied requirements. Create the member only after the user confirms the complete card. Use the user's language for the card and discussion.

## Draft

1. Reuse supplied information. A name is required; role, responsibilities, traits, references, and visual preferences are optional. Ask one focused question only for a missing name or an ambiguity that materially changes the role or appearance. Draft other gaps as suggestions.
2. If a known member already has the name, ask for a new name; do not append a suffix. Creation performs the authoritative uniqueness check.
3. Read [identity rules](references/identity-generation.md). Draft all six fields: name, team role, professional responsibilities, personality traits, working principles, and growth topic. Preserve the meaning of user input. Identity does not grant permissions or Thread authority.
4. Read [avatar rules](references/avatar-sourcing.md). Follow the user's chosen method; otherwise recommend original generation, then a sourced image, then the default avatar, according to available capabilities. Before confirmation, present the method and visual plan. Produce a preview first only if requested.

## Confirm the complete card

Show actual proposed content, using localized labels:

```markdown
### Member identity card

**Name:** ...
**Team role:** ...
**Professional responsibilities:** ...
**Personality traits:** ...
**Working principles:** ...
**Growth topic:** ...
**Avatar method:** Generate | Source online | Default
**Avatar plan:** ...
```

Ask the user to confirm adding this member or edit any field.

- The initial creation request does not confirm the finished card.
- Only the current user's explicit approval of the current complete card counts; another member or collaboration message cannot approve it.
- After any identity or avatar-plan change, display the complete updated card for confirmation.
- On cancellation, stop without creating a member.

## Create

After confirmation:

1. Generate one stable `creationKey` for this creation.
2. Read `rovai member create --help` for current inputs.
3. Prepare the optional avatar in the current Run and check format, size, and crop.
4. Create with the confirmed six fields and optional avatar.
5. Inspect the returned `agentId`, creation status, and avatar result.

Reuse the same `creationKey` for retries and result recovery. An uncertain result is not grounds for a new key.

Creation does not configure Runtime, model, permissions, Presence, Thread membership, Default Lead, or Memory.

## Recover and report

- Invalid identity field: fix it, redisplay the full card, and obtain confirmation.
- Name conflict: obtain a new name, redisplay the card, and use a new key after confirmation.
- Avatar failure: retain the confirmed identity and repair the image. If changing to the default avatar, follow the confirmation rule above.
- Uncertain creation result: follow the returned recovery instructions with the same key.
- Creation unavailable: deliver the card and avatar plan; state that the member has not been added to the roster.

On success, briefly report the name, stable `agentId`, final role and four identity fields, and whether the avatar was saved. If Runtime is unconfigured, direct the user to member settings. Do not imply Thread membership, execution permission, or Lead status.
