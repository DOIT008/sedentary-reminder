param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Target)

# electron.exe 是 GUI 子系统程序：直接调用不阻塞也没有 stdout。
# 另外 Qoder 的进程树会带 ELECTRON_RUN_AS_NODE=1，会把 Electron 降级成纯 Node，必须先清掉。
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$env:ELECTRON_ENABLE_STACK_DUMPING = '1'

$exe = Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) { Write-Error "找不到 Electron: $exe"; exit 2 }

$proc = Start-Process -FilePath $exe -ArgumentList $Target -WorkingDirectory (Get-Location).Path -Wait -PassThru -WindowStyle Hidden
exit $proc.ExitCode
