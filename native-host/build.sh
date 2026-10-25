#!/bin/bash
set -euo pipefail

# Build Arclike.app for other Macs and package it as a DMG in dist/.
#
# Usage:
#   ./build.sh               # build a universal app, sign it, and make the DMG
#   ./build.sh --notarize    # also notarize and staple the DMG (needs a Developer ID)
#
# SIGNING_IDENTITY picks the code signing identity. Without it the script uses the first of:
#   1. A "Developer ID Application" certificate. After notarization, Gatekeeper opens the app
#      without a warning.
#   2. "Arclike Local Signing" from create-signing-identity.sh. Gatekeeper blocks the first
#      launch, but every build has the same designated requirement, so the Accessibility
#      permission stays granted across updates.
#   3. An ad hoc signature. Gatekeeper blocks the first launch, and the Accessibility
#      permission must be granted again after every update.
#
# NOTARY_PROFILE names the notarytool credentials in the keychain (default "Arclike"). Store
# them once with: xcrun notarytool store-credentials Arclike --apple-id ... --team-id ...
#
# create-dmg (brew install create-dmg) gives the DMG a background and icon layout. Without it,
# the script makes a plain DMG with hdiutil.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Arclike"
BINARY_NAME="arclike"
RELEASE_DIR="$PROJECT_DIR/dist/release"
APP_BUNDLE="$RELEASE_DIR/$APP_NAME.app"
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$SCRIPT_DIR/Info.plist")
DMG_PATH="$PROJECT_DIR/dist/$APP_NAME-$VERSION.dmg"
NOTARY_PROFILE="${NOTARY_PROFILE:-Arclike}"

NOTARIZE=false
for arg in "$@"; do
    case "$arg" in
        --notarize) NOTARIZE=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

# The app reports APP_VERSION to the extension, and Info.plist names the DMG.
CODE_VERSION=$(sed -n 's/^let APP_VERSION = "\(.*\)"$/\1/p' "$SCRIPT_DIR/Sources/arclike/main.swift")
if [ "$CODE_VERSION" != "$VERSION" ]; then
    echo "ERROR: Info.plist says $VERSION, but APP_VERSION in main.swift says $CODE_VERSION."
    exit 1
fi

# Signed by fingerprint, so that two certificates with the same name do not make it ambiguous.
find_identity() {
    security find-identity -v -p codesigning | grep -F "\"$1" | awk 'NR == 1 { print $2 }' || true
}
if [ -z "${SIGNING_IDENTITY:-}" ]; then
    SIGNING_IDENTITY=$(find_identity "Developer ID Application")
    [ -n "$SIGNING_IDENTITY" ] || SIGNING_IDENTITY=$(find_identity "Arclike Local Signing\"")
    [ -n "$SIGNING_IDENTITY" ] || SIGNING_IDENTITY="-"
fi
IDENTITY_NAME="ad hoc"
if [ "$SIGNING_IDENTITY" != "-" ]; then
    IDENTITY_NAME=$(security find-identity -v -p codesigning | grep -F "$SIGNING_IDENTITY" | sed 's/.*"\(.*\)".*/\1/' | head -1 || true)
    IDENTITY_NAME="${IDENTITY_NAME:-$SIGNING_IDENTITY}"
fi
DEVELOPER_ID=false
[[ "$IDENTITY_NAME" == "Developer ID Application"* ]] && DEVELOPER_ID=true
if $NOTARIZE && ! $DEVELOPER_ID; then
    echo "ERROR: --notarize needs a Developer ID Application certificate, not '$IDENTITY_NAME'."
    exit 1
fi

echo "==> Building a universal release binary (v$VERSION)..."
cd "$SCRIPT_DIR"
swift build -c release --arch arm64 --arch x86_64
BIN_DIR=$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)

echo "==> Assembling $APP_NAME.app..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$APP_BUNDLE/Contents/Frameworks"
cp Info.plist "$APP_BUNDLE/Contents/Info.plist"
cp "$BIN_DIR/$BINARY_NAME" "$APP_BUNDLE/Contents/MacOS/$BINARY_NAME"
xcrun actool AppIcon.icon \
    --compile "$APP_BUNDLE/Contents/Resources" \
    --output-partial-info-plist "$(mktemp -d)/icon.plist" \
    --app-icon AppIcon --include-all-app-icons \
    --enable-on-demand-resources NO \
    --development-region en \
    --target-device mac \
    --minimum-deployment-target 26.0 \
    --platform macosx >/dev/null
FRAMEWORK_SRC=$(find "$BIN_DIR" .build/artifacts -path '*/Sparkle.framework' -type d -prune 2>/dev/null | head -1)
if [ -z "$FRAMEWORK_SRC" ]; then
    echo "ERROR: Sparkle.framework not found in .build. Run 'swift package resolve' first."
    exit 1
fi
cp -R "$FRAMEWORK_SRC" "$APP_BUNDLE/Contents/Frameworks/"
install_name_tool -add_rpath @executable_path/../Frameworks "$APP_BUNDLE/Contents/MacOS/$BINARY_NAME" 2>/dev/null || true

echo "==> Signing with '$IDENTITY_NAME'..."
# Notarization needs a secure timestamp, and only a Developer ID signature can get one.
TIMESTAMP=()
$DEVELOPER_ID && TIMESTAMP=(--timestamp)
# Inside out: Sparkle's nested helpers, the framework, then the app.
SPARKLE="$APP_BUNDLE/Contents/Frameworks/Sparkle.framework/Versions/B"
codesign --force --options runtime ${TIMESTAMP[@]+"${TIMESTAMP[@]}"} --sign "$SIGNING_IDENTITY" \
    "$SPARKLE/XPCServices/Downloader.xpc" \
    "$SPARKLE/XPCServices/Installer.xpc" \
    "$SPARKLE/Autoupdate" \
    "$SPARKLE/Updater.app" \
    "$APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
codesign --force --options runtime ${TIMESTAMP[@]+"${TIMESTAMP[@]}"} --entitlements entitlements.plist \
    --sign "$SIGNING_IDENTITY" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"
codesign -d -r- "$APP_BUNDLE" 2>&1 | sed -n 's/^designated => /   Designated requirement: /p'

echo "==> Creating $(basename "$DMG_PATH")..."
rm -f "$DMG_PATH"
STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT
ditto "$APP_BUNDLE" "$STAGE_DIR/$APP_NAME.app"
if command -v create-dmg >/dev/null; then
    create-dmg \
        --volname "$APP_NAME" \
        --volicon "$APP_BUNDLE/Contents/Resources/AppIcon.icns" \
        --background "$SCRIPT_DIR/dmg-background.png" \
        --window-pos 200 120 \
        --window-size 660 400 \
        --icon-size 160 \
        --icon "$APP_NAME.app" 180 200 \
        --hide-extension "$APP_NAME.app" \
        --app-drop-link 480 200 \
        --no-internet-enable \
        "$DMG_PATH" "$STAGE_DIR/"
else
    ln -s /Applications "$STAGE_DIR/Applications"
    hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
fi
if $DEVELOPER_ID; then
    codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG_PATH"
fi

if $NOTARIZE; then
    echo "==> Notarizing (this can take a few minutes)..."
    xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG_PATH"
    spctl --assess --type open --context context:primary-signature -v "$DMG_PATH"
fi

echo "==> Done."
echo "   App: $APP_BUNDLE"
echo "   DMG: $DMG_PATH"
echo "   SHA-256: $(shasum -a 256 "$DMG_PATH" | awk '{ print $1 }')"
