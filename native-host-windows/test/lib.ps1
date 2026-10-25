# Helpers for scenario scripts, which run in the desktop session through Invoke-Interactive.ps1.
# Dot-source it: . C:\arclike\src\native-host-windows\test\lib.ps1
$ErrorActionPreference = "Stop"
$ProbeExe = "C:\arclike\test\probe\Probe.exe"
$ResultsRoot = "C:\arclike\test\out"
$TestProfile = "C:\arclike\test\profile"

# The probe is a WinExe, so wait for it explicitly and collect its output from a file.
function Probe {
    $tmp = [System.IO.Path]::GetTempFileName()
    $err = [System.IO.Path]::GetTempFileName()
    # Start-Process joins the arguments with spaces, so quote any that contain one.
    $quoted = $args | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } }
    $p = Start-Process -FilePath $ProbeExe -ArgumentList $quoted -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $tmp -RedirectStandardError $err
    $output = Get-Content $tmp -Raw
    $errors = Get-Content $err -Raw
    Remove-Item $tmp, $err -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "probe $($args -join ' ') failed ($($p.ExitCode)): $errors" }
    return $output
}

function Get-ChromePath {
    foreach ($path in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
        if (Test-Path $path) { return $path }
    }
    throw "Chrome not found"
}

# Start Chrome on the test profile, with the given URLs. The extension must already be loaded in
# that profile (Chrome 137 and later ignore --load-extension). See docs/windows-port.md, 7.3.
function Start-TestChrome([string[]]$Urls = @("about:blank")) {
    $chromeArgs = @("--user-data-dir=$TestProfile", "--no-first-run", "--no-default-browser-check", "--restore-last-session=false") + $Urls
    Start-Process -FilePath (Get-ChromePath) -ArgumentList $chromeArgs | Out-Null
}

function Stop-TestChrome {
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
        Where-Object { $_.CommandLine -like "*$TestProfile*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutMs = 10000, [string]$What = "condition") {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for $What"
}

function Get-Foreground { return (Probe foreground | ConvertFrom-Json) }

# Save a screenshot, the Arclike UI tree and the Arclike log under out\<scenario>\<step>.
function Save-Evidence([string]$Scenario, [string]$Step) {
    $dir = Join-Path $ResultsRoot (Join-Path $Scenario $Step)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Probe screenshot (Join-Path $dir "screen.png") | Out-Null
    Probe uia | Set-Content (Join-Path $dir "uia.json")
    $log = Join-Path $env:LOCALAPPDATA "Arclike\Arclike.log"
    if (Test-Path $log) { Get-Content $log -Tail 200 | Set-Content (Join-Path $dir "Arclike.log") }
}

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    Write-Output "ok - $Message"
}
