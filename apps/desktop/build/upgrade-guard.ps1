[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Scan', 'Prepare', 'Final')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][string]$ErrorPath,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [string]$TargetPath = '',
    [ValidateSet('', 'user', 'all')][string]$Scope = '',
    [string]$TargetVersion = '1.2.6'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'upgrade-core.ps1')

function Write-JsonFile([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

function Get-RecordSignature($Plan) {
    return (@($Plan.Records | ForEach-Object {
        '{0}|{1}|{2}|{3}|{4}' -f $_.Scope, $_.Version, $_.Path.ToLowerInvariant(), $_.Uninstall.ToLowerInvariant(), $_.Name.ToLowerInvariant()
    } | Sort-Object) -join [char]10)
}

$backup = ''
try {
    $identity = Assert-InteractiveIdentity
    $manifests = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifests.schema -ne 1) { Stop-Upgrade 'MANIFEST' '安装文件清单格式无效。' }

    if ($Phase -eq 'Scan') {
        Assert-NoRunningApp
        $plan = Get-UpgradePlan @(Get-InstalledRecords) $manifests $TargetVersion
        Write-JsonFile $StatePath ([pscustomobject]@{
            Sid = $identity; Signature = (Get-RecordSignature $plan); Records = @($plan.Records)
            TargetVersion = $TargetVersion; Prepared = $false
        })
        $mode = if ($null -eq $plan.Selected) { 'fresh' } else { $plan.Selected.Scope }
        [IO.File]::WriteAllText($StatePath + '.mode', $mode, [Text.Encoding]::ASCII)
    } elseif ($Phase -eq 'Prepare') {
        Assert-NoRunningApp
        if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { Stop-Upgrade 'STATE' '安装检查状态缺失，请重新运行安装器。' }
        $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.Sid -ne $identity -or $state.TargetVersion -ne $TargetVersion) {
            Stop-Upgrade 'IDENTITY' '安装检查账户已发生变化，请重新运行安装器。'
        }
        $plan = Get-UpgradePlan @(Get-InstalledRecords) $manifests $TargetVersion
        if ((Get-RecordSignature $plan) -ne $state.Signature) {
            Stop-Upgrade 'CHANGED' '安装记录在检查期间发生变化，请重新运行安装器。'
        }
        $target = Assert-Target $plan $TargetPath $Scope
        $profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Nullpoint-zh'
        $profileExists = Test-Path -LiteralPath $profile -PathType Container
        $snapshot = @()
        if ($profileExists) {
            $null = Get-SafeLocalPath $profile $true
            $snapshot = @(Get-ProfileSnapshot $profile)
            $backupRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nullpoint-zh-upgrade-backups'
            $backup = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
            Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'profile') -Recurse -Force -ErrorAction Stop
            Assert-ProfileSnapshot (Join-Path $backup 'profile') $snapshot
        }
        Write-JsonFile $StatePath ([pscustomobject]@{
            Sid = $identity; Signature = $state.Signature; Records = @($plan.Records)
            TargetVersion = $TargetVersion; Prepared = $true; Target = $target; Scope = $Scope
            Profile = $profile; ProfileExists = $profileExists; Snapshot = $snapshot; Backup = $backup
        })
    } else {
        Assert-NoRunningApp
        if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { Stop-Upgrade 'STATE' '安装检查状态缺失。' }
        $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $state.Prepared -or $state.Sid -ne $identity -or $state.TargetVersion -ne $TargetVersion) {
            Stop-Upgrade 'STATE' '安装前检查没有完成，无法确认升级结果。'
        }
        $plan = Get-UpgradePlan @(Get-InstalledRecords) $manifests $TargetVersion
        if (@($plan.Records).Count -ne 1 -or $plan.Selected.Scope -ne $state.Scope -or
            $plan.Selected.Path -ine $state.Target -or $plan.Selected.Version -ne $TargetVersion) {
            Stop-Upgrade 'FINAL' '安装后仍存在重复记录，或安装版本和目标目录不匹配。'
        }
        foreach ($old in @($state.Records)) {
            if ($old.Path -ine $state.Target -and (Test-Path -LiteralPath $old.Path)) {
                if (-not (Test-Path -LiteralPath $old.Path -PathType Container) -or
                    @(Get-ChildItem -LiteralPath $old.Path -Force).Count -ne 0) {
                    Stop-Upgrade 'FINAL' "旧版安装目录仍有文件或文件夹：$($old.Path)"
                }
            }
        }
        if ($state.ProfileExists) { Assert-ProfileSnapshot $state.Profile $state.Snapshot }
    }
    [IO.File]::WriteAllText($ErrorPath, '', [Text.Encoding]::Unicode)
    exit 0
} catch {
    $message = $_.Exception.Message
    $reportedBackup = $false
    try {
        if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
            $saved = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($saved.PSObject.Properties['Backup'] -and $saved.Backup) {
                $message += " 配置备份：$($saved.Backup)"
                $reportedBackup = $true
            }
        }
    } catch { }
    if (-not $reportedBackup -and $backup) { $message += " 配置备份目录（可能不完整）：$backup" }
    if (-not $message) { $message = '安装检查失败。' }
    [IO.File]::WriteAllText($ErrorPath, $message.Replace([string][char]13, ' ').Replace([string][char]10, ' '), [Text.Encoding]::Unicode)
    exit 2
}
