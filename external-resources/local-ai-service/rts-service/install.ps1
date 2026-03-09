<# 
  Comment：
    单独测试该脚本：powershell -ExecutionPolicy Bypass .\install.ps1
  预期结束码 0 返回值 success 解压成功
 #>

# RTS Service Repo download URL
$zipUrl = "https://codeload.github.com/ai-learning-assistant-dev/ai-learning-assistant-rtc-backend/zip/refs/heads/shiftonetothree_dev"
$zipFile = "repo.zip"

# Service directory name (shortened to avoid Windows 260 char path limit)
# Original: ai-learning-assistant-rtc-backend-shiftonetothree_dev (52 chars)
# Shortened: rtc-backend (11 chars) - saves 41 chars per path level
# GitHub: https://github.com/ai-learning-assistant-dev/ai-learning-assistant-rtc-backend
$originalDir = "ai-learning-assistant-rtc-backend-shiftonetothree_dev"
$extractedDir = "rtc-backend"

# 设定Hugging Face国内镜像以解决RTS依赖安装过程中的网络问题
$env:HF_ENDPOINT = "https://hf-mirror.com"   
# Windows 下避免符号链接问题
$env:HF_HUB_DISABLE_SYMLINKS = "1"
# Force Python to use UTF-8 encoding for stdout/stderr (fix garbled Chinese)
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

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

function Sync-UvEnvironment {
  Write-Host "Checking uv env and try sync." -ForegroundColor Yellow
  # 如果 lock 文件存在，跳过同步 
  if(Test-Path "uv.lock"){
    Write-Host "uv.lock existed, no need sync." -ForegroundColor Yellow
    Write-Progress-Json -Percent 95 -Stage "sync_skip" -Message "Dependencies synced, skipping"
    return
  }

  Write-Progress-Json -Percent 70 -Stage "sync_start" -Message "Syncing dependencies..."
  Write-Host "Running uv sync..." -ForegroundColor Yellow
  uv sync --extra cu128
  if ($LASTEXITCODE -eq 0) {
    Write-Host "uv sync completed successfully." -ForegroundColor Green
    Write-Progress-Json -Percent 95 -Stage "sync_done" -Message "Dependencies sync complete"
    Write-Output "success"
  }
  else {
    Write-Error "uv sync failed!"
  }
}

# 显式指定 pyproject.toml 中的 en-core-web-sm 下载地址
function Update-SpacyModelUrl {
  param(
    [string]$TomlPath = "pyproject.toml",
    [string]$NewUrl = "https://ghfast.top/https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
  )

  if (-not (Test-Path $TomlPath)) {
    Write-Warning "Did not found $TomlPath, Skip URL edit"
    return
  }

  $content = Get-Content $TomlPath -Raw

  # 用正则把整个 en-core-web-sm 数组抓出来（含任意缩进、换行、空格）
  $pattern = '(?sm)(^\s*en-core-web-sm\s*=\s*\[.*?\n\s*\])'
  $match = [regex]::Match($content, $pattern)
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

# 检查 uv 是否存在
Write-Progress-Json -Percent 5 -Stage "check_uv" -Message "Checking uv package manager..."
$uv = Get-Command -Name uv -ErrorAction SilentlyContinue
if ($uv) {
  Write-Host "uv installed, path: $($uv.Source)"
  Write-Progress-Json -Percent 10 -Stage "uv_found" -Message "uv installed"
}
else {
  Write-Warning "uv not found, ready to install..."
  Write-Progress-Json -Percent 8 -Stage "install_uv" -Message "Installing uv package manager..."

  # 通过官方脚本安装
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

  # 因为正常来说需要重新启动命令行才能刷新系统环境
  # 并不清楚为什么两类路径需要拼接才能发挥作用，但是可行
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")
  # 再次检查
  $uv = Get-Command -Name uv -ErrorAction SilentlyContinue
  if ($uv) {
    Write-Host "uv installed, path: $($uv.Source)"
    Write-Progress-Json -Percent 10 -Stage "uv_installed" -Message "uv installation complete"
  }
  else {
    Write-Warning "uv still not found after installation"
    Write-Progress-Json -Percent 10 -Stage "uv_warning" -Message "uv install may have issues, trying to continue..."
  }
}

try {
  if (Test-Path $zipFile) { 
    Write-Host "Zip file already exists. Skipping download." -ForegroundColor Cyan
    Write-Progress-Json -Percent 35 -Stage "download_skip" -Message "Code package exists, skipping download"
  }
  else {
    Write-Progress-Json -Percent 15 -Stage "download_start" -Message "Downloading RTS code package..."
    Write-Host "Downloading RTS code zip..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    Write-Host "Download done" -ForegroundColor Green
    Write-Progress-Json -Percent 35 -Stage "download_done" -Message "Code package download complete"
  }
}
catch {
  Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Progress-Json -Percent 15 -Stage "download_error" -Message "Download failed: $($_.Exception.Message)"
  # exit 1
}

try {
  if (Test-Path $extractedDir) {
    Write-Host "Code is unzipped..." -ForegroundColor Green
    Write-Progress-Json -Percent 55 -Stage "extract_skip" -Message "Code already extracted, skipping"
    Set-Location $extractedDir
    # 修正需要国内源的包地址
    Write-Host "Edit uv config for download" -ForegroundColor Yellow
    Write-Progress-Json -Percent 60 -Stage "config_update" -Message "Updating config files..."
    Update-SpacyModelUrl
    Write-Progress-Json -Percent 65 -Stage "config_done" -Message "Config update complete"
    Sync-UvEnvironment 
  }
  else {
    Write-Host "Folder doesn't exist: $extractedDir" -ForegroundColor Red
    Write-Progress-Json -Percent 40 -Stage "extract_start" -Message "Extracting code package..."
    Write-Host "Unzipping..." -ForegroundColor Yellow
    Expand-Archive -Path $zipFile -DestinationPath . -Force
    Write-Host "Unziped" -ForegroundColor Green
    
    # Rename extracted directory to short name (avoid Windows path limit)
    if (Test-Path $originalDir) {
      Write-Host "Renaming $originalDir -> $extractedDir" -ForegroundColor Cyan
      Rename-Item -Path $originalDir -NewName $extractedDir -Force
    }
    
    Write-Progress-Json -Percent 55 -Stage "extract_done" -Message "Code extraction complete"
    Set-Location $extractedDir
    # 修正需要国内源的包地址
    Write-Host "Edit uv config for download" -ForegroundColor Yellow
    Write-Progress-Json -Percent 60 -Stage "config_update" -Message "Updating config files..."
    Update-SpacyModelUrl
    Write-Progress-Json -Percent 65 -Stage "config_done" -Message "Config update complete"
    Sync-UvEnvironment 
  }
  
  # Create initial status file after install success
  $statusFile = "$PSScriptRoot\service-status.json"
  @{
      status = 'stopped'
      pid    = $null
      stamp  = [datetime]::Now.ToString('o')
      error  = $null
  } | ConvertTo-Json -Compress | Set-Content -Path $statusFile -Encoding UTF8 -Force
  
  Write-Progress-Json -Percent 100 -Stage "complete" -Message "Installation complete"
  Write-Output "success"   
  # exit 0                   
}
catch {
  Write-Host "zip the code failed" -ForegroundColor Red
  Write-Progress-Json -Percent 0 -Stage "error" -Message "Installation failed: $($_.Exception.Message)"
  Write-Output "error"
}
