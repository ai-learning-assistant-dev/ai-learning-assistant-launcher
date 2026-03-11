<#
  单独测试：powershell -ExecutionPolicy Bypass .\install.ps1
#>

$zipUrl = "https://codeload.github.com/shenyaoguan/ai-learning-assistant-voice-backend/zip/refs/heads/shenyaoguan_dev"
$zipFile = "repo.zip"
$extractedDir = "ai-learning-assistant-voice-backend-shenyaoguan_dev"

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

function Ensure-Uv {
    $uvPath = Find-UvPath
    if ($uvPath) {
        return $uvPath
    }

    powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")

    return Find-UvPath
}

$uvPath = Ensure-Uv
if (-not $uvPath) {
    Write-Output "error"
    exit 1
}

try {
    if (-not (Test-Path $zipFile)) {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    }

    if (-not (Test-Path $extractedDir)) {
        Expand-Archive -Path $zipFile -DestinationPath . -Force
    }

    Set-Location $extractedDir
    & $uvPath sync

    if ($LASTEXITCODE -ne 0) {
        Write-Output "error"
        exit 1
    }

    Write-Output "success"
    exit 0
}
catch {
    Write-Output "error"
    exit 1
}
