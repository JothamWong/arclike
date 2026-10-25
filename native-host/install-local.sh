#!/bin/bash
set -euo pipefail

# Build the app from source and install it over /Applications/Tab Switcher.app, for use with
# the extension loaded unpacked from this checkout.
#
# Usage:
#   ./install-local.sh [EXTENSION_ID]
#
# EXTENSION_ID defaults to the ID Chrome gives an unpacked extension loaded from this
# checkout's root folder. It is added to the native messaging host's allowed origins.
#
# SIGNING_IDENTITY picks the code signing identity. Signing with the same identity on every
# build keeps the Accessibility permission across rebuilds. "-" signs ad hoc, which needs the
# permission granted again after each install.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Tab Switcher.app"
INSTALLED_APP="/Applications/$APP_NAME"
STAGED_APP="$PROJECT_DIR/dist/$APP_NAME"
BINARY_NAME="tab-switcher"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-gdb-cert}"
CONFIG="$HOME/Library/Application Support/TabSwitcher/browser_config.json"
HOST_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tabswitcher.native.json"

DEFAULT_ID=$(printf '%s' "$PROJECT_DIR" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')
EXTENSION_ID="${1:-$DEFAULT_ID}"

echo "==> Building release binary..."
cd "$SCRIPT_DIR"
swift build -c release

echo "==> Staging app bundle..."
# The bundle's Info.plist and icons are not in the repo, so the installed app is the template.
if [ ! -d "$STAGED_APP" ]; then
    mkdir -p "$PROJECT_DIR/dist"
    ditto "$INSTALLED_APP" "$STAGED_APP"
fi
cp ".build/release/$BINARY_NAME" "$STAGED_APP/Contents/MacOS/$BINARY_NAME"
FRAMEWORK_SRC=$(find .build -path '*/Sparkle.framework' -type d | head -1)
rm -rf "$STAGED_APP/Contents/Frameworks/Sparkle.framework"
cp -R "$FRAMEWORK_SRC" "$STAGED_APP/Contents/Frameworks/"
install_name_tool -add_rpath @executable_path/../Frameworks "$STAGED_APP/Contents/MacOS/$BINARY_NAME" 2>/dev/null || true

# A Sparkle update would replace this build with the upstream release.
/usr/libexec/PlistBuddy -c "Delete :SUEnableAutomaticChecks" "$STAGED_APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :SUEnableAutomaticChecks bool false" "$STAGED_APP/Contents/Info.plist"

echo "==> Signing with '$SIGNING_IDENTITY'..."
codesign --force --deep --sign "$SIGNING_IDENTITY" "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"

echo "==> Installing to $INSTALLED_APP..."
# Chrome starts the app as its native messaging host and reconnects within a second.
pkill -f "$INSTALLED_APP/Contents/MacOS/$BINARY_NAME" || true
rm -rf "$INSTALLED_APP"
ditto "$STAGED_APP" "$INSTALLED_APP"

echo "==> Allowing extension $EXTENSION_ID..."
# The app rewrites the host manifest from its config, so the ID goes in both places.
python3 - "$CONFIG" "$HOST_MANIFEST" "$EXTENSION_ID" <<'EOF'
import json, sys
config_path, manifest_path, ext_id = sys.argv[1:]
with open(config_path) as f:
    config = json.load(f)
for browser in config:
    if browser["id"] == "com.google.Chrome":
        browser["extensionId"] = ext_id
with open(config_path, "w") as f:
    json.dump(config, f)
with open(manifest_path) as f:
    manifest = json.load(f)
origin = "chrome-extension://%s/" % ext_id
if origin not in manifest["allowed_origins"]:
    manifest["allowed_origins"].append(origin)
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)
EOF

echo "==> Done. Reload the extension in chrome://extensions to reconnect."
