# Shared installer guard functions. Kept separate so validation can exercise the same checks.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Stop-Upgrade([string]$Code, [string]$Message) {
    $ex = New-Object System.InvalidOperationException($Message)
    $ex.Data['NullpointCode'] = $Code
    throw $ex
}

function Get-InteractiveUserSid {
    if (-not ('NullpointInstallerShell' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NullpointInstallerShell {
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
"@
    }
    $window = [NullpointInstallerShell]::GetShellWindow()
    [uint32]$processId = 0
    [void][NullpointInstallerShell]::GetWindowThreadProcessId($window, [ref]$processId)
    if ($window -eq [IntPtr]::Zero -or $processId -eq 0) {
        Stop-Upgrade 'IDENTITY' '无法确认当前登录账户，请从该账户的桌面启动安装器。'
    }
    try {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" | Invoke-CimMethod -MethodName GetOwnerSid
        if ($owner.ReturnValue -ne 0 -or -not $owner.Sid) { throw 'Cannot resolve desktop owner' }
        return [string]$owner.Sid
    } catch {
        Stop-Upgrade 'IDENTITY' '无法核实桌面账户，安装已停止。'
    }
}

function Assert-InteractiveIdentity {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $desktop = Get-InteractiveUserSid
    if ($current -ne $desktop) {
        Stop-Upgrade 'IDENTITY' '管理员账户与启动安装器的桌面账户不同，无法安全处理当前用户安装。请使用当前账户的管理员授权后重试。'
    }
    return $current
}

function Assert-NoRunningApp {
    $running = @(Get-Process -Name 'Nullpoint-zh' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        Stop-Upgrade 'RUNNING' '请先从托盘完全退出 Nullpoint，再重新运行安装器。'
    }
}

function Get-RegistryRecord([Microsoft.Win32.RegistryHive]$Hive, [Microsoft.Win32.RegistryView]$View, [string]$Scope) {
    $guid = '4bba9de6-1625-56f4-9a08-fd7fccc27356'
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
    $installKey = $null
    $uninstallKey = $null
    try {
        $installKey = $base.OpenSubKey("Software\$guid", $false)
        $uninstallKey = $base.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid", $false)
        if ($null -eq $installKey -and $null -eq $uninstallKey) { return $null }
        if ($null -eq $installKey -or $null -eq $uninstallKey) {
            Stop-Upgrade 'REGISTRY' "检测到不完整的 $Scope 安装记录，请先修复或卸载该记录。"
        }
        return [pscustomobject]@{
            Scope = $Scope
            Path = [string]$installKey.GetValue('InstallLocation', '')
            Version = [string]$uninstallKey.GetValue('DisplayVersion', '')
            Name = [string]$uninstallKey.GetValue('DisplayName', '')
            Uninstall = [string]$uninstallKey.GetValue('UninstallString', '')
        }
    } finally {
        if ($null -ne $installKey) { $installKey.Dispose() }
        if ($null -ne $uninstallKey) { $uninstallKey.Dispose() }
        $base.Dispose()
    }
}

function Get-InstalledRecords {
    $results = New-Object System.Collections.ArrayList
    foreach ($entry in @(
        @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; Scope = 'user' },
        @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; Scope = 'all' }
    )) {
        $v64 = Get-RegistryRecord $entry.Hive ([Microsoft.Win32.RegistryView]::Registry64) $entry.Scope
        $v32 = Get-RegistryRecord $entry.Hive ([Microsoft.Win32.RegistryView]::Registry32) $entry.Scope
        if ($null -ne $v32) {
            if ($entry.Scope -eq 'all' -or $null -eq $v64 -or $v32.Path -ne $v64.Path -or $v32.Version -ne $v64.Version -or
                $v32.Uninstall -ne $v64.Uninstall) {
                Stop-Upgrade 'REGISTRY' "检测到冲突的 32 位与 64 位安装记录（$($entry.Scope)），请先修复记录。"
            }
        }
        if ($null -ne $v64) { [void]$results.Add($v64) }
    }
    return $results.ToArray()
}

function Get-SafeLocalPath([string]$Path, [bool]$MustExist) {
    if (-not $Path -or $Path -notmatch '^[a-zA-Z]:\\') {
        Stop-Upgrade 'PATH' "安装路径不是有效的本地绝对路径：$Path"
    }
    try { $full = [IO.Path]::GetFullPath($Path).TrimEnd('\') } catch {
        Stop-Upgrade 'PATH' "安装路径无效：$Path"
    }
    if ($full.Length -le 3) { Stop-Upgrade 'PATH' "安装路径不能是磁盘根目录：$Path" }
    try {
        $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($full))
        if (-not $drive.IsReady -or $drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) {
            Stop-Upgrade 'PATH' "无法确认路径位于可用的本地磁盘：$full"
        }
    } catch {
        Stop-Upgrade 'PATH' "无法确认路径位于可用的本地磁盘：$full"
    }
    $protected = @(
        [Environment]::GetFolderPath('Windows'),
        [Environment]::GetFolderPath('UserProfile'),
        [Environment]::GetFolderPath('ProgramFiles'),
        [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    ) | Where-Object { $_ }
    foreach ($item in $protected) {
        if ($full -eq ([IO.Path]::GetFullPath($item).TrimEnd('\'))) {
            Stop-Upgrade 'PATH' "安装路径指向受保护目录：$full"
        }
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Container)) {
        Stop-Upgrade 'PATH' "安装目录不存在：$full"
    }
    $cursor = $full
    while ($cursor -and $cursor.Length -gt 3) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                Stop-Upgrade 'PATH' "安装路径包含链接或重解析点：$cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent.TrimEnd('\')
    }
    return $full
}

function Get-Version3([string]$Value) {
    if ($Value -notmatch '^\d+\.\d+\.\d+(\.0)?$') {
        Stop-Upgrade 'VERSION' "无法识别已安装版本：$Value"
    }
    $v = [version]$Value
    return [version]("{0}.{1}.{2}" -f $v.Major, $v.Minor, $v.Build)
}

function Assert-KnownFiles([string]$Path, [string[]]$Allowed) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $Allowed) { [void]$set.Add(($name -replace '/', '\')) }
    foreach ($item in @(Get-ChildItem -LiteralPath $Path -Recurse -Force)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Upgrade 'EXTRA' "安装目录包含链接或重解析点：$($item.FullName)"
        }
        $relative = $item.FullName.Substring($Path.Length).TrimStart('\')
        if (-not $set.Contains($relative)) {
            Stop-Upgrade 'EXTRA' "安装目录包含无法确认归属的额外文件或文件夹：$($item.FullName)"
        }
    }
}

function Assert-InstalledRecord($Record, $Manifests, [string]$TargetVersion) {
    $path = Get-SafeLocalPath $Record.Path $true
    $installed = Get-Version3 $Record.Version
    $target = Get-Version3 $TargetVersion
    if ($installed -gt $target) {
        Stop-Upgrade 'DOWNGRADE' "已安装较新版本 $installed，不能使用 $target 安装包降级。"
    }
    $version = $installed.ToString(3)
    $manifestProperty = $Manifests.versions.PSObject.Properties[$version]
    if ($null -eq $manifestProperty) {
        Stop-Upgrade 'VERSION' "没有版本 $version 的文件清单，无法安全覆盖。"
    }
    $exe = Join-Path $path 'Nullpoint-zh.exe'
    $uninstaller = Join-Path $path 'Uninstall Nullpoint-zh.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        Stop-Upgrade 'MISSING' "安装目录缺少程序或卸载器：$path"
    }
    $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    # Earlier packages used the longer product name. All three identity sources
    # must still agree, including when reinstalling an earlier 1.2.3 build.
    $productName = [string]$versionInfo.ProductName
    if ((Get-Version3 $versionInfo.FileVersion) -ne $installed -or $productName -notin @('Nullpoint', 'Nullpoint 中文版')) {
        Stop-Upgrade 'VERSION' "安装记录与程序版本或产品名称不一致：$path"
    }
    $uninstallerInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($uninstaller)
    if ((Get-Version3 $uninstallerInfo.FileVersion) -ne $installed -or $uninstallerInfo.ProductName -ne $productName) {
        Stop-Upgrade 'VERSION' "卸载器版本或产品名称与安装记录不一致：$path"
    }
    $expectedSwitch = if ($Record.Scope -eq 'all') { '/allusers' } else { '/currentuser' }
    $expected = '"' + $uninstaller + '" ' + $expectedSwitch
    if ($Record.Uninstall.Trim() -ine $expected -or $Record.Name -ne "$productName $version") {
        Stop-Upgrade 'REGISTRY' "卸载记录与安装目录不一致：$path"
    }
    Assert-KnownFiles $path ([string[]]$manifestProperty.Value)
    $Record.Path = $path
    $Record.Version = $version
}

function Get-UpgradePlan($Records, $Manifests, [string]$TargetVersion) {
    $items = @($Records)
    foreach ($record in $items) { Assert-InstalledRecord $record $Manifests $TargetVersion }
    if ($items.Count -gt 2) { Stop-Upgrade 'REGISTRY' '检测到超过两条安装记录，无法自动处理。' }
    $machine = @($items | Where-Object { $_.Scope -eq 'all' })
    $user = @($items | Where-Object { $_.Scope -eq 'user' })
    if ($machine.Count -gt 1 -or $user.Count -gt 1) { Stop-Upgrade 'REGISTRY' '检测到重复的安装范围。' }
    if ($machine.Count -and $user.Count -and $machine[0].Path -ieq $user[0].Path) {
        Stop-Upgrade 'REGISTRY' '两个安装记录指向同一目录，请先修复安装记录。'
    }
    $selected = if ($machine.Count) { $machine[0] } elseif ($user.Count) { $user[0] } else { $null }
    return [pscustomobject]@{ Records = $items; Selected = $selected }
}

function Assert-Target($Plan, [string]$Path, [string]$Scope) {
    $target = Get-SafeLocalPath $Path $false
    if ($null -ne $Plan.Selected) {
        if ($Plan.Selected.Scope -ne $Scope -or $Plan.Selected.Path -ine $target) {
            Stop-Upgrade 'TARGET' "升级必须保留原有安装范围和目录：$($Plan.Selected.Path)"
        }
    } elseif (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath $target -PathType Container) -or @(Get-ChildItem -LiteralPath $target -Force).Count -ne 0) {
            Stop-Upgrade 'TARGET' "全新安装的目标目录不是空目录：$target"
        }
    }
    return $target
}

function Get-ProfileSnapshot([string]$Path) {
    $items = @()
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    foreach ($item in @(Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Upgrade 'BACKUP' "配置目录包含无法安全备份的链接：$($item.FullName)"
        }
        $relative = $item.FullName.Substring($Path.Length).TrimStart('\')
        if ($item.PSIsContainer) {
            $items += [pscustomobject]@{ Path = $relative; Directory = $true; Hash = '' }
        } else {
            $items += [pscustomobject]@{ Path = $relative; Directory = $false; Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        }
    }
    return $items
}

function Assert-ProfileSnapshot([string]$Path, $Snapshot) {
    foreach ($item in @($Snapshot)) {
        $target = Join-Path $Path $item.Path
        if ($item.Directory) {
            if (-not (Test-Path -LiteralPath $target -PathType Container)) { Stop-Upgrade 'BACKUP' "配置目录缺失：$target" }
        } else {
            if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or
                (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item.Hash) {
                Stop-Upgrade 'BACKUP' "配置文件缺失或内容发生变化：$target"
            }
        }
    }
}
