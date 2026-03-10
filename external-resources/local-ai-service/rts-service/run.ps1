<# 
  Comment：
    单独测试该脚本：powershell -ExecutionPolicy Bypass .\run.ps1
  预期结束码 0 返回值 success 解压成功
 #>

# Service directory name (must match install.ps1)
# Original: ai-learning-assistant-rtc-backend-shiftonetothree_dev (52 chars)
# Shortened: rtc-backend (11 chars) - saves 41 chars per path level
$extractedDir = "rtc-backend"
$statusFile = "$PSScriptRoot\service-status.json"

# 设定Hugging Face国内镜像以解决RTS依赖安装过程中的网络问题
$env:HF_ENDPOINT = "https://hf-mirror.com"   
# Windows 下避免符号链接问题
$env:HF_HUB_DISABLE_SYMLINKS = "1"
# Force Python to use UTF-8 encoding for stdout/stderr (fix garbled Chinese)
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

# 输出进度信息的函数（强制刷新缓冲区）
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
    # 使用 [Console]::Write 确保立即输出，避免缓冲延迟
    [Console]::WriteLine("PROGRESS:$json")
    [Console]::Out.Flush()
}

# 路径长度检测：超过200字符时报错并退出
function Test-PathLength {
    Write-Progress-Json -Percent 2 -Stage "check_path" -Message "Checking installation path length..."
    $scriptPath = $PSScriptRoot
    $pathLength = $scriptPath.Length
    [Console]::WriteLine("Installation path: $scriptPath (length: $pathLength)")
    [Console]::Out.Flush()
    if ($pathLength -gt 200) {
        $errorMsg = "安装路径过长（当前 $pathLength 个字符，上限 200 个字符），spacy/kokoro 加载 DLL 时会因 Windows 260 字符限制失败。请将启动器移动到较短路径，例如 D:\ALA\"
        [Console]::WriteLine("ERROR: $errorMsg")
        [Console]::Out.Flush()
        $progressObj = @{
            type    = 'progress'
            percent = 0
            stage   = 'path_error'
            message = $errorMsg
        }
        [Console]::WriteLine("PROGRESS:$($progressObj | ConvertTo-Json -Compress)")
        [Console]::Out.Flush()
        exit 1
    }
    Write-Progress-Json -Percent 3 -Stage "path_ok" -Message "Path length check passed"
}
Test-PathLength

# Print python.exe path length (for path limit check)
function Print-PythonPathLength {
    Write-Progress-Json -Percent 4 -Stage "check_python_path" -Message "Checking Python path..."
    $pythonPath = "$PSScriptRoot\$extractedDir\.venv\Scripts\python.exe"
    $pathLength = $pythonPath.Length
    [Console]::WriteLine("Python path: $pythonPath (length: $pathLength)")
    [Console]::Out.Flush()
    [Console]::WriteLine("PYTHON_PATH_INFO: $pythonPath (length: $pathLength)")
    [Console]::Out.Flush()
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
    [Console]::WriteLine("Error: uv not found. Please run install.ps1 first.")
    [Console]::Out.Flush()
    Write-Progress-Json -Percent 0 -Stage "error" -Message "uv not found, please install first"
    exit 1
}
[Console]::WriteLine("uv found at: $uvPath")
[Console]::Out.Flush()
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
    [Console]::WriteLine("Starting Flask service with uv...")
    [Console]::Out.Flush()
    $proc = Start-Process -FilePath $uvPath -ArgumentList "run", ".\main.py" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput $LogOut `
        -RedirectStandardError  $LogErr

    [Console]::WriteLine("Service process started with PID: $($proc.Id)")
    [Console]::Out.Flush()

    # Record starting status with actual PID (not 0)
    Write-Status -Status 'starting' -service_PID $proc.Id
    Write-Progress-Json -Percent 45 -Stage "wait_port" -Message "Waiting for service to start..."
    
    # Poll port to confirm service started (optimized: shorter intervals)
    $ok = $false
    for ($i = 1; $i -le $MaxRetry; $i++) {
        Start-Sleep -Seconds 2
        
        # Check if process is still running (more reliable than HasExited)
        $currentProc = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
        if (-not $currentProc) { 
            # Read error log for debugging
            if (Test-Path $LogErr) {
                $errContent = Get-Content $LogErr -Tail 10 -ErrorAction SilentlyContinue
                [Console]::WriteLine("Process exited prematurely. Last 10 lines of flask.err:")
                $errContent | ForEach-Object { [Console]::WriteLine("  $_") }
                [Console]::Out.Flush()
            }
            Write-Progress-Json -Percent 45 -Stage "process_exit" -Message "Process exited unexpectedly"
            break 
        }
        
        $tcp = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($tcp) {
            [Console]::WriteLine("Port $Port is now listening")
            [Console]::Out.Flush()
            $ok = $true
            # 取第一个连接的PID（可能有IPv4和IPv6多个连接）
            $owningPid = if ($tcp -is [array]) { $tcp[0].OwningProcess } else { $tcp.OwningProcess }
            [Console]::WriteLine("Service running with PID: $owningPid")
            [Console]::Out.Flush()
            Write-Status -Status 'running' -service_PID $owningPid
            Write-Progress-Json -Percent 100 -Stage "running" -Message "RTS service started"
            break
        }
        # Progress indicator every 10 seconds (5 retries * 2s)
        if ($i % 5 -eq 0) {
            $elapsedSec = [int]($i * 2)
            # Update status to show still starting
            Write-Status -Status 'starting' -service_PID $proc.Id
            # 计算进度: 45% -> 95% 的范围内随着重试次数增加
            $progressPercent = 45 + [int](($i / $MaxRetry) * 50)
            $waitMsg = "Waiting for service ready... (${elapsedSec}s)"
            Write-Progress-Json -Percent $progressPercent -Stage "waiting" -Message $waitMsg
        }
    }

    # 结果判定
    if (-not $ok) {
        [Console]::WriteLine("Service failed to start within timeout")
        [Console]::Out.Flush()
        # Read error log for debugging
        if (Test-Path $LogErr) {
            $errContent = Get-Content $LogErr -Tail 20 -ErrorAction SilentlyContinue
            [Console]::WriteLine("Last 20 lines of flask.err:")
            $errContent | ForEach-Object { [Console]::WriteLine("  $_") }
            [Console]::Out.Flush()
        }
        taskkill /PID $proc.Id /T /F 2>$null
        Write-Status -Status 'error' -ErrorMsg "Service failed to start within timeout" -service_PID $null
        Write-Progress-Json -Percent 0 -Stage "timeout" -Message "Service start timeout"
        return $false
    }
    return $true
}

try {
    Write-Progress-Json -Percent 15 -Stage "enter_dir" -Message "Entering service directory..."
    [Console]::WriteLine("Entering service directory: $extractedDir")
    [Console]::Out.Flush()
    Set-Location $extractedDir
    
    # 确保依赖已正确安装（使用 CPU 版本的 torch）
    Write-Progress-Json -Percent 20 -Stage "sync_deps" -Message "Checking and syncing dependencies..."
    [Console]::WriteLine("Running uv sync --extra cpu...")
    [Console]::Out.Flush()
    $syncResult = & $uvPath sync --extra cpu 2>&1
    [Console]::WriteLine("uv sync output: $syncResult")
    [Console]::Out.Flush()
    if ($LASTEXITCODE -ne 0) {
        Write-Progress-Json -Percent 30 -Stage "sync_warning" -Message "Dependency sync may have issues, continuing..."
        [Console]::WriteLine("Warning: uv sync exited with code $LASTEXITCODE")
        [Console]::Out.Flush()
    } else {
        Write-Progress-Json -Percent 35 -Stage "sync_done" -Message "Dependencies check complete"
        [Console]::WriteLine("Dependencies synced successfully")
        [Console]::Out.Flush()
    }
    
    $success = Start-FlaskNonBlock
    if (-not $success) { 
        Write-Output "error"
        exit 1 
    }
    Write-Output "success"
}
catch {
    [Console]::WriteLine("Running with something wrong: $($_.Exception.Message)")
    [Console]::Out.Flush()
    Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
    Write-Progress-Json -Percent 0 -Stage "error" -Message "Start failed: $($_.Exception.Message)"
    exit 1
}
