# 预期使用方法 powershell -ExecutionPolicy Bypass .\running_status.ps1
# 只关闭服务 powershell -ExecutionPolicy Bypass .\running_status.ps1 -KillOnly

# -KillOnly，就只停服务
param(
    [switch]$KillOnly          
)

# 下载仓库zip文件
$zipUrl = "https://codeload.github.com/ai-learning-assistant-dev/ai-learning-assistant-rtc-backend/zip/refs/heads/shiftonetothree_dev"
$zipFile = "repo.zip"
$extractedDir = "ai-learning-assistant-rtc-backend-shiftonetothree_dev"

# 设定Hugging Face国内镜像
$env:HF_ENDPOINT = "https://hf-mirror.com"   # 国内镜像
$env:HF_HUB_DISABLE_SYMLINKS = "1"           # Windows 下避免符号链接问题

# ========== 状态文件 Helper ==========
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

# 启动RTS服务
function Start-FlaskNonBlock {
    param(
        [int]$MaxRetry  = 30,
        [int]$Port      = 8989,
        [string]$LogOut = "$PSScriptRoot\flask.out",
        [string]$LogErr = "$PSScriptRoot\flask.err"
    )

    # 1) 非阻塞启动
    <# 
        这里启动了一个子进程，这个子进程实际上和后面我们占用8989端口的
        Flask服务还不是同一个，但是重要的是这里启动进程后脚本只会
        轮询，然后尝试记录状态
     #>
    $proc = Start-Process -FilePath "uv" -ArgumentList "run", ".\main.py" `
              -PassThru -NoNewWindow `
              -RedirectStandardOutput $LogOut `
              -RedirectStandardError  $LogErr

    # Write-Host "flask PID=$($proc.Id)  out=$LogOut err=$LogErr"

    # 这个时候我们没有PID可以传递，简单记录一下状态
    Write-Status -Status 'starting' 

    # 2) 轮询端口/进程存活
    $ok = $false
    for ($i = 1; $i -le $MaxRetry; $i++) {
        # TODO 轮询间隔为10s一次，共计10次
        Start-Sleep -Seconds 10
        if ($proc.HasExited) { break }  # 进程已经不存在了
        $tcp = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        <# 
            这里实际上存在一种通过进程实现的内存耗尽的可能
            这里假定启动Flask的进程自己失败了就会结束
            但是如果失败了也仍然保持着存在，也可能反复启动几次
            耗尽显存
         #>
        if ($tcp) {
            # $realPid = $tcp.OwningProcess
            $proc = Get-Process -Id $tcp.OwningProcess -ErrorAction SilentlyContinue
            $ok = $true
            Write-Status -Status 'running' -service_PID $tcp.OwningProcess 
            break
        }
    }

    # 3) 结果判定
    if (-not $ok) {
        taskkill /PID $proc.Id /T /F 2>$null
        Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
        return $false
    }

    return $true
}

# 修复 pyproject.toml 中的 en-core-web-sm 下载地址
function Update-SpacyModelUrl {
    param(
        [string]$TomlPath = "pyproject.toml",
        [string]$NewUrl  = "https://ghfast.top/https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
    )

    if (-not (Test-Path $TomlPath)) {
        Write-Warning "Did not found $TomlPath, Skip URL edit"
        return
    }

    $content = Get-Content $TomlPath -Raw

    # 用正则把整个 en-core-web-sm 数组抓出来（含任意缩进、换行、空格）
    $pattern = '(?sm)(^\s*en-core-web-sm\s*=\s*\[.*?\n\s*\])'
    $match   = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        Write-Host "en-core-web-sm block not found, no change made" -ForegroundColor Yellow
        return
    }

    $oldBlock = $match.Value
    # 把里面 URL 部分替换成新地址（保留其余格式）
    $newBlock = $oldBlock -replace '(https?://[^"\s]+)', $NewUrl

    if ($oldBlock -ceq $newBlock) {
        Write-Host "en-core-web-sm address already OK" -ForegroundColor Gray
        return
    }

    # 写回文件
    $newContent = $content.Replace($oldBlock, $newBlock)
    Set-Content -Path $TomlPath -Value $newContent -NoNewline
    Write-Host "Updated en-core-web-sm download address → $NewUrl" -ForegroundColor Green
}

# ========== -KillOnly 逻辑 ==========
if ($KillOnly) {
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
    exit 0
}

# 第一次检查 uv 是否存在
$uv = Get-Command -Name uv -ErrorAction SilentlyContinue
if ($uv) {
    Write-Output "uv installed, path: $($uv.Source)"
} else {
    Write-Warning "uv not found, ready to install..."

    # 通过官方脚本安装
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

    # 因为正常来说需要重新启动命令行才能刷新系统环境
    # 并不清楚为什么两类路径需要拼接才能发挥作用，但是可行
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")

    # 再次检查
    $uv = Get-Command -Name uv -ErrorAction SilentlyContinue
    if ($uv) {
        Write-Output "uv installed, path: $($uv.Source)"
    } else {
        Write-Warning "uv still not found after installation"
    }
}

# 如果没有解压的话先解压一下
if (-not (Test-Path $extractedDir -PathType Container)) {
    # 检查zip文件是否已存在，避免重复下载
    if (Test-Path $zipFile) {
        Write-Host "Code is downloaded" -ForegroundColor Green
    } else {
        try {
            Write-Host "Downloading code zip..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
            Write-Host "Download done" -ForegroundColor Green
        }
        catch {
            Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }

    # 解压到当前路径
    try {
        Write-Host "unzipping..." -ForegroundColor Yellow
        Expand-Archive -Path $zipFile -DestinationPath . -Force
        Write-Host "unziped" -ForegroundColor Green
    }
    catch {
        Write-Host "zip the code failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# 检查是否已经解压过，如果解压目录存在则跳过下载和解压
if (Test-Path $extractedDir) {
    try {
        Write-Host "Code is unziped..." -ForegroundColor Green
        Set-Location $extractedDir
        # 修正需要国内源的包地址
        Write-Host "Edit uv config for download" -ForegroundColor Yellow
        Update-SpacyModelUrl
        Write-Host "Checking uv env and try sync." -ForegroundColor Yellow
        <# 
            如果lock文件是存在的，那么没有必要重复的安装依赖
        #>
        if (Test-Path "uv.lock") {
            Write-Host "uv.lock existed,no need sync." -ForegroundColor Gray
        } else {
            Write-Host "running uv sync" -ForegroundColor Yellow
            uv sync --extra cu128
        }
        Write-Host "Try to run flask service." -ForegroundColor Yellow
        $success = Start-FlaskNonBlock
        if (-not $success) { exit 1 }   # 启动失败，脚本可以退出了
    }
    catch {
        # 控制台报错
        Write-Host ">>> 启动阶段异常: $($_.Exception.Message)" -ForegroundColor Red
        Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
        exit 1
    }
}
# 路径不存在
else {
    Write-Host "folder doesn't exist: $extractedDir" -ForegroundColor Red
    exit 1
}