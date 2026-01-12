<# 
    该脚本预期行为返回json中的 status 字段，并默认以0正确退出
    关于测试的备注：快速验证该脚本在Terminal的exit code
    echo "退出码: $LASTEXITCODE"
 #>
$statusFile = "service-status.json"
$st = Get-Content $statusFile -Raw | ConvertFrom-Json
Write-Output $st.status   
exit 0