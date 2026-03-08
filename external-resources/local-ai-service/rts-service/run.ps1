<# 
  Comment：
    单独测试该脚本：powershell -ExecutionPolicy Bypass .\run.ps1
  预期结束码 0 返回值 success 解压成功
 #>

$extractedDir = "ai-learning-assistant-rtc-backend-shiftonetothree_dev"
$statusFile = "$PSScriptRoot\service-status.json"

# 设定Hugging Face国内镜像以解决RTS依赖安装过程中的网络问题
$env:HF_ENDPOINT = "https://hf-mirror.com"   
# # Windows 下避免符号链接问题
$env:HF_HUB_DISABLE_SYMLINKS = "1"

# 输出进度信息的函数
function Write-Progress-Json {
    param(
        [int]$Percent,
        [string]$Stage,
        [string]$Message
    )
    $progressObj = @{
        type = 'progress'
        percent = $Percent
        stage = $Stage
        message = $Message
    }
    $json = $progressObj | ConvertTo-Json -Compress
    Write-Output "PROGRESS:$json"
}

# 路径长度检测：超过200字符时报错并退出
function Test-PathLength {
    $scriptPath = $PSScriptRoot
    $pathLength = $scriptPath.Length
    Write-Host "Current script path: $scriptPath (length: $pathLength)" -ForegroundColor Cyan
    if ($pathLength -gt 200) {
        $errorMsg = "安装路径过长（当前 $pathLength 个字符，上限 200 个字符），spacy/kokoro 加载 DLL 时会因 Windows 260 字符限制失败。请将启动器移动到较短路径，例如 D:\ALA\"
        Write-Host "ERROR: $errorMsg" -ForegroundColor Red
        $progressObj = @{
            type    = 'progress'
            percent = 0
            stage   = 'path_error'
            message = $errorMsg
        }
        Write-Output "PROGRESS:$($progressObj | ConvertTo-Json -Compress)"
        exit 1
    }
}
Test-PathLength

# Print python.exe path length
function Print-PythonPathLength {
    $pythonPath = "$PSScriptRoot\$extractedDir\.venv\Scripts\python.exe"
    $pathLength = $pythonPath.Length
    Write-Host "Python executable path: $pythonPath (length: $pathLength)" -ForegroundColor Cyan
    Write-Output "PYTHON_PATH_INFO: $pythonPath (length: $pathLength)"
}
Print-PythonPathLength

# 查找 uv 可执行文件路径
Write-Progress-Json -Percent 5 -Stage "check_uv" -Message "Checking uv package manager..."
function Find-UvPath {
    # 首先尝试直接调用
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($uvCmd) {
        return $uvCmd.Source
    }
    
    # 检查常见安装路径
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

$uvPath = Find-UvPath
if (-not $uvPath) {
    Write-Host "Error: uv not found. Please run install.ps1 first." -ForegroundColor Red
    Write-Progress-Json -Percent 0 -Stage "error" -Message "uv not found, please install first"
    exit 1
}
Write-Host "Found uv at: $uvPath" -ForegroundColor Green
Write-Progress-Json -Percent 10 -Stage "uv_found" -Message "uv found"    

function Write-Status {
    param(
        [string]$Status = $null,
        [int]$service_PID = $null, 
        [string]$ErrorMsg = $null
    )
    $statusData = @{
        status = $Status
        pid    = $service_PID
        stamp  = [datetime]::Now.ToString('o')
        error  = $ErrorMsg
    } | ConvertTo-Json -Compress
    
    # Retry mechanism to handle file locking
    $maxRetries = 5
    $retryDelay = 200  # milliseconds
    for ($retry = 0; $retry -lt $maxRetries; $retry++) {
        try {
            [System.IO.File]::WriteAllText($statusFile, $statusData, [System.Text.Encoding]::UTF8)
            return
        } catch {
            if ($retry -lt $maxRetries - 1) {
                Start-Sleep -Milliseconds $retryDelay
            }
        }
    }
    # Final fallback: use Set-Content with -Force
    try {
        $statusData | Set-Content -Path $statusFile -Encoding UTF8 -Force
    } catch {
        Write-Host "Warning: Could not write status file" -ForegroundColor Yellow
    }
}

# 启动RTS服务
function Start-FlaskNonBlock {
    param(
        [int]$MaxRetry  = 180,  # Increased: 180 * 2s = 6 minutes max wait
        [int]$Port      = 8989,
        [string]$LogOut = "$PSScriptRoot\flask.out",
        [string]$LogErr = "$PSScriptRoot\flask.err"
    )

    <# 
      非阻塞启动
        这里启动了一个子进程，这个子进程实际上和后面我们占用8989端口的
        Flask服务还不是同一个，但是重要的是这里启动进程后脚本只会
        轮询，然后尝试记录状态
    #>
    
    # Clear old log files before starting
    if (Test-Path $LogOut) { Remove-Item $LogOut -Force -ErrorAction SilentlyContinue }
    if (Test-Path $LogErr) { Remove-Item $LogErr -Force -ErrorAction SilentlyContinue }
    
    Write-Progress-Json -Percent 40 -Stage "start_process" -Message "Starting service process..."
    $proc = Start-Process -FilePath $uvPath -ArgumentList "run", ".\main.py" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput $LogOut `
        -RedirectStandardError  $LogErr

    # Record starting status with actual PID (not 0)
    Write-Status -Status 'starting' -service_PID $proc.Id
    Write-Progress-Json -Percent 45 -Stage "wait_port" -Message "Waiting for service to start..."

    # Track log file position for incremental reading
    $lastErrLine = 0
    $lastOutLine = 0
    
    # Poll port to confirm service started (optimized: shorter intervals)
    $ok = $false
    for ($i = 1; $i -le $MaxRetry; $i++) {
        Start-Sleep -Seconds 2
        
        # Read and display new log content (model loading progress)
        if (Test-Path $LogErr) {
            $errLines = @(Get-Content $LogErr -ErrorAction SilentlyContinue)
            if ($errLines.Count -gt $lastErrLine) {
                for ($lineIdx = $lastErrLine; $lineIdx -lt $errLines.Count; $lineIdx++) {
                    $line = $errLines[$lineIdx]
                    if ($line -and $line.Trim()) {
                        Write-Host "  [LOG] $line" -ForegroundColor Cyan
                        # Detect model loading keywords and send progress
                        if ($line -match "(?i)(download|loading|model|torch|cuda|weights|checkpoint)") {
                            Write-Progress-Json -Percent 50 -Stage "loading" -Message "Loading models: $line"
                        }
                    }
                }
                $lastErrLine = $errLines.Count
            }
        }
        
        if (Test-Path $LogOut) {
            $outLines = @(Get-Content $LogOut -ErrorAction SilentlyContinue)
            if ($outLines.Count -gt $lastOutLine) {
                for ($lineIdx = $lastOutLine; $lineIdx -lt $outLines.Count; $lineIdx++) {
                    $line = $outLines[$lineIdx]
                    if ($line -and $line.Trim()) {
                        Write-Host "  [OUT] $line" -ForegroundColor Gray
                    }
                }
                $lastOutLine = $outLines.Count
            }
        }
        
        # Check if process is still running (more reliable than HasExited)
        $currentProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
        if (-not $currentProc) { 
            # Read error log for debugging
            if (Test-Path $LogErr) {
                $errContent = Get-Content $LogErr -Tail 10 -ErrorAction SilentlyContinue
                Write-Host "Process exited prematurely. Last 10 lines of flask.err:" -ForegroundColor Yellow
                $errContent | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
            }
            Write-Progress-Json -Percent 45 -Stage "process_exit" -Message "Process exited unexpectedly"
            break 
        }
        
        $tcp = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($tcp) {
            Write-Host "Port $Port is now listening" -ForegroundColor Green
            $ok = $true
            Write-Status -Status 'running' -service_PID $tcp.OwningProcess
            Write-Progress-Json -Percent 100 -Stage "running" -Message "RTS service started"
            break
        }
        # Progress indicator every 10 retries (20 seconds)
        if ($i % 10 -eq 0) {
            $elapsedSec = [int]($i * 2)
            Write-Host "Still waiting for port $Port... ($i/$MaxRetry retries, ${elapsedSec}s elapsed)" -ForegroundColor Yellow
            # Update status to show still starting
            Write-Status -Status 'starting' -service_PID $proc.Id
            # 计算进度: 45% -> 90% 的范围内随着重试次数增加
            $progressPercent = 45 + [int](($i / $MaxRetry) * 45)
            $waitMsg = "Waiting for service ready... (${elapsedSec}s)"
            Write-Progress-Json -Percent $progressPercent -Stage "waiting" -Message $waitMsg
        }
    }

    # 结果判定
    if (-not $ok) {
        Write-Host "Service failed to start within timeout" -ForegroundColor Red
        # Read error log for debugging
        if (Test-Path $LogErr) {
            $errContent = Get-Content $LogErr -Tail 20 -ErrorAction SilentlyContinue
            Write-Host "Last 20 lines of flask.err:" -ForegroundColor Yellow
            $errContent | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        }
        taskkill /PID $proc.Id /T /F 2>$null
        Write-Status -Status 'error' -ErrorMsg "Service failed to start within timeout" -service_PID $null
        Write-Progress-Json -Percent 0 -Stage "timeout" -Message "Service start timeout"
        return $false
    }
    return $true
}

try {
    Write-Host "Try to run flask service." -ForegroundColor Yellow
    Write-Progress-Json -Percent 15 -Stage "enter_dir" -Message "Entering service directory..."
    Set-Location $extractedDir
    
    # 确保依赖已正确安装（使用 CPU 版本的 torch）
    Write-Progress-Json -Percent 20 -Stage "sync_deps" -Message "Checking and syncing dependencies..."
    Write-Host "Ensuring dependencies are installed..." -ForegroundColor Yellow
    $syncResult = & $uvPath sync --extra cpu 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: uv sync returned non-zero exit code" -ForegroundColor Yellow
        Write-Host $syncResult -ForegroundColor Gray
        Write-Progress-Json -Percent 30 -Stage "sync_warning" -Message "Dependency sync may have issues, continuing..."
    } else {
        Write-Host "Dependencies OK" -ForegroundColor Green
        Write-Progress-Json -Percent 35 -Stage "sync_done" -Message "Dependencies check complete"
    }
    
    $success = Start-FlaskNonBlock
    if (-not $success) { 
        Write-Output "error"
        exit 1 
    }
    Write-Output "success"
}
catch {
    Write-Host "Running with something wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
    Write-Progress-Json -Percent 0 -Stage "error" -Message "Start failed: $($_.Exception.Message)"
    exit 1
}
