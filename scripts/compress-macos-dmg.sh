#!/bin/bash
set -euo pipefail

if [[ $# != 1 || ! -f "$1" ]]; then
  echo "Usage: bash scripts/compress-macos-dmg.sh <installer.dmg>" >&2
  exit 2
fi
dmg=$1

disk_sha256() {
  /usr/bin/hdiutil checksum -type SHA256 -plist "$1" |
    /usr/bin/plutil -extract 'Checksum Value' raw -o - -
}

source_format=$(/usr/bin/hdiutil imageinfo -format "$dmg")
if [[ "$source_format" == ULMO ]]; then
  # A retry must preserve any ticket already stapled to the final image.
  /usr/bin/hdiutil verify -quiet "$dmg"
  echo "Verified existing ULMO installer $dmg"
  exit 0
fi

# Stage beside the original so the final rename is atomic.
stage_dir=$(mktemp -d "$(dirname "$dmg")/.rovai-dmg.XXXXXX")
trap 'rm -rf "$stage_dir"' EXIT
candidate="$stage_dir/installer.dmg"

original_sha=$(disk_sha256 "$dmg")
/usr/bin/hdiutil convert "$dmg" -format ULMO -o "$candidate" -quiet
/usr/bin/hdiutil verify -quiet "$candidate"
candidate_format=$(/usr/bin/hdiutil imageinfo -format "$candidate")
candidate_sha=$(disk_sha256 "$candidate")
if [[ "$candidate_format" != ULMO || ! "$original_sha" =~ ^\$?[[:xdigit:]]{64}$ || "$candidate_sha" != "$original_sha" ]]; then
  echo "Converted DMG failed its format or whole-disk SHA-256 check" >&2
  exit 1
fi

original_size=$(/usr/bin/stat -f %z "$dmg")
candidate_size=$(/usr/bin/stat -f %z "$candidate")
/bin/mv -f "$candidate" "$dmg"
printf 'Converted %s from %s to ULMO (%s to %s bytes). Disk SHA-256 %s\n' \
  "$dmg" "$source_format" "$original_size" "$candidate_size" "$original_sha"
