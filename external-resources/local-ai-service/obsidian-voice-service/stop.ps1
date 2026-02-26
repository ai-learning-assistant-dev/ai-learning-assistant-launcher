<#
  单独测试：powershell -ExecutionPolicy Bypass .\stop.ps1
#>

$statusFile = "$PSScriptRoot\service-status.json"

function Write-Status {
    param(
        [string]$Status = $null,
        [int]$ServicePid = $null,
        [string]$ErrorMsg = $null
    )

    @{
        status = $Status
        pid    = $ServicePid
        stamp  = [datetime]::Now.ToString('o')
        error  = $ErrorMsg
    } | ConvertTo-Json -Compress |
        Set-Content -Path $statusFile -Encoding UTF8 -Force
}

try {
    if (Test-Path $statusFile) {
        $st = Get-Content $statusFile -Raw | ConvertFrom-Json
        if ($st.pid) {
            taskkill /PID $st.pid /T /F 2>$null
        }
    }

    Write-Status -Status 'stopped' -ServicePid $null
    Write-Output "success"
    exit 0
}
catch {
    Write-Status -Status 'error' -ServicePid $null -ErrorMsg $_.Exception.Message
    Write-Output "error"
    exit 1
}
