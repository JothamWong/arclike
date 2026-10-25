# Test level 2 from docs/windows-port.md: the native messaging protocol, without Chrome or a
# desktop. Runs over SSH. Starts Arclike.exe as Chrome would and talks to it over stdin/stdout.
param([string]$Exe = (Join-Path $env:LOCALAPPDATA "Programs\Arclike\Arclike.exe"))
$ErrorActionPreference = "Stop"

$psi = New-Object System.Diagnostics.ProcessStartInfo $Exe
$psi.Arguments = "chrome-extension://jlmidbafifiahhcpahkcejphlibhjapo/"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($psi)
$stdin = $process.StandardInput.BaseStream
$stdout = $process.StandardOutput.BaseStream
# Arclike logs to stderr too. Drain it, or a full pipe would block the app.
$stderrTask = $process.StandardError.ReadToEndAsync()
$failures = 0

function Send-Message($object) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($object | ConvertTo-Json -Compress -Depth 5))
    $stdin.Write([BitConverter]::GetBytes([uint32]$bytes.Length), 0, 4)
    $stdin.Write($bytes, 0, $bytes.Length)
    $stdin.Flush()
}

function Read-Exact([int]$count, [int]$timeoutMs) {
    $buffer = New-Object byte[] $count
    $read = 0
    while ($read -lt $count) {
        $task = $stdout.ReadAsync($buffer, $read, $count - $read)
        if (-not $task.Wait($timeoutMs)) { throw "timed out reading from Arclike" }
        if ($task.Result -eq 0) { throw "Arclike closed stdout" }
        $read += $task.Result
    }
    return $buffer
}

function Read-Message([int]$timeoutMs = 5000) {
    $length = [BitConverter]::ToUInt32((Read-Exact 4 $timeoutMs), 0)
    return [System.Text.Encoding]::UTF8.GetString((Read-Exact $length $timeoutMs)) | ConvertFrom-Json
}

function Check([bool]$condition, [string]$message) {
    if ($condition) { Write-Output "ok - $message" } else { Write-Output "FAIL - $message"; $script:failures++ }
}

try {
    $ready = Read-Message
    Check ($ready.action -eq "ready") "sends ready on start"

    Send-Message @{ action = "ping" }
    Check ((Read-Message).action -eq "pong") "answers ping with pong"

    Send-Message @{ action = "register"; bundleId = "com.google.Chrome"; extensionVersion = "0.1.0"; features = @("command_bar") }
    $registered = Read-Message
    Check ($registered.action -eq "registered" -and $registered.bundleId) "answers register with registered ($($registered.bundleId))"
    Check ($null -ne $registered.shortcuts.tabSwitch) "registered carries the shortcuts"

    Send-Message @{ action = "log"; message = "protocol test" }
    Send-Message @{ action = "no_such_action" }
    Send-Message @{ action = "ping" }
    Check ((Read-Message).action -eq "pong") "survives log and unknown actions"

    # Closing stdin is how Chrome disconnects. The host must exit.
    $stdin.Close()
    Check ($process.WaitForExit(5000)) "exits when stdin closes"

    $log = Join-Path $env:LOCALAPPDATA "Arclike\Arclike.log"
    Check ((Test-Path $log) -and ((Get-Content $log -Tail 50) -match "Extension: protocol test")) "writes extension log lines to Arclike.log"
}
finally {
    if (-not $process.HasExited) { $process.Kill() }
}

if ($failures -gt 0) { Write-Output "$failures failed"; exit 1 }
Write-Output "all passed"
