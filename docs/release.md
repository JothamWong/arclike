# Releasing Arclike to friends

This plan lets a friend use Arclike without Xcode. The extension comes from the Chrome Web Store, and the Mac app comes as a DMG from GitHub Releases. Windows is a separate plan (`docs/windows-port.md`).

The recommended first release costs $5:

- Publish the extension on the Chrome Web Store as **Unlisted**. Only people with the link can find it.
- Sign the DMG with the existing "Arclike Local Signing" identity. Do not pay for an Apple Developer ID yet.
- Leave auto-updates off. Announce each new version in a GitHub release.

The Developer ID path ($99 a year) removes the Gatekeeper warning and makes auto-updates practical. Section 2 compares the options. You can move to it later, at the cost of one more Accessibility grant for each friend.

## 1. Chrome Web Store

### Account

1. Turn on 2-Step Verification for the Google account that will own the item. The Store requires it to publish.
2. Register at <https://chrome.google.com/webstore/devconsole> and pay the one-time $5 fee. You cannot change the developer email later.
3. Declare yourself a **non-trader**. Arclike is free and is not part of a business. This declaration comes from the EU Digital Services Act.

### Package

`./scripts/package-extension.sh` writes `dist/arclike-extension-VERSION.zip`. It packs `extension/` as committed in `HEAD`, so uncommitted work stays out. It removes the manifest `key`, and it stops when the name or description is longer than the Store allows. The description was 139 characters, and the Store limit is 132. Commit 5234611 shortened it.

### Extension ID and the manifest key

The `key` in `extension/manifest.json` fixes the unpacked ID at `jlmidbafifiahhcpahkcejphlibhjapo`. The Store gives a new item an ID from a key pair that the Store keeps. So the Store ID will be different. Older guides describe a `key.pem` file in the first upload to keep your own ID. I could not confirm that this still works, and the private key for `jlmid…` is not in the repository.

Use the Store's key everywhere instead, which the Chrome docs describe:

1. Upload the zip as a draft. Do not submit it yet.
2. In the dashboard, open **Package**, click **View public key**, and copy the key without the BEGIN and END lines, on one line.
3. Put that key in the manifest `key`. The unpacked copy then has the same ID as the Store item.
4. Set `CWS_EXTENSION_ID` in `native-host/Sources/arclike/main.swift` to the Store ID. Set `CWS_URL` to the Store listing, because the setup window's "Open Project Page" buttons tell people where to get the extension.

With one ID, the native host manifest needs only one entry in `allowed_origins`. The app writes the manifest itself when Chrome is enabled in its setup window (`updateManifests()`). It always adds `CWS_EXTENSION_ID`, and it adds the `extensionId` from its config when that is a different ID. `install-local.sh` computes the ID from the manifest key and writes it into that config. So your own unpacked copy keeps working after the key changes: reload it, and run `install-local.sh` once.

One consequence: Chrome cannot hold the unpacked copy and the Store copy at the same time, because they have the same ID. On your own Chrome, use only one of them.

### Listing text

- **Name:** Arclike
- **Summary:** the manifest description (130 characters).
- **Category:** Productivity, Tools.
- **Description:**

  > Arclike makes tab switching in Chrome feel like Arc.
  >
  > - Ctrl+Tab shows the tabs you visited recently, with thumbnails. Release Ctrl to switch.
  > - Cmd+T and Cmd+L open a command bar that searches open tabs, bookmarks, and history, and runs tab commands.
  > - Cmd+Shift+C copies the URL of the current tab.
  > - Import from Arc turns your Arc favorites, pinned tabs, and spaces into Chrome pinned tabs, bookmarks, and tab groups.
  >
  > Arclike needs its free macOS companion app, which draws the switcher and the command bar and catches the keyboard shortcuts. Download it from https://github.com/amitrahman1026/arclike/releases. macOS 14 or later.
  >
  > Everything stays on your Mac. Arclike has no server and sends nothing.

The Store's policy wants a dependency on other software to be clear in the description. The second paragraph does that.

### Images

- Icon: `extension/icon128.png` is in the package.
- Screenshots: at least one, 1280×800 or 640×400 PNG or JPEG. Make three: the Ctrl+Tab switcher, the command bar with results, and the Import from Arc popup. The switcher and the command bar need live key presses, so take them yourself with Cmd+Shift+5 on the Chrome window. An agent can then resize them to 1280×800 with `sips`.
- Small promo tile, 440×280: optional, but items without one show lower in lists. An agent can make one from the icon.

### Privacy practices tab

Expect an in-depth review because of `<all_urls>`, `history`, and native messaging. Clear justifications make it faster.

**Single purpose:** "Arclike replaces Chrome's tab switching with an Arc-style Ctrl+Tab switcher and a Cmd+T / Cmd+L command bar, drawn by its companion macOS app."

| Permission | Justification |
|---|---|
| `tabs` | Lists open tabs with titles and URLs for the Ctrl+Tab switcher and the command bar, and switches, moves, pins, and closes tabs on command. |
| `nativeMessaging` | Talks to the Arclike macOS app on the same computer. The app catches the keyboard shortcuts and draws the switcher and the command bar. |
| `activeTab` | See the note under this table. |
| `storage` | Keeps settings and the recently visited tab order. |
| `history` | The command bar searches pages visited in the last 90 days. |
| `bookmarks` | The command bar searches bookmarks. Import from Arc makes bookmark folders. |
| `topSites` | The command bar shows most visited sites before you type. |
| `search` | The command bar sends a search to the user's default search engine. |
| `favicon` | Shows site icons from Chrome's own favicon cache, without network requests. |
| `sessions` | The command bar reopens recently closed tabs. |
| `tabGroups` | Commands that make, rename, and close tab groups, and Import from Arc, which makes a group for each Arc space. |
| `<all_urls>` | `chrome.tabs.captureVisibleTab` takes a small thumbnail of the visible tab for the switcher. The capture happens when the user moves between tabs on any site. `activeTab` does not cover it, because the shortcut comes from the companion app and not from a Chrome gesture. |

Note on `activeTab`: the extension code does not call anything that needs it, and `<all_urls>` already allows the capture. Reviewers reject permissions that the item does not use. Remove `activeTab` before submission, and check that thumbnails still show. This change is not tested.

**Remote code:** "No, I am not using remote code."

**Data usage:** Arclike reads web history, tab URLs and titles, and page screenshots, and sends them only to its own app on the same Mac. The form asks what the item "collects", and the Store docs do not say whether local-only handling counts. The safe answer is to tick **Web history** and **Website content**, and to let the privacy policy say that nothing leaves the Mac. Then tick the three certifications (no sale, no use unrelated to the single purpose, no use for credit decisions).

**Privacy policy URL:** <https://github.com/amitrahman1026/arclike/blob/arclike/PRIVACY.md>. The file is in this commit. Push it before you submit, or the link does not work.

### Visibility

Choose **Unlisted**. Friends install from the link, and the item gets the same review as a public one. **Private** needs a list of each tester's Google email, which is more work for no gain here.

## 2. macOS app

### Signing options

macOS ties the Accessibility permission to the app's designated requirement. Gatekeeper decides whether a downloaded app opens without a warning.

| | Ad hoc | Arclike Local Signing (recommended now) | Developer ID and notarization |
|---|---|---|---|
| Cost | Free | Free | $99 a year |
| First launch | Blocked. Open Anyway in System Settings | Blocked. Open Anyway in System Settings | Opens after one standard "downloaded from the internet" prompt |
| Each new download | Open Anyway again | Open Anyway again | No extra step |
| Accessibility after an update | Grant again, because the requirement is the code hash and changes every build | Stays granted | Stays granted |
| Designated requirement | `cdhash H"…"` | `identifier "com.amitrahman1026.arclike" and certificate leaf = H"df69…2c76"` | `identifier "com.amitrahman1026.arclike" and anchor apple generic and … certificate leaf[subject.OU] = TEAMID` |
| Sparkle auto-update | Not practical | Possible, not tested | The standard setup |

Since macOS 15, Control-click and Open no longer bypass Gatekeeper. The friend must try to open the app once, then click **Open Anyway** under System Settings > Privacy & Security. Apple Silicon does not run unsigned code at all, so "unsigned" is not an option. The minimum is ad hoc.

Why the local identity works on a friend's Mac: the requirement names the certificate by its hash. A hash check does not need a trusted certificate. I tested this. A copy signed with a new, untrusted self-signed certificate satisfied `certificate leaf = H"…"` for that certificate, and did not satisfy it for another certificate. I did not test the Accessibility database itself on a second Mac.

Two risks with the local identity:

- The private key exists only in your login keychain. If it goes, the next build has a new requirement, and every friend must grant Accessibility again once. Export "Arclike Local Signing" from Keychain Access as a `.p12` file with a password, and keep it in your password manager.
- The release build and your own `install-local.sh` builds have the same requirement. This is harmless, and it means you can test a release DMG on your own Mac without a new grant.

A move to Developer ID later changes the requirement once. Each friend then grants Accessibility again. After that, it stays.

### Build

`native-host/build.sh` now builds the release DMG. Upstream's version read the version from an old bundle in `dist/`, did not copy `Info.plist`, and signed without the entitlements. The new script:

1. Stops when `Info.plist` and `APP_VERSION` in `main.swift` disagree.
2. Builds a universal binary (arm64 and x86_64).
3. Assembles `dist/release/Arclike.app` the same way as `install-local.sh`.
4. Signs with a Developer ID when one exists, else with "Arclike Local Signing", else ad hoc. `SIGNING_IDENTITY` overrides the choice.
5. Makes `dist/Arclike-VERSION.dmg` with `create-dmg` when it is installed (background and layout), else with `hdiutil` (app and an Applications link).
6. With `--notarize`, it submits the DMG to Apple, waits, staples the ticket, and checks it with `spctl`. This needs a Developer ID and `xcrun notarytool store-credentials Arclike` once.

It prints the SHA-256 of the DMG. Put that in the release notes.

The entitlements file gives `com.apple.security.automation.apple-events`, `cs.allow-unsigned-executable-memory`, and `cs.disable-library-validation`. Notarization accepts all three. The Swift code sends no Apple events, so the first one is probably not needed. Test without it before the Developer ID release. The fewer exceptions, the better.

### Auto-updates

Arclike keeps Sparkle in the app, but leaves it off for the first friend release. `VERSION_CHECK_URL` stays `nil`. Reasons:

- Sparkle needs an EdDSA key pair, `SUFeedURL` and `SUPublicEDKey` in `Info.plist`, a hosted `appcast.xml`, and a fixed `update-appcast.sh`. That script still names Tab Switcher and `tabswitcher.app`.
- With the local identity, Sparkle should accept updates, because the new build satisfies the old requirement. Nobody has tested it.
- A few friends and a few releases do not need it. A GitHub release and a message are enough.

Turn Sparkle on with the Developer ID release:

1. Get Sparkle's tools from the 2.8.1 release and run `generate_keys`. The private key goes to your keychain.
2. Add `SUFeedURL` (for example `https://raw.githubusercontent.com/amitrahman1026/arclike/arclike/appcast.xml`) and `SUPublicEDKey` to `Info.plist`, and set `SUEnableAutomaticChecks` to true.
3. Change `update-appcast.sh` to Arclike names, to the DMG name from `build.sh`, and to the GitHub release asset URL.
4. Leave `docs/appcast.xml` and `docs/version.json` alone. They belong to upstream's tabswitcher.app site.

### Before the first DMG

- Set the app version to 0.2.0 in `Info.plist` (both keys) and in `APP_VERSION`. 0.1.0 was the build-from-source release.
- `DEBUG_LOGGING` is `true`, and the log records command bar query text and has no size limit. Mine is 578 KB after one day. For friends, turn file logging off by default, or remove the query text and limit the file size. `PRIVACY.md` describes the log as it is now. Update the policy if this changes.
- `install.sh` is upstream's old installer. It builds into `~/.arclike` and asks for an extension ID. Remove it, or point it to `install-local.sh`, so that nobody follows it.

## 3. First run for a friend

1. Open the Store link and click **Add to Chrome**.
2. Download `Arclike-VERSION.dmg` from the GitHub release. Open it, and drag Arclike to Applications.
3. Open Arclike from Applications. macOS blocks it. Open System Settings > Privacy & Security, scroll to Security, click **Open Anyway**, and confirm with Touch ID or the password. The button shows for about an hour after the blocked launch.
4. The setup window opens. Select Google Chrome and click **Enable**. The app writes `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.amitrahman1026.arclike.json`, with the path to its own binary and the Store ID in `allowed_origins`.
5. macOS asks for Accessibility. Turn on Arclike in System Settings > Privacy & Security > Accessibility, then quit and open Arclike again, as the app's alert says.
6. The extension tries to connect every second, so Chrome launches the app as its native host without a restart. Press Ctrl+Tab in Chrome.

If nothing happens: check that the host manifest exists and names the Store ID, and read `~/Library/Logs/Arclike.log`. If Accessibility is on but the shortcuts do nothing, remove Arclike from the Accessibility list with the minus button, and add it again.

To update, the friend downloads the new DMG, replaces the app, and clicks Open Anyway again. With the local identity or a Developer ID, Accessibility stays granted.

## 4. Checklist

### You (accounts, payments, keys, publishing)

1. Turn on 2-Step Verification on the Google account.
2. Register as a Chrome Web Store developer, pay $5, and declare non-trader.
3. Export "Arclike Local Signing" from Keychain Access to a `.p12` file, and store it with its password.
4. Approve the push of this branch, so that the privacy policy URL works.
5. Take the screenshots (section 1, Images).
6. Make the Store item: upload the draft zip, and send the agent the item ID and the public key from **Package > View public key**.
7. Fill in the listing and the Privacy practices tab from section 1. Set visibility to Unlisted, and submit for review.
8. When the review passes, approve the GitHub release with the DMG.
9. Later, if you want no Gatekeeper warning, do these steps. They need your Apple ID password, so an agent cannot do them.
   - Join the Apple Developer Program ($99 a year).
   - Make a "Developer ID Application" certificate in Xcode (Settings > Accounts > Manage Certificates).
   - Make an app-specific password at account.apple.com.
   - Run `xcrun notarytool store-credentials Arclike --apple-id YOU --team-id TEAMID`.

### An agent

1. Remove `activeTab`, and check the thumbnails (section 1).
2. Fix logging, set the version to 0.2.0, and remove or replace `install.sh` (section 2, Before the first DMG).
3. Make the draft zip with `./scripts/package-extension.sh`.
4. When you send the Store ID and key: put the key in the manifest, and set `CWS_EXTENSION_ID` and `CWS_URL`. Bump the versions, run `install-local.sh`, and test your own Chrome with the new ID.
5. Resize the screenshots to 1280×800 and make the promo tile.
6. Run `./native-host/build.sh`, mount the DMG, and check the app and its signature.
7. Change the README install section for friends: the Store link, the DMG, and the Open Anyway step. Keep the build-from-source steps folded away.
8. Write the release notes with the DMG checksum, and run `gh release create` with the DMG after you approve it.
9. After a Developer ID exists: run `./native-host/build.sh --notarize`, and turn on Sparkle (section 2, Auto-updates).

## What was tested, and what was not

Tested on this Mac (macOS 26.5.2, Apple Silicon):

- `build.sh` without options: universal build, signing with "Arclike Local Signing", `codesign --verify --deep --strict`, and an `hdiutil` DMG. The mounted DMG holds the app and an Applications link, and the binary has both architectures. The designated requirement matches the installed local build.
- With a quarantine flag, `spctl` rejects the app, as a downloaded copy is rejected. So the Open Anyway step is necessary.
- A requirement with `certificate leaf = H"…"` passes for an app signed with an untrusted self-signed certificate.
- `package-extension.sh`: it stops on the 139-character description, and after the fix it makes a zip from `HEAD` without the `key`. The extension tests pass (120 of 120).

Not tested:

- Upload to the Store, review, and whether the Store accepts a manifest that contains a `key`. The script removes the key, so this should not matter.
- The Accessibility grant on a second Mac, the Open Anyway flow on a real download, and launch of the app from the DMG. I did not launch it here, because a second copy would compete with your running app.
- macOS 14 and 15, and Intel Macs. The binary is universal, but nobody has run the x86_64 part.
- `build.sh --notarize`, the Developer ID path, and the DMG signature. No Developer ID exists on this Mac.
- The `create-dmg` path. `create-dmg` is not installed here.
- Sparkle updates with any identity.
- Removal of `activeTab`.
