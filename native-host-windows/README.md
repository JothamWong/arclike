# Arclike for Windows

The Windows companion app for the Arclike extension, in C#/WPF/.NET 8. It started as upstream Tab Switcher's Windows port. The plan and the test approach are in [docs/windows-port.md](../docs/windows-port.md).

Status: in progress, not yet run on Windows. It builds on macOS with the .NET 8 SDK:

```bash
dotnet build native-host-windows/Arclike/Arclike.csproj -p:EnableWindowsTargeting=true
```

Unit tests for the platform-neutral parts run on macOS too:

```bash
dotnet test native-host-windows/Arclike.Tests
```

## Test on a headless Windows box

`test/remote-test.sh` copies the working tree to the box over SSH, installs it, runs the protocol test and the scenarios in `test/scenarios`, and copies screenshots and logs back to `test/results/`. The one-time box setup is in [docs/windows-port.md](../docs/windows-port.md), section 8, then run `test/Register-InteractiveRunner.ps1` on the box once.

## Build and install on Windows

Needs the .NET 8 SDK, Windows 10 or 11 (x64) and Chrome.

```powershell
.\native-host-windows\install-local.ps1
```

The script publishes a self-contained `Arclike.exe`, copies it to `%LOCALAPPDATA%\Programs\Arclike`, writes the native messaging manifest and registers it under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.amitrahman1026.arclike`. Then load `extension/` unpacked in `chrome://extensions`. Chrome starts the app when the extension connects.

`build.ps1 -Installer` builds an Inno Setup installer instead.

## Logs

`%LOCALAPPDATA%\Arclike\Arclike.log`

## Layout

```
Arclike/
├── App.xaml.cs                  Entry point, launch mode, message routing
├── Constants.cs                 Names, IDs, paths
├── Helpers/                     P/Invoke, logging, blur
├── Models/                      Tab, shortcut and browser models
├── NativeMessaging/             stdin/stdout protocol
├── Keyboard/KeyboardHook.cs     WH_KEYBOARD_LL hook for Ctrl+Tab and the command bar keys
├── IPC/                         Leader election (mutex) and named pipes between instances
├── Services/                    Browser config, manifest and registry, browser detection
└── Views/                       Switcher overlay, toast, setup window
```
