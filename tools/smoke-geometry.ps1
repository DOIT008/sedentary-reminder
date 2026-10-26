param([Parameter(Mandatory = $true)][int]$TargetPid)

# 用 Win32 直接量一遍遮罩窗口：它是不是真的盖住了任务栏。
# PowerShell 默认不感知 DPI，先声明感知，否则拿到的是虚拟化坐标。
# 本文件必须存成「UTF-8 BOM + CRLF」：PS 5.1 按 ACP(936) 读无 BOM 文件，中文注释会吃掉换行。
Add-Type -Path (Join-Path $PSScriptRoot 'win32-probe.cs')

[void][Win32]::SetProcessDPIAware()
$cx = [Win32]::GetSystemMetrics(0)
$cy = [Win32]::GetSystemMetrics(1)

$found = New-Object System.Collections.ArrayList
$cb = [Win32+EnumProc] {
  param($h, $l)
  if ([Win32]::PidOf($h) -eq $TargetPid -and [Win32]::IsWindowVisible($h)) {
    $r = New-Object Win32+RECT
    [void][Win32]::GetWindowRect($h, [ref]$r)
    [void]$found.Add([pscustomobject]@{
      hwnd = $h.ToInt64(); class = [Win32]::ClassOf($h)
      left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom
    })
  }
  return $true
}
[void][Win32]::EnumWindows($cb, [IntPtr]::Zero)

$taskbar = [Win32]::FindWindowW('Shell_TrayWnd', $null)
$tbRect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($taskbar, [ref]$tbRect)

# 任务栏正中：遮罩盖得住这里才算真的压住任务栏
$pt = New-Object Win32+POINT
$pt.X = [math]::Floor(($tbRect.Left + $tbRect.Right) / 2)
$pt.Y = [math]::Floor(($tbRect.Top + $tbRect.Bottom) / 2)
$hit = [Win32]::WindowFromPoint($pt)
$hitRoot = [Win32]::RootOf($hit)

$covers = @($found | Where-Object { $_.left -le 0 -and $_.top -le 0 -and $_.right -ge $cx -and $_.bottom -ge $cy })

$out = [pscustomobject]@{
  screen = @{ w = $cx; h = $cy }
  taskbar = @{ hwnd = $taskbar.ToInt64(); rect = @($tbRect.Left, $tbRect.Top, $tbRect.Right, $tbRect.Bottom) }
  hit = $hit.ToInt64()
  hitPid = [Win32]::PidOf($hit)
  hitClass = [Win32]::ClassOf($hit)
  hitOnTaskbar = ($hitRoot.ToInt64() -eq $taskbar.ToInt64())
  hitOnOurs = ([Win32]::PidOf($hit) -eq $TargetPid)
  windows = $found
  coversWholeScreen = $covers
}
$out | ConvertTo-Json -Depth 6 -Compress
