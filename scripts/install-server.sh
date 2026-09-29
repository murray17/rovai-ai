#!/bin/sh
# Native package installer. No Node, Rust compiler, Desktop, or service manager.
set -eu
umask 077
fail() { printf 'Rovai Server: %s\n' "$*" >&2; exit 1; }
version=latest
release_tag=
from_dir=
prefix="${HOME:?Current account HOME is required}/.local/share/rovai-server"
bin_dir="$HOME/.local/bin"
modify_path=yes
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version|--from-dir|--prefix|--bin-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in --version) version=$2;; --from-dir) from_dir=$2;; --prefix) prefix=$2;; --bin-dir) bin_dir=$2;; esac
      shift 2;;
    --no-modify-path) modify_path=no; shift;;
    --help) printf '%s\n' 'install-server.sh [--version VERSION] [--from-dir RELEASE_DIRECTORY] [--prefix PROGRAM_DIRECTORY] [--bin-dir COMMAND_DIRECTORY] [--no-modify-path]'; exit 0;;
    *) fail "Unknown option: $1";;
  esac
done
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) target=macos-arm64; os=mac;; Darwin:x86_64) target=macos-x64; os=mac;;
  Linux:x86_64) target=linux-x64; os=linux;;
  *) fail 'Unsupported native OS/architecture. Windows uses install-server.ps1.';;
esac
for path in "$prefix" "$bin_dir"; do
  case "$path" in /*) ;; *) fail 'Installation paths must be absolute';; esac
  case "$path" in *:*|*"'"*|*'
'*|*/../*|*/./*|*/..|*/.) fail 'Unsupported installation path';; esac
done
command -v curl >/dev/null 2>&1 || [ -n "$from_dir" ] || fail 'curl is required for GitHub downloads'
download() { curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 600 "$1" -o "$2"; }
staging=$(mktemp -d "${TMPDIR:-/tmp}/rovai-server-install.XXXXXX")
locked=no
cleanup() { rm -rf "$staging"; if [ "$locked" = yes ]; then rm -rf "$prefix/.install-lock"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
if [ "$version" = latest ]; then
  [ -z "$from_dir" ] || fail '--from-dir requires --version'
  download 'https://raw.githubusercontent.com/murray17/rovai-ai/main/scripts/server-release-tag.txt' "$staging/channel"
  release_tag=$(cat "$staging/channel")
  [ "$release_tag" != unpublished ] || fail 'No official native Server release is published yet. The installation was not changed.'
  case "$release_tag" in
    server-v*) version=${release_tag#server-v};;
    v*) version=${release_tag#v};;
    *) fail 'Invalid Server release tag';;
  esac
else
  case "$version" in
    0.4.0|0.4.1) release_tag="server-v$version";;
    *) release_tag="v$version";;
  esac
fi
printf '%s\n' "$version" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || fail 'Invalid Server version'
case "$release_tag" in "v$version"|"server-v$version") ;; *) fail 'Invalid Server release tag';; esac
asset="rovai-server-$version-$target.tar.gz"
if [ -n "$from_dir" ]; then
  cp "$from_dir/$asset" "$staging/$asset"
  cp "$from_dir/SHA256SUMS" "$staging/SHA256SUMS"
else
  release="https://github.com/murray17/rovai-ai/releases/download/$release_tag"
  download "$release/$asset" "$staging/$asset"
  download "$release/SHA256SUMS" "$staging/SHA256SUMS"
fi
expected=$(awk -v asset="$asset" '$2 == asset { print $1; count++ } END { if (count != 1) exit 1 }' "$staging/SHA256SUMS") || fail 'Missing or duplicate archive checksum'
printf '%s\n' "$expected" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$' || fail 'Invalid SHA-256 checksum'
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$staging/$asset" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$staging/$asset" | cut -d ' ' -f 1)
else fail 'sha256sum or shasum is required'; fi
[ "$actual" = "$expected" ] || fail 'Archive checksum mismatch; installation unchanged'
# Release archives have one root and only regular files/directories. Check every
# member before extracting, including links and traversal components.
tar -tzf "$staging/$asset" > "$staging/members"
LC_ALL=C awk 'BEGIN { ok=1 } !/^rovai-server\/[A-Za-z0-9_.\/-]*$/ || /(^|\/)\.\.?($|\/)/ { ok=0 } END { exit !ok }' "$staging/members" || fail 'Unsafe archive path'
tar -tvzf "$staging/$asset" > "$staging/types"
LC_ALL=C awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" { bad=1 } END { exit bad }' "$staging/types" || fail 'Archive links or special files are not allowed'
tar -xzf "$staging/$asset" -C "$staging"
payload="$staging/rovai-server"
grep -qx "version=$version" "$payload/package-info" && grep -qx "target=$target" "$payload/package-info" || fail 'Package version or target mismatch'
[ -f "$payload/web-ui/index.html" ] && [ -f "$payload/skills/cli-operations/SKILL.md" ] && [ -x "$payload/rovai-server" ] || fail 'Incomplete package'
[ "$("$payload/rovai-server" --version)" = "rovai-server $version" ] || fail 'Host/package version mismatch'
# Claim only a new directory or an installation already owned by this installer.
if [ -e "$prefix" ] || [ -L "$prefix" ]; then
  [ -d "$prefix" ] && [ ! -L "$prefix" ] && [ -f "$prefix/INSTALLER-V1" ] && [ ! -L "$prefix/INSTALLER-V1" ] || fail 'Program directory is not an installer-owned installation'
  [ "$(cat "$prefix/INSTALLER-V1")" = rovai-server ] || fail 'Unknown installation owner'
else mkdir -p "$prefix"; printf '%s\n' rovai-server > "$prefix/INSTALLER-V1"; fi
mkdir "$prefix/.install-lock" 2>/dev/null || fail 'Another installation is in progress'
locked=yes
mkdir -p "$bin_dir"
command_path="$bin_dir/rovai-server"
if [ -e "$command_path" ] || [ -L "$command_path" ]; then
  [ -L "$command_path" ] && [ "$(readlink "$command_path")" = "$prefix/current/rovai-server" ] || fail 'Existing rovai-server command belongs to another installation'
fi
[ ! -L "$prefix/revisions" ] || fail 'Invalid revisions directory'
mkdir -p "$prefix/revisions"
revision="$prefix/revisions/$expected"
if [ -e "$revision" ] || [ -L "$revision" ]; then
  [ -d "$revision" ] && [ ! -L "$revision" ] || fail 'Invalid installed revision'
  diff -qr "$payload" "$revision" >/dev/null || fail 'Installed revision differs from the verified package'
else
  # Copy into the same filesystem before the atomic directory rename.
  cp -R "$payload" "$prefix/.install-lock/payload"
  mv "$prefix/.install-lock/payload" "$revision"
fi
replace_link() {
  if [ "$os" = mac ]; then mv -fh "$1" "$2"; else mv -fT "$1" "$2"; fi
}
if [ -e "$prefix/current" ] && [ ! -L "$prefix/current" ]; then fail 'Current program entry is not a managed link'; fi
ln -s "revisions/$expected" "$prefix/.install-lock/current"
replace_link "$prefix/.install-lock/current" "$prefix/current"
if [ ! -L "$command_path" ]; then ln -s "$prefix/current/rovai-server" "$command_path"; fi
if [ "$modify_path" = yes ]; then
  # Add a guarded entry once per common shell; do not execute user profiles.
  path_line="case :\$PATH: in *:'$bin_dir':*) ;; *) export PATH='$bin_dir':\$PATH ;; esac # rovai-server PATH"
  for profile in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "${ZDOTDIR:-$HOME}/.zshrc"; do
    if ! grep -Fqx "$path_line" "$profile" 2>/dev/null; then printf '\n%s\n' "$path_line" >> "$profile"; fi
  done
  printf 'Open a new terminal, or run: export PATH=%s:$PATH\n' "'$bin_dir'"
fi
printf 'Installed Rovai Server %s (%s). Run rovai-server. Data is selected at launch with --data-dir; installation does not open it.\n' "$version" "$target"
