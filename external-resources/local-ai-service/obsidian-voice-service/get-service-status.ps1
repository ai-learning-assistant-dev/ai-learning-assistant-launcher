<#
  单独测试：powershell -ExecutionPolicy Bypass .\get-service-status.ps1
#>

$extractedDir = "ai-learning-assistant-voice-backend-shenyaoguan_dev"
$statusFile = "$PSScriptRoot\service-status.json"
$port = 8001
$backendDir = Join-Path $PSScriptRoot $extractedDir

if (-not (Test-Path $backendDir)) {
    Write-Output "not_installed"
    exit 0
}

if (-not (Test-Path $statusFile)) {
    Write-Output "stopped"
    exit 0
}

try {
    $st = Get-Content $statusFile -Raw | ConvertFrom-Json
}
catch {
    Write-Output "error"
    exit 0
}

if ($st.status -eq 'starting') {
    $tcpStarting = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($tcpStarting) {
        Write-Output "running"
    }
    else {
        Write-Output "starting"
    }
    exit 0
}

if ($st.pid) {
    $proc = Get-Process -Id $st.pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Output "stopped"
        exit 0
    }
}

$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($tcp) {
    Write-Output "running"
}
else {
    if ($st.status) {
        Write-Output $st.status
    }
    else {
        Write-Output "stopped"
    }
}

exit 0
