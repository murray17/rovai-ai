# Final notes

Publish once, using each member's last valid position. Use complete round-2 views where available; otherwise retain confirmed round-1 views and mark incomplete responses. Mark missing contributors incomplete without writing their views for them.

Call a position consensus only when all valid contributors explicitly support it or earlier opponents have revised their view. Label a majority preference as a current tendency. Record why no response round was needed rather than inventing opposition.

Use the user's language for this structure:

```markdown
### Campfire notes
Topic: <preserve the user's request>

Participants:
- <member>: <perspective>; complete | incomplete | response incomplete

Final views:
- <member>: <1-2 sentence judgment>; main evidence; key limit; confidence

Consensus: <agreed points, or none>
Current tendency: <majority preference, or none>
Remaining disagreement:
- <issue; each position; fact/prediction/boundary/value; evidence or user decision needed>

Applicability: <conditions that change the recommendation; unresolved facts>
Process: <no response round and why, or the one disagreement and invited members>

Next steps: ...
User decisions needed: <items, or none>
```

Add a separate Default Lead judgment only when requested: recommendation, strength, and what could change it. It is not group consensus.

Publish with `rovai send --public-only --body <notes>`. Publication ends the discussion. Notes do not automatically create Tasks, Memory, version decisions or implementation work; late messages do not restart it.
