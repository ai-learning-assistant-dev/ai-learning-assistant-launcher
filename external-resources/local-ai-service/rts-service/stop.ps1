# 只关闭服务 powershell -ExecutionPolicy Bypass .\stop.ps1

<# 
    TODO 这里有一个问题，那就是在结束rts服务之后，我们没有实现如何主动的
    通知nodejs知道状态改变，那么UI的running的状态可能就会没变化
    现在我们简单的实现了服务状态检查，让UI每过几秒钟轮询一次，这样子
    保持状态的最新
#>

$statusFile = "$PSScriptRoot\service-status.json"
function Write-Status {
    param(
        [string]$Status = $null,
        [int]$service_PID = $null, 
        [string]$ErrorMsg = $null
    )
    @{
        status = $Status
        pid    = $service_PID
        stamp  = [datetime]::Now.ToString('o')
        error  = $ErrorMsg
    } | ConvertTo-Json -Compress |
        Set-Content -Path $statusFile -Encoding UTF8 -Force
}

if (Test-Path $statusFile) {
    $st = Get-Content $statusFile -Raw | ConvertFrom-Json
    if ($st.pid -eq 0 -or -not $st.pid) {
        Write-Host "No PID found, nothing to kill." -ForegroundColor Yellow
    } else {
        taskkill /PID $st.pid /T /F 2>$null
        Write-Status -Status 'stopped' -service_PID $null
        Write-Host "Service stopped (PID $($st.pid))" -ForegroundColor Green
    }
} else {
    Write-Host "Status file not found, nothing to kill." -ForegroundColor Yellow
}

Write-Output "success"
exit 0
