#!/usr/bin/env bash
# Build, install and test the Windows app on the headless Windows box, from the Mac.
#   native-host-windows/test/remote-test.sh            protocol test and the smoke scenario
#   native-host-windows/test/remote-test.sh smoke ...  named scenarios from test/scenarios
# Needs an SSH host entry (default name arclike-win, or set ARCLIKE_WIN_HOST) and a one-time run
# of test/Register-InteractiveRunner.ps1 on the box. See docs/windows-port.md, sections 7 and 8.
set -euo pipefail

HOST="${ARCLIKE_WIN_HOST:-arclike-win}"
ROOT="$(git rev-parse --show-toplevel)"
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(smoke)
PS="powershell -NoProfile -ExecutionPolicy Bypass"

# Copy the working tree, uncommitted changes included, as one tar file.
REF="$(git -C "$ROOT" stash create)"
REF="${REF:-HEAD}"
TAR="$(mktemp -t arclike-src).tar"
trap 'rm -f "$TAR"' EXIT
git -C "$ROOT" archive --format=tar -o "$TAR" "$REF"
ssh "$HOST" "$PS -Command \"New-Item -ItemType Directory -Force C:\\arclike | Out-Null; Remove-Item -Recurse -Force C:\\arclike\\src -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:\\arclike\\src | Out-Null\""
scp -q "$TAR" "$HOST:C:/arclike/src.tar"
ssh "$HOST" "tar -x -f C:/arclike/src.tar -C C:/arclike/src"

echo "== install"
ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\install-local.ps1"

echo "== protocol"
ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\test\\Test-Protocol.ps1"

status=0
for scenario in "${SCENARIOS[@]}"; do
    echo "== scenario $scenario"
    ssh "$HOST" "$PS -File C:\\arclike\\src\\native-host-windows\\test\\Invoke-Interactive.ps1 -ScriptPath C:\\arclike\\src\\native-host-windows\\test\\scenarios\\$scenario.ps1" || status=1
done

RESULTS="$ROOT/native-host-windows/test/results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS"
scp -q -r "$HOST:C:/arclike/test/out/*" "$RESULTS/" || true
echo "Results in $RESULTS"
exit $status
