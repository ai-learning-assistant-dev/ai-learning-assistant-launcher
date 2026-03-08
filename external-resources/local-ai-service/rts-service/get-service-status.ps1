<# 
    该脚本预期行为返回json中的 status 字段，并默认以0正确退出
    关于测试的备注：快速验证该脚本在Terminal的exit code
    echo "退出码: $LASTEXITCODE"
 #>

$statusFile = "$PSScriptRoot\service-status.json"

if (-not (Test-Path $statusFile)) {
    Write-Output "not_installed"
    exit 0
}

try {
    # Use FileStream with shared read access to avoid locking conflicts
    $fileStream = [System.IO.File]::Open($statusFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($fileStream)
    $raw = $reader.ReadToEnd()
    $reader.Close()
    $fileStream.Close()
    
    $st = $raw | ConvertFrom-Json
    Write-Output $st.status
} catch {
    Write-Output "error"
}
exit 0
