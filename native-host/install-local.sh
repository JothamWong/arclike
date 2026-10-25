#!/bin/bash
set -euo pipefail

# Build Arclike from source, install it as /Applications/Arclike.app, and register it as
# Chrome's native messaging host for the extension in ../extension.
#
# Usage:
#   ./install-local.sh
#
# SIGNING_IDENTITY picks the code signing identity. By default the identity made by
# create-signing-identity.sh is used when it exists, which keeps the Accessibility permission
# across rebuilds. Without it the app is signed ad hoc, and the permission must be granted
# again after every install.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Arclike"
APP_ID="com.amitrahman1026.arclike"
BINARY_NAME="arclike"
INSTALLED_APP="/Applications/$APP_NAME.app"
STAGED_APP="$PROJECT_DIR/dist/$APP_NAME.app"
CONFIG_DIR="$HOME/Library/Application Support/$APP_NAME"
LEGACY_CONFIG="$HOME/Library/Application Support/TabSwitcher/browser_config.json"
HOST_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$APP_ID.json"
DEFAULT_IDENTITY="Arclike Local Signing"

if [ -z "${SIGNING_IDENTITY:-}" ]; then
    # Signed by fingerprint: an earlier, untrusted certificate of the same name makes the name
    # ambiguous to codesign, and only the trusted one is listed here.
    DEFAULT_HASH=$(security find-identity -v -p codesigning | grep -F "\"$DEFAULT_IDENTITY\"" | awk 'NR == 1 { print $2 }')
    if [ -n "$DEFAULT_HASH" ]; then
        SIGNING_IDENTITY="$DEFAULT_HASH"
    else
        SIGNING_IDENTITY="-"
        echo "Note: signing ad hoc. Run ./create-signing-identity.sh once to keep the"
        echo "      Accessibility permission across rebuilds."
    fi
fi

# The extension's ID follows from the public key in its manifest: the first 32 hex digits of
# the key's SHA-256, written with the letters a to p.
EXTENSION_ID=$(python3 - "$PROJECT_DIR/extension/manifest.json" <<'EOF'
import base64, hashlib, json, sys
key = base64.b64decode(json.load(open(sys.argv[1]))["key"])
print(hashlib.sha256(key).hexdigest()[:32].translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop")))
EOF
)

echo "==> Building release binary..."
cd "$SCRIPT_DIR"
swift build -c release

echo "==> Assembling $APP_NAME.app..."
rm -rf "$STAGED_APP"
mkdir -p "$STAGED_APP/Contents/MacOS" "$STAGED_APP/Contents/Resources" "$STAGED_APP/Contents/Frameworks"
cp Info.plist "$STAGED_APP/Contents/Info.plist"
cp ".build/release/$BINARY_NAME" "$STAGED_APP/Contents/MacOS/$BINARY_NAME"
xcrun actool AppIcon.icon \
    --compile "$STAGED_APP/Contents/Resources" \
    --output-partial-info-plist "$(mktemp -d)/icon.plist" \
    --app-icon AppIcon --include-all-app-icons \
    --enable-on-demand-resources NO \
    --development-region en \
    --target-device mac \
    --minimum-deployment-target 26.0 \
    --platform macosx >/dev/null
FRAMEWORK_SRC=$(find .build -path '*/Sparkle.framework' -type d | head -1)
cp -R "$FRAMEWORK_SRC" "$STAGED_APP/Contents/Frameworks/"
install_name_tool -add_rpath @executable_path/../Frameworks "$STAGED_APP/Contents/MacOS/$BINARY_NAME" 2>/dev/null || true

echo "==> Signing with '$SIGNING_IDENTITY'..."
# Inside out: Sparkle's nested helpers, the framework, then the app.
SPARKLE="$STAGED_APP/Contents/Frameworks/Sparkle.framework/Versions/B"
codesign --force --options runtime --sign "$SIGNING_IDENTITY" \
    "$SPARKLE/XPCServices/Downloader.xpc" \
    "$SPARKLE/XPCServices/Installer.xpc" \
    "$SPARKLE/Autoupdate" \
    "$SPARKLE/Updater.app" \
    "$STAGED_APP/Contents/Frameworks/Sparkle.framework"
codesign --force --options runtime --entitlements entitlements.plist --sign "$SIGNING_IDENTITY" "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"

echo "==> Installing to $INSTALLED_APP..."
# Chrome starts the app as its native messaging host and reconnects within a second.
pkill -f "$INSTALLED_APP/Contents/MacOS/$BINARY_NAME" || true
rm -rf "$INSTALLED_APP"
ditto "$STAGED_APP" "$INSTALLED_APP"

echo "==> Registering the native messaging host for extension $EXTENSION_ID..."
# The app rewrites the host manifest from its config, so the ID goes in both places. A config
# left by Tab Switcher is carried over the first time.
mkdir -p "$CONFIG_DIR" "$(dirname "$HOST_MANIFEST")"
python3 - "$CONFIG_DIR/browser_config.json" "$LEGACY_CONFIG" "$HOST_MANIFEST" "$EXTENSION_ID" \
    "$APP_ID" "$INSTALLED_APP/Contents/MacOS/$BINARY_NAME" <<'EOF'
import json, os, sys
config_path, legacy_path, manifest_path, ext_id, app_id, binary = sys.argv[1:]
config = []
for path in (config_path, legacy_path):
    if os.path.exists(path):
        with open(path) as f:
            config = json.load(f)
        break
chrome = next((b for b in config if b["id"] == "com.google.Chrome"), None)
if chrome is None:
    chrome = {"id": "com.google.Chrome", "name": "Google Chrome", "appName": "Google Chrome",
              "nativeMessagingPath": "Google/Chrome/NativeMessagingHosts", "combineAllWindows": False}
    config.append(chrome)
chrome["isEnabled"] = True
chrome["extensionId"] = ext_id
with open(config_path, "w") as f:
    json.dump(config, f)
with open(manifest_path, "w") as f:
    json.dump({
        "name": app_id,
        "description": "Arclike native helper",
        "path": binary,
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % ext_id],
    }, f, indent=2)
EOF

echo "==> Done. Reload the extension in chrome://extensions to reconnect."
