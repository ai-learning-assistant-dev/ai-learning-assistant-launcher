<# 
  Comment：
    单独测试该脚本：powershell -ExecutionPolicy Bypass .\install.ps1
  预期结束码 0 返回值 success 解压成功
 #>

# RTS Service Repo 的代码下载地址
$zipUrl = "https://codeload.github.com/ai-learning-assistant-dev/ai-learning-assistant-rtc-backend/zip/refs/heads/shiftonetothree_dev"
# 命名下载的文件名
$zipFile = "repo.zip"
<# 
  Comment：
    这个路径这么写的预期行为是希望解压到脚本所在位置 
 #>
$extractedDir = "ai-learning-assistant-rtc-backend-shiftonetothree_dev"

# 设定Hugging Face国内镜像以解决RTS依赖安装过程中的网络问题
$env:HF_ENDPOINT = "https://hf-mirror.com"   
# # Windows 下避免符号链接问题
$env:HF_HUB_DISABLE_SYMLINKS = "1"           

function Sync-UvEnvironment {
  Write-Host "Checking uv env and try sync." -ForegroundColor Yellow
  # 如果 lock 文件存在，跳过同步 
  if(Test-Path "uv.lock"){
    Write-Host "uv.lock existed, no need sync." -ForegroundColor Yellow
    return
  }

  Write-Host "Running uv sync..." -ForegroundColor Yellow
  uv sync --extra cu128
  if ($LASTEXITCODE -eq 0) {
    Write-Host "uv sync completed successfully." -ForegroundColor Green
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
$uv = Get-Command -Name uv -ErrorAction SilentlyContinue
if ($uv) {
  Write-Host "uv installed, path: $($uv.Source)"
}
else {
  Write-Warning "uv not found, ready to install..."

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
  }
  else {
    Write-Warning "uv still not found after installation"
  }
}

try {
  if (Test-Path $zipFile) { 
    Write-Host "Zip file already exists. Skipping download." -ForegroundColor Cyan
  }
  else {
    Write-Host "Downloading RTS code zip..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    Write-Host "Download done" -ForegroundColor Green
  }
}
catch {
  Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
  # exit 1
}

try {
  if (Test-Path $extractedDir) {
    Write-Host "Code is unzipped..." -ForegroundColor Green
    Set-Location $extractedDir
    # 修正需要国内源的包地址
    Write-Host "Edit uv config for download" -ForegroundColor Yellow
    Update-SpacyModelUrl
    Sync-UvEnvironment 
  }
  else {
    Write-Host "Folder doesn't exist: $extractedDir" -ForegroundColor Red
    Write-Host "Unzipping..." -ForegroundColor Yellow
    Expand-Archive -Path $zipFile -DestinationPath . -Force
    Write-Host "Unziped" -ForegroundColor Green
    Set-Location $extractedDir
    # 修正需要国内源的包地址
    Write-Host "Edit uv config for download" -ForegroundColor Yellow
    Update-SpacyModelUrl
    Sync-UvEnvironment 
  }
  Write-Output "success"   
  # exit 0                   
}
catch {
  Write-Host "zip the code failed" -ForegroundColor Red
  Write-Output "error"
  # exit 0               
}
Write-Output "success"
# exit 0