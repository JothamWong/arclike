#!/bin/bash
set -euo pipefail

# Zip the extension for upload to the Chrome Web Store, as dist/arclike-extension-VERSION.zip.
#
# Usage:
#   ./scripts/package-extension.sh
#
# The zip holds the extension as committed in HEAD, so work in progress stays out of it. It
# leaves out the manifest's "key": the key only fixes the ID of an unpacked copy, and the Store
# gives the item an ID of its own.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

if [ -n "$(git -C "$PROJECT_DIR" status --porcelain -- extension)" ]; then
    echo "Note: extension/ has uncommitted changes. The zip leaves them out."
fi
git -C "$PROJECT_DIR" archive HEAD:extension | tar -x -C "$STAGE_DIR"

# The Store refuses a name over 75 characters or a description over 132.
VERSION=$(python3 - "$STAGE_DIR/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    manifest = json.load(f)
for field, limit in (("name", 75), ("short_name", 12), ("description", 132)):
    if len(manifest.get(field, "")) > limit:
        sys.exit("ERROR: the manifest %s has %d characters. The Store allows %d."
                 % (field, len(manifest[field]), limit))
manifest.pop("key", None)
with open(path, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
print(manifest["version"])
PY
)

ZIP_PATH="$PROJECT_DIR/dist/arclike-extension-$VERSION.zip"
mkdir -p "$PROJECT_DIR/dist"
rm -f "$ZIP_PATH"
(cd "$STAGE_DIR" && zip -qrX "$ZIP_PATH" .)

echo "Extension $VERSION: $ZIP_PATH"
unzip -l "$ZIP_PATH" | tail -n +4 | sed '$d' | sed '$d' | awk '{ print "   " $4 }'
