# One-time setup on the Windows box, run over SSH. Builds the probe and registers the
# ArclikeInteractive task, which runs C:\arclike\test\job.ps1 in the logged-on user's desktop
# session. SSH sessions run in session 0, which has no desktop to capture, type into or read.
$ErrorActionPreference = "Stop"
$Root = "C:\arclike\test"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "out") | Out-Null

dotnet publish (Join-Path $PSScriptRoot "Probe\Probe.csproj") -c Release -o (Join-Path $Root "probe")
if ($LASTEXITCODE -ne 0) { throw "dotnet publish of the probe failed" }

# The probe is a WinExe and starts PowerShell with no window, so nothing takes the foreground.
$action = New-ScheduledTaskAction -Execute (Join-Path $Root "probe\Probe.exe") -Argument "run-job `"$Root`""
# Interactive: run only while the user is logged on, in that session. No password is stored.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "ArclikeInteractive" -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered the ArclikeInteractive task for $env:USERDOMAIN\$env:USERNAME"
