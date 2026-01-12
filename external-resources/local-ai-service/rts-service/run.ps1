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

    <# 
      非阻塞启动
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

    # 轮询端口确认服务进程真的启动了
    $ok = $false
    for ($i = 1; $i -le $MaxRetry; $i++) {
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
            $proc = Get-Process -Id $tcp.OwningProcess -ErrorAction SilentlyContinue
            $ok = $true
            Write-Status -Status 'running' -service_PID $tcp.OwningProcess 
            break
        }
    }

    # 结果判定
    if (-not $ok) {
        taskkill /PID $proc.Id /T /F 2>$null
        Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
        return $false
    }
    return $true
}

try {
    Write-Host "Try to run flask service." -ForegroundColor Yellow
    Set-Location $extractedDir
    $success = Start-FlaskNonBlock
    Write-Output "success"
    if (-not $success) { exit 1 }
}
catch {
    Write-Host "Running with something wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Status -Status 'error' -ErrorMsg $_.Exception.Message -service_PID $null
    exit 1
}