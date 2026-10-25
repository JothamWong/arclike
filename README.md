# Arclike

Arc-style tab switching for Chrome on macOS. Arclike adds a visual Ctrl+Tab switcher of your recent tabs and a Cmd+T / Cmd+L command bar like the one in Arc and Zen.

Arclike is a fork of [Tab Switcher](https://github.com/nechemyaspitz/tab-switcher) by Nechemya Spitz. It keeps Tab Switcher's switcher. It adds the command bar, a cap on the switcher's tabs, and a list of the tabs you visited in this session.

## Features

- Visual tab previews. The switcher shows thumbnails, favicons and titles as you cycle through tabs.
- Most-recently-used order. One Ctrl+Tab goes to your last tab.
- Session list. Like Arc and Zen, the switcher shows only the tabs you visited in this browser session, at most 5 by default.
- Command bar. Cmd+T and Cmd+L open a search bar over the browser window. It finds open tabs, bookmarks and history, and works on every page.
- Copy URL. Cmd+Shift+C copies the URL of the current tab and shows a confirmation.
- A macOS companion app intercepts the shortcuts at the system level and draws the switcher and the command bar.

## How It Works

Hold **Ctrl** and press **Tab** to show the switcher. Keep Ctrl down and press Tab again to move through your tabs. Release Ctrl to switch to the selected tab. Press Esc while you still hold Ctrl to close the switcher and stay on the current tab. You can also move the pointer over a card to select it.

### Command bar

Press **Cmd+T** or **Cmd+L** to open a floating search bar over the browser window. The bar lists the open tabs, bookmarks and history that match your text. When you type the start of a site name, the bar completes it in the field. Use the arrow keys or the pointer to select a row. Enter opens the row: it switches to an open tab, goes to a site, or searches with your default search engine. Esc closes the bar.

- **Cmd+T** opens the selection in a new tab. Enter in an empty bar opens a blank new tab.
- **Cmd+L** starts with the current address and opens the selection in the current tab.

The app draws the bar, not the page. That is why the bar also works on `chrome://` pages and on the New Tab page. The app takes Cmd+T and Cmd+L only from a browser whose extension supports the bar, so other browsers keep their own shortcuts. The bar matches history from the last 90 days in memory.

## Installation

Arclike has two parts: a Chrome extension and a macOS app. There are no prebuilt releases yet, so you build the app from source. You need macOS 14 or later and Xcode.

1. Clone this repository.
2. Create a code signing identity. Do this once:

   ```bash
   ./native-host/create-signing-identity.sh
   ```

   macOS asks for your password to trust the certificate. macOS ties the Accessibility permission to the app's signature, so a fixed identity keeps the permission across rebuilds.
3. Build and install the app:

   ```bash
   ./native-host/install-local.sh
   ```

   The script installs `/Applications/Arclike.app` and registers it as Chrome's native messaging host for the extension.
4. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder of this repository. The extension ID is always `jlmidbafifiahhcpahkcejphlibhjapo`, because the manifest contains a fixed key.
5. Open `/Applications/Arclike.app` once and grant the Accessibility permission when macOS asks. If macOS does not ask, open **System Settings > Privacy & Security > Accessibility** and turn on **Arclike**.

### After a change

- Extension only (`extension/`): click the reload button of Arclike in `chrome://extensions`.
- App (`native-host/`): run `./native-host/install-local.sh` again, then reload the extension. With the identity from step 2, the Accessibility permission stays granted. Without it, the script signs ad hoc, and you must turn Arclike off and on again in the Accessibility settings after each install.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Tab** | Open the switcher, or move forward |
| **Ctrl+Shift+Tab** | Move backward |
| **Ctrl+Esc** | Close the switcher without switching |
| **Cmd+T** | Command bar, opens in a new tab |
| **Cmd+L** | Command bar, opens in the current tab |
| **Cmd+Shift+C** | Copy the URL of the current tab |
| **Alt+W** | Quick switch to the last tab, without the switcher |

You can change the switcher and copy-URL shortcuts in the app's setup window.

## Privacy

Arclike works only on your Mac. It collects nothing and sends nothing. The extension reads favicons from Chrome's own cache, not from the network. Arclike does not check for updates, because Tab Switcher's update server describes Tab Switcher releases.

## Tests

The service worker's switcher and command bar logic runs under Node with stubbed browser APIs:

```bash
node --test tests/*.test.cjs
```

## Project Structure

```
├── extension/               # Chrome extension (load this folder unpacked)
│   ├── manifest.json        # Manifest, with the key that fixes the extension ID
│   ├── mainsw.js            # Service worker: tab order, switcher, native messaging
│   ├── commandbar.js        # Command bar suggestions and actions
│   └── popup.html/js        # Popup: connection status and settings
├── native-host/
│   ├── Sources/arclike/     # macOS app (Swift)
│   ├── Info.plist           # App bundle template
│   ├── install-local.sh     # Build, sign and install the app for local use
│   ├── create-signing-identity.sh  # One-time local code signing identity
│   └── build.sh             # Upstream's release script (DMG, notarization)
├── tests/                   # Node tests for the service worker
└── docs/                    # Upstream's website, not used by Arclike
```

## Troubleshooting

The extension popup shows "Not connected":
- Check that `/Applications/Arclike.app` exists. If not, run `./native-host/install-local.sh`.
- Check that the extension ID in `chrome://extensions` is `jlmidbafifiahhcpahkcejphlibhjapo`.
- Reload the extension.

Ctrl+Tab, Cmd+T or Cmd+L does nothing:
- Check that Arclike is on in **System Settings > Privacy & Security > Accessibility**.
- Check that a Chrome window has focus.

The app writes a debug log to `~/Library/Logs/Arclike.log`.

## Staying in sync with upstream

The `origin` remote is the upstream Tab Switcher repository. To bring in its fixes, fetch and merge its `main` branch:

```bash
git fetch origin && git merge origin/main
```

Internal Swift type names are the same as upstream's, which keeps merges small.

## License

MIT License. See [LICENSE](LICENSE), which keeps the copyright notices of the original extension and of Tab Switcher.
