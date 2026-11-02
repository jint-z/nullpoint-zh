$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $repo 'apps/desktop/build/upgrade-core.ps1')
$manifests = Get-Content -Raw -Encoding UTF8 (Join-Path $repo 'apps/desktop/build/upgrade-manifests.json') | ConvertFrom-Json
$testBase = Join-Path $repo 'validation/.upgrade-guard-test'
New-Item -ItemType Directory -Path $testBase -Force | Out-Null
$testBase = (Resolve-Path -LiteralPath $testBase).Path
$root = Join-Path $testBase ('unit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw "FAIL: $Message" } }
function ExpectFailure([scriptblock]$Action, [string]$MessagePart) {
    try { & $Action; throw 'Expected failure did not occur' }
    catch { if ($_.Exception.Message -notlike "*$MessagePart*") { throw "Unexpected error: $($_.Exception.Message)" } }
}
$fixtureDir = Join-Path $root 'uninstaller-fixture'
$sourceUninstaller = Join-Path $fixtureDir 'Uninstall Nullpoint-zh.exe'
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
$makensis = Join-Path $env:LOCALAPPDATA 'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe'
$maker = Join-Path $root 'make-uninstaller.exe'
$fixtureScript = @'
Unicode true
RequestExecutionLevel user
VIProductVersion "1.2.3.0"
VIAddVersionKey "FileVersion" "1.2.3"
VIAddVersionKey "ProductName" "Nullpoint 中文版"
OutFile "@MAKER@"
InstallDir "@FIXTURE@"
SilentInstall silent
Section
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall Nullpoint-zh.exe"
SectionEnd
Section "Uninstall"
  SetErrorLevel 1
  Quit
SectionEnd
'@
$fixtureScript = $fixtureScript.Replace('@MAKER@', $maker).Replace('@FIXTURE@', $fixtureDir)
$fixtureScriptPath = Join-Path $root 'make-uninstaller.nsi'
[IO.File]::WriteAllText($fixtureScriptPath, $fixtureScript, (New-Object Text.UTF8Encoding($true)))
& $makensis $fixtureScriptPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the test uninstaller.' }
$generator = Start-Process -FilePath $maker -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($generator.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $sourceUninstaller)) { throw 'Could not create the test uninstaller.' }
function New-Fixture([string]$Name, [string]$Scope) {
    $dir = Join-Path $root $Name
    New-Item -ItemType Directory -Path $dir | Out-Null
    $sourceExe = Join-Path $repo '../local-1.2.3/win-unpacked/Nullpoint-zh.exe'
    New-Item -ItemType HardLink -Path (Join-Path $dir 'Nullpoint-zh.exe') -Target $sourceExe | Out-Null
    Copy-Item -LiteralPath $sourceUninstaller -Destination (Join-Path $dir 'Uninstall Nullpoint-zh.exe')
    $mode = if ($Scope -eq 'all') { '/allusers' } else { '/currentuser' }
    return [pscustomobject]@{ Scope=$Scope; Path=$dir; Version='1.2.3'; Name='Nullpoint 中文版 1.2.3'; Uninstall=('"' + (Join-Path $dir 'Uninstall Nullpoint-zh.exe') + '" ' + $mode) }
}
try {
    $empty = Get-UpgradePlan @() $manifests '1.2.3'
    Assert (@($empty.Records).Count -eq 0 -and $null -eq $empty.Selected) 'fresh install'
    ExpectFailure { Get-SafeLocalPath '\\server\share\Nullpoint-zh' $false } '本地绝对路径'
    $fakeManifest = [pscustomobject]@{versions=[pscustomobject]@{'1.2.3'=@('Nullpoint-zh.exe','Uninstall Nullpoint-zh.exe')}}
    $user = New-Fixture 'user-install' 'user'
    $all = New-Fixture 'all-install' 'all'
    $onlyUser = Get-UpgradePlan @($user) $fakeManifest '1.2.3'
    Assert ($onlyUser.Selected.Scope -eq 'user') 'user install stays user'
    $upgrade = Get-UpgradePlan @($user) $manifests '1.2.4'
    Assert ($upgrade.Selected.Scope -eq 'user' -and $upgrade.Selected.Version -eq '1.2.3') '1.2.3 to 1.2.4 upgrade plan'
    $nextUpgrade = Get-UpgradePlan @($user) $manifests '1.2.5'
    Assert ($nextUpgrade.Selected.Scope -eq 'user' -and $nextUpgrade.Selected.Version -eq '1.2.3') '1.2.3 to 1.2.5 upgrade plan'
    $latestUpgrade = Get-UpgradePlan @($user) $manifests '1.2.6'
    Assert ($latestUpgrade.Selected.Scope -eq 'user' -and $latestUpgrade.Selected.Version -eq '1.2.3') '1.2.3 to 1.2.6 upgrade plan'
    $both = Get-UpgradePlan @($user,$all) $fakeManifest '1.2.3'
    Assert ($both.Selected.Scope -eq 'all') 'machine wins with two installs'
    Assert ((Assert-Target $both $all.Path 'all') -eq $all.Path) 'same machine directory'
    ExpectFailure { Assert-Target $both $user.Path 'user' } '升级必须保留'
    $mixed = [pscustomobject]@{Scope='user';Path=$user.Path;Version='1.2.3';Name='Nullpoint 1.2.3';Uninstall=$user.Uninstall}
    ExpectFailure { Get-UpgradePlan @($mixed) $fakeManifest '1.2.3' } '卸载记录'
    $same = [pscustomobject]@{Scope='user';Path=$all.Path;Version='1.2.3';Name='Nullpoint 中文版 1.2.3';Uninstall=('"' + (Join-Path $all.Path 'Uninstall Nullpoint-zh.exe') + '" /currentuser')}
    ExpectFailure { Get-UpgradePlan @($same,$all) $fakeManifest '1.2.3' } '同一目录'
    $newer = [pscustomobject]@{Scope='user';Path=$user.Path;Version='1.2.4';Name='Nullpoint 中文版 1.2.4';Uninstall=$user.Uninstall}
    ExpectFailure { Get-UpgradePlan @($newer) $fakeManifest '1.2.3' } '较新版本'
    $bad = [pscustomobject]@{Scope='user';Path=$user.Path;Version='1.2.3';Name=$user.Name;Uninstall='"C:\unexpected.exe" /currentuser'}
    ExpectFailure { Get-UpgradePlan @($bad) $fakeManifest '1.2.3' } '卸载记录'
    Set-Content -LiteralPath (Join-Path $user.Path 'personal-file.txt') -Value 'preserve'
    ExpectFailure { Get-UpgradePlan @($user) $fakeManifest '1.2.3' } '额外文件'
    Remove-Item -LiteralPath (Join-Path $user.Path 'personal-file.txt')
    Copy-Item -LiteralPath (Join-Path $repo '../local-1.2.2/win-unpacked/Nullpoint-zh.exe') -Destination (Join-Path $user.Path 'Uninstall Nullpoint-zh.exe') -Force
    ExpectFailure { Get-UpgradePlan @($user) $fakeManifest '1.2.3' } '卸载器版本'
    Remove-Item -LiteralPath (Join-Path $user.Path 'Uninstall Nullpoint-zh.exe')
    ExpectFailure { Get-UpgradePlan @($user) $fakeManifest '1.2.3' } '缺少程序或卸载器'
    $fresh = Join-Path $root 'fresh'
    New-Item -ItemType Directory -Path $fresh | Out-Null
    Assert ((Assert-Target $empty $fresh 'user') -eq $fresh) 'fresh empty directory'
    Set-Content -LiteralPath (Join-Path $fresh 'personal.txt') -Value 'preserve'
    ExpectFailure { Assert-Target $empty $fresh 'user' } '不是空目录'
    $profile = Join-Path $root 'profile'
    New-Item -ItemType Directory -Path (Join-Path $profile 'nested') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $profile 'settings.json') -Value '{"language":"en","theme":"dark","eqProfiles":[1]}'
    Set-Content -LiteralPath (Join-Path $profile 'nested/data.txt') -Value 'serial settings'
    $snapshot = @(Get-ProfileSnapshot $profile)
    Assert ($snapshot.Count -eq 3) 'complete profile snapshot'
    Assert-ProfileSnapshot $profile $snapshot
    Set-Content -LiteralPath (Join-Path $profile 'settings.json') -Value 'changed'
    ExpectFailure { Assert-ProfileSnapshot $profile $snapshot } '内容发生变化'
    'PASS: upgrade plans, legacy product identity, scope selection, target, version, uninstaller, extra files, and profile checks'
} finally {
    $resolved = (Resolve-Path -LiteralPath $root).Path
    $prefix = [IO.Path]::GetFullPath($testBase).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete an unexpected fixture path: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
