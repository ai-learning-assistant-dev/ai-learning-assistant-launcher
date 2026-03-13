<#
  单独测试：powershell -ExecutionPolicy Bypass .\run.ps1
#>

$extractedDir = "ai-learning-assistant-voice-backend-shenyaoguan_dev"
$statusFile = "$PSScriptRoot\service-status.json"
$port = 8001
$backendDir = Join-Path $PSScriptRoot $extractedDir
$scriptsDir = Join-Path $backendDir "scripts"
$startScript = Join-Path $scriptsDir "start_windows.ps1"
$pollIntervalSeconds = 2
$startupTimeoutSeconds = 600

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
    if (-not (Test-Path $backendDir)) {
        Write-Status -Status 'not_installed' -ServicePid $null -ErrorMsg 'backend_not_installed'
        Write-Output "not_installed"
        exit 1
    }

    if (-not (Test-Path $startScript)) {
        Write-Status -Status 'error' -ServicePid $null -ErrorMsg 'start_script_not_found'
        Write-Output "error: start_script_not_found ($startScript)"
        exit 1
    }

    $logOut = "$PSScriptRoot\voice-service.out"
    $logErr = "$PSScriptRoot\voice-service.err"

    if (Test-Path $logOut) {
        Remove-Item -Path $logOut -Force
    }
    if (Test-Path $logErr) {
        Remove-Item -Path $logErr -Force
    }

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript, "-Port", "$port" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput $logOut `
        -RedirectStandardError  $logErr

    Write-Status -Status 'starting' -ServicePid $proc.Id

    $running = $false
    $maxChecks = [Math]::Ceiling($startupTimeoutSeconds / $pollIntervalSeconds)
    for ($i = 1; $i -le $maxChecks; $i++) {
        Start-Sleep -Seconds $pollIntervalSeconds

        if ($proc.HasExited) {
            break
        }

        $tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($tcp) {
            Write-Status -Status 'running' -ServicePid $tcp.OwningProcess
            $running = $true
            break
        }
    }

    if (-not $running) {
        if (-not $proc.HasExited) {
            taskkill /PID $proc.Id /T /F 2>$null
        }

        $detail = "start_timeout_or_process_exited"
        if (Test-Path $logErr) {
            $errPreview = Get-Content -Path $logErr -Raw -ErrorAction SilentlyContinue
            if (-not [string]::IsNullOrWhiteSpace($errPreview)) {
                $firstLine = ($errPreview -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
                if ($firstLine) {
                    $detail = "${detail}: $firstLine"
                }
            }
        }

        Write-Status -Status 'error' -ServicePid $null -ErrorMsg $detail
        Write-Output "error: $detail"
        exit 1
    }

    Write-Output "success"
    exit 0
}
catch {
    Write-Status -Status 'error' -ServicePid $null -ErrorMsg $_.Exception.Message
    Write-Output "error: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) {
        Write-Output $_.ScriptStackTrace
    }
    exit 1
}
