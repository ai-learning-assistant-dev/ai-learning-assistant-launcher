<# 
    该脚本预期行为返回json中的 status 字段，并默认以0正确退出
    关于测试的备注：快速验证该脚本在Terminal的exit code
    echo "退出码: $LASTEXITCODE"
 #>
# TODO 应该还要检查一下8989端口是否成功的被占用了，如果占用了按说
# 应该是rts服务，那么这里返回具体的状态，而不是直接就简单的看一下json

$statusFile = "service-status.json"
$st = Get-Content $statusFile -Raw | ConvertFrom-Json
Write-Output $st.status   
exit 0