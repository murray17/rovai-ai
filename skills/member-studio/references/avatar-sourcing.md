# Avatar sourcing

An avatar identifies a member; it does not establish responsibilities, permissions, Runtime, or team authority.

## Timing and file handling

Present the visual plan before card confirmation. After confirmation, generate, download, or prepare the file in the current AgentRun and pass it promptly to `rovai member create`.

Prefer a separate file under `ROVAI_RUN_TMP` when available, or another controlled temporary directory readable by Core in this Run. Do not assume temporary files survive between Runs.

Pass the local path through `--avatar-file`. Do not write directly to `userData/member-avatars/` or use a remote URL as `avatarRef`. The product decodes, strips metadata, resizes, crops, and stores the managed asset.

## Image requirements

- Static PNG or JPEG, at least 256 x 256, within the product byte limit.
- Prefer a 4:5 portrait at 1024 x 1280, with head and shoulders or upper body centered slightly above the middle.
- Leave crop space; use a simple background without text, logos, watermarks, or complex borders.
- Keep the central subject suitable for a square avatar.

## Original generation

Follow the confirmed visual preference, name, role, and traits. Default to illustration, semi-realistic art, or the product's specified style; avoid a default likeness that could be mistaken for a real photograph.

For public or historical figures, use public professional references without claiming to reproduce the real person. For fictional characters, preserve requested qualities without copying a particular film, game, or illustration design.

Include the reference or name, role, 2-3 work traits, dimensions, framing, crop space, simple background, and exclusions above in the generation prompt. Optional Rovai details, such as warm lamps, travel gear, or badge motifs, should support distinct identities rather than make everyone share one costume or profession.

## Source online

Use available, authorized search or network capabilities when the user chooses this method or generation is unavailable. Prefer:

1. The user's specified official source.
2. Public-domain or explicitly reusable collections.
3. Other sources with a clear source page and license.

Download the original static image, not a search thumbnail or unknown CDN hotlink. Retain the source page and available author, institution, license, or usage information. If provenance or permission is unclear, choose another image or omit the avatar.

## Fallback

The default order is original generation, sourced image, then default avatar. Use only capabilities actually available and authorized. Without image capability, omit `--avatar-file` and report the default avatar; never invent a path, URL, or result. A changed avatar plan follows the card confirmation rule.

## Validate

Visually check a square crop using the image's shorter side, horizontally centered. For a 4:5 portrait, start about 3%-8% below the top. Keep the head, chin, and identifying features visible. The product creates the 192 x 192 icon; a finished icon file is unnecessary.

Before creation, verify the readable static PNG/JPEG, dimensions and bytes against `rovai member create --help`, crop, and current-Run path. Match the confirmed identity without inferring identity facts from the image.
