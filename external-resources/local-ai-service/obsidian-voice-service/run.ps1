<#
  单独测试：powershell -ExecutionPolicy Bypass .\run.ps1
#>

$extractedDir = "ai-learning-assistant-voice-backend-main"
$statusFile = "$PSScriptRoot\service-status.json"
$port = 8001

function Find-UvPath {
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($uvCmd) {
        return $uvCmd.Source
    }

    $possiblePaths = @(
        "$env:USERPROFILE\.local\bin\uv.exe",
        "$env:LOCALAPPDATA\uv\uv.exe",
        "$env:APPDATA\uv\uv.exe",
        "C:\Users\$env:USERNAME\.local\bin\uv.exe"
    )

    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

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
    if (-not (Test-Path $extractedDir)) {
        Write-Status -Status 'not_installed' -ServicePid $null -ErrorMsg 'backend_not_installed'
        Write-Output "not_installed"
        exit 1
    }

    $uvPath = Find-UvPath
    if (-not $uvPath) {
        Write-Status -Status 'error' -ServicePid $null -ErrorMsg 'uv_not_found'
        Write-Output "error"
        exit 1
    }

    Set-Location $extractedDir

    $logOut = "$PSScriptRoot\voice-service.out"
    $logErr = "$PSScriptRoot\voice-service.err"

    $proc = Start-Process -FilePath $uvPath -ArgumentList "run", "python", ".\cli.py", "run", "--auto-detect", "--port", "$port" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput $logOut `
        -RedirectStandardError  $logErr

    Write-Status -Status 'starting' -ServicePid $proc.Id

    $running = $false
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 2

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
        taskkill /PID $proc.Id /T /F 2>$null
        Write-Status -Status 'error' -ServicePid $null -ErrorMsg 'start_timeout_or_process_exited'
        Write-Output "error"
        exit 1
    }

    Write-Output "success"
    exit 0
}
catch {
    Write-Status -Status 'error' -ServicePid $null -ErrorMsg $_.Exception.Message
    Write-Output "error"
    exit 1
}
