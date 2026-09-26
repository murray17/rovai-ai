#!/usr/bin/env bash
# Gate A in Debian's own kernel/userspace, using the same release archive as Ubuntu.
set -euo pipefail
repository=$(cd "$(dirname "$0")/.." && pwd)
assets=$(realpath "$1")
source_sha=$2
output=$(realpath -m "$3")
fixture=$(mktemp -d)
vm_pid=''
cleanup() {
  if [[ -n "$vm_pid" ]]; then kill "$vm_pid" 2>/dev/null || true; wait "$vm_pid" 2>/dev/null || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT
image_base=https://cloud.debian.org/images/cloud/bookworm/latest
image_name=debian-12-genericcloud-amd64.qcow2
curl --fail --location --retry 3 "$image_base/SHA512SUMS" -o "$fixture/SHA512SUMS"
curl --fail --location --retry 3 "$image_base/$image_name" -o "$fixture/$image_name"
python3 - "$fixture" "$image_name" <<'PY'
import hashlib, pathlib, sys
root, name = pathlib.Path(sys.argv[1]), sys.argv[2]
entries = [line.split() for line in (root / 'SHA512SUMS').read_text().splitlines()]
expected = [digest for digest, filename in entries if filename.lstrip('*./') == name]
assert len(expected) == 1
digest = hashlib.sha512()
with (root / name).open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
assert digest.hexdigest() == expected[0], 'Debian image hash mismatch'
PY
ssh-keygen -q -t ed25519 -N '' -f "$fixture/key"
cat > "$fixture/user-data" <<EOF
#cloud-config
users:
  - name: rovai
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$fixture/key.pub")
ssh_pwauth: false
disable_root: true
EOF
printf 'instance-id: rovai-linux-gate\nlocal-hostname: rovai-linux-gate\n' > "$fixture/meta-data"
cloud-localds "$fixture/seed.img" "$fixture/user-data" "$fixture/meta-data"
qemu-img resize "$fixture/$image_name" 5G
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
accel=tcg
if [[ -r /dev/kvm && -w /dev/kvm ]]; then accel=kvm; fi
qemu-system-x86_64 -accel "$accel" -m 2048 -smp 2 -nographic -snapshot \
  -drive "file=$fixture/$image_name,if=virtio" -drive "file=$fixture/seed.img,format=raw,if=virtio" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$port-:22" -device virtio-net-pci,netdev=net0 \
  > "$fixture/console.log" 2>&1 &
vm_pid=$!
ssh_options=(-i "$fixture/key" -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$fixture/known_hosts")
ready=0
for attempt in $(seq 1 120); do
  if ssh "${ssh_options[@]}" -p "$port" rovai@127.0.0.1 true 2>/dev/null; then ready=1; break; fi
  if ! kill -0 "$vm_pid" 2>/dev/null; then break; fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then tail -80 "$fixture/console.log"; exit 1; fi
scp "${ssh_options[@]}" -P "$port" -r "$assets" rovai@127.0.0.1:assets
scp "${ssh_options[@]}" -P "$port" "$repository/scripts/install-server.sh" "$repository/scripts/smoke-linux-server.py" rovai@127.0.0.1:
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$repository/package.json")
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ && "$source_sha" =~ ^[0-9a-f]{40}$ ]]
ssh "${ssh_options[@]}" -p "$port" rovai@127.0.0.1 \
  "sh install-server.sh --version '$version' --from-dir /home/rovai/assets --no-modify-path && python3 smoke-linux-server.py /home/rovai/.local/share/rovai-server/current --expected-source '$source_sha' --startup-timeout 90 --output /home/rovai/debian-12.json"
mkdir -p "$(dirname "$output")"
scp "${ssh_options[@]}" -P "$port" rovai@127.0.0.1:debian-12.json "$output"
