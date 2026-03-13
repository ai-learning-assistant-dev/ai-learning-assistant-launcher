<#
  单独测试：powershell -ExecutionPolicy Bypass .\install.ps1
#>

$zipUrl = "https://codeload.github.com/shenyaoguan/ai-learning-assistant-voice-backend/zip/refs/heads/shenyaoguan_dev"
$zipFile = "repo.zip"
$extractedDir = "ai-learning-assistant-voice-backend-shenyaoguan_dev"
$legacyExtractedDir = "ai-learning-assistant-voice-backend-main"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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
    Write-Output "error: uv not found after installation attempt"
    exit 1
}

try {
    Set-Location $scriptDir

    if (Test-Path $zipFile) {
        Remove-Item -Path $zipFile -Force
    }

    if (Test-Path $legacyExtractedDir) {
        Remove-Item -Path $legacyExtractedDir -Recurse -Force
    }

    if (Test-Path $extractedDir) {
        Remove-Item -Path $extractedDir -Recurse -Force
    }

    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    Expand-Archive -Path $zipFile -DestinationPath . -Force

    if (-not (Test-Path $extractedDir)) {
        throw "Expected extracted directory '$extractedDir' was not found after expanding zip."
    }

    Set-Location $extractedDir
    & $uvPath sync

    if ($LASTEXITCODE -ne 0) {
        Write-Output "error: uv sync failed with exit code $LASTEXITCODE"
        exit 1
    }

    Write-Output "success"
    exit 0
}
catch {
    Write-Output "error: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) {
        Write-Output $_.ScriptStackTrace
    }
    exit 1
}
