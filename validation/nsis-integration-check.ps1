$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sandbox = (Resolve-Path (Join-Path $PSScriptRoot '.upgrade-guard-test/nsis-sandbox')).Path
$work = Join-Path $sandbox 'work'
$guid = '2b6d87f8-8e89-42c0-8ed1-a62f0123eaf1'
$installKey = "HKCU:\Software\$guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$target = Join-Path $work 'old-install'
$profile = Join-Path $work 'profile'
$installer = Join-Path $sandbox 'release/Nullpoint-zh-Setup-1.2.3-x64.exe'
$sourceExe = Join-Path $repo '../local-1.2.2/win-unpacked/Nullpoint-zh.exe'
$legacySameVersionExe = Join-Path $repo '../local-1.2.3/win-unpacked/Nullpoint-zh.exe'
$previousNamedExe = Join-Path $repo '../local-1.2.3-renamed/win-unpacked/Nullpoint-zh.exe'
$previousRenderer = Join-Path $repo '../local-1.2.3-renamed/win-unpacked/resources/renderer'
$legacySameVersionUninstaller = Join-Path $work 'legacy-1.2.3-uninstaller.exe'
$makensis = Join-Path $env:LOCALAPPDATA 'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe'
$sharedCache = Join-Path $env:LOCALAPPDATA '@sscdesktop-updater/installer.exe'
$testCache = Join-Path $env:LOCALAPPDATA 'nullpoint-upgrade-sandbox-updater'

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw "FAIL: $Message" } }
function Invoke-Installer([string[]]$Arguments) {
    $p = Start-Process -FilePath $installer -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    $cacheHash = if (Test-Path -LiteralPath $sharedCache -PathType Leaf) { (Get-FileHash -LiteralPath $sharedCache -Algorithm SHA256).Hash } else { $null }
    if ($cacheHash -ne $sharedCacheHash) { throw 'The shared installer cache changed during the test.' }
    return $p.ExitCode
}
function Assert-Installed {
    Assert ((Get-ItemPropertyValue -LiteralPath $installKey -Name InstallLocation) -ieq $target) 'target path'
    Assert ((Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayVersion) -eq '1.2.3') 'registered version'
    Assert ((Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayName) -eq 'Nullpoint 1.2.3') 'registered display name'
    Assert ((Get-Item (Join-Path $target 'Nullpoint-zh.exe')).VersionInfo.FileVersion -match '^1\.2\.3') 'executable version'
    Assert ((Get-Item (Join-Path $target 'Nullpoint-zh.exe')).VersionInfo.ProductName -eq 'Nullpoint') 'executable product name'
    Assert ((Get-Item (Join-Path $target 'Uninstall Nullpoint-zh.exe')).VersionInfo.ProductName -eq 'Nullpoint') 'uninstaller product name'
}
function Restore-PreviousRenderer {
    $renderer = (Resolve-Path -LiteralPath (Join-Path $target 'resources/renderer')).Path
    $workPrefix = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
    if (-not $renderer.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe renderer fixture path.' }
    if (@(Get-ChildItem -LiteralPath $renderer -Recurse -Force | Where-Object {
        ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    }).Count -ne 0) { throw 'Renderer fixture contains a reparse point.' }
    Remove-Item -LiteralPath $renderer -Recurse -Force
    Copy-Item -LiteralPath $previousRenderer -Destination $renderer -Recurse -Force
}

if ((Test-Path -LiteralPath $installKey) -or (Test-Path -LiteralPath $uninstallKey)) { throw 'Test GUID already exists; refusing to overwrite it.' }
if (Test-Path -LiteralPath $testCache) { throw 'The test-specific cache already exists; refusing to overwrite it.' }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Build the test-only installer first.' }
$sharedCacheHash = if (Test-Path -LiteralPath $sharedCache -PathType Leaf) { (Get-FileHash -LiteralPath $sharedCache -Algorithm SHA256).Hash } else { $null }
$prefix = [IO.Path]::GetFullPath($sandbox).TrimEnd('\') + '\'
if (-not ([IO.Path]::GetFullPath($work)).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test path.' }
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Path $target,$profile -Force | Out-Null

# This deliberately limited stand-in is the only old uninstaller executed.
# It can remove only the exact workspace fixture and test GUID.
$nsi = @'
Unicode true
RequestExecutionLevel user
VIProductVersion "@VERSION@.0"
VIAddVersionKey "FileVersion" "@VERSION@"
VIAddVersionKey "ProductName" "Nullpoint 中文版"
OutFile "@WORK@\make-old-@VERSION@.exe"
InstallDir "@TARGET@"
SilentInstall silent
Section
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall Nullpoint-zh.exe"
SectionEnd
Section "Uninstall"
  StrCmp $INSTDIR "@TARGET@" 0 refuse
  ReadRegStr $0 HKCU "Software\@GUID@" "InstallLocation"
  StrCmp $0 "@TARGET@" 0 refuse
  IfFileExists "@WORK@\fail-uninstall.flag" refuse
  SetOutPath "$TEMP"
  RMDir /r "@TARGET@"
  IfFileExists "@TARGET@\Nullpoint-zh.exe" refuse
  DeleteRegKey HKCU "Software\@GUID@"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\@GUID@"
  SetErrorLevel 0
  Quit
refuse:
  SetErrorLevel 9
  Quit
SectionEnd
'@
foreach ($version in @('1.2.3', '1.2.2')) {
    $script = $nsi.Replace('@WORK@', $work).Replace('@TARGET@', $target).Replace('@GUID@', $guid).Replace('@VERSION@', $version)
    $scriptPath = Join-Path $work ("make-old-$version.nsi")
    [IO.File]::WriteAllText($scriptPath, $script, (New-Object Text.UTF8Encoding($true)))
    & $makensis $scriptPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not build synthetic uninstaller $version." }
    $generator = Start-Process -FilePath (Join-Path $work "make-old-$version.exe") -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    Assert ($generator.ExitCode -eq 0) "synthetic uninstaller $version creation"
    if ($version -eq '1.2.3') {
        Move-Item -LiteralPath (Join-Path $target 'Uninstall Nullpoint-zh.exe') -Destination $legacySameVersionUninstaller
    }
}
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $target 'Nullpoint-zh.exe')
Set-Content -LiteralPath (Join-Path $profile 'settings.json') -Encoding UTF8 -Value '{"language":"zh-CN","theme":"dark","reconnect":true,"equalizer":{"bands":[1,2,3]}}'
$profileHash = (Get-FileHash -LiteralPath (Join-Path $profile 'settings.json') -Algorithm SHA256).Hash
$running = $null
try {
    New-Item -Path $installKey -Force | Out-Null
    New-ItemProperty -LiteralPath $installKey -Name InstallLocation -Value $target -PropertyType String -Force | Out-Null
    New-Item -Path $uninstallKey -Force | Out-Null
    New-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value 'Nullpoint 中文版 1.2.2' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '1.2.2' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $uninstallKey -Name UninstallString -Value ('"' + (Join-Path $target 'Uninstall Nullpoint-zh.exe') + '" /currentuser') -PropertyType String -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $work 'fail-uninstall.flag') -Value '1'
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'failed old uninstaller must fail installation'
    Assert ((Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayVersion) -eq '1.2.2') 'failed uninstall preserved old registration'
    Remove-Item -LiteralPath (Join-Path $work 'fail-uninstall.flag')

    Assert ((Invoke-Installer @('/S','/currentuser')) -eq 0) 'upgrade from synthetic 1.2.2'
    Assert-Installed
    Assert ((Get-FileHash -LiteralPath (Join-Path $profile 'settings.json') -Algorithm SHA256).Hash -eq $profileHash) 'profile preserved'
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $work 'backups') -Directory).Count -ge 1) 'profile backup created'

    Assert ((Invoke-Installer @('/S','/currentuser')) -eq 0) 'same-version reinstall'
    Assert-Installed

    # A previous 1.2.3 package used the legacy display name. Simulate that
    # metadata and renderer paths with the preserved files and a synthetic uninstaller.
    Copy-Item -LiteralPath $legacySameVersionExe -Destination (Join-Path $target 'Nullpoint-zh.exe') -Force
    Copy-Item -LiteralPath $legacySameVersionUninstaller -Destination (Join-Path $target 'Uninstall Nullpoint-zh.exe') -Force
    Restore-PreviousRenderer
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value 'Nullpoint 中文版 1.2.3'
    Assert ((Invoke-Installer @('/S','/currentuser')) -eq 0) 'legacy-named 1.2.3 reinstall'
    Assert-Installed

    # The immediately preceding package already uses the new name but has an
    # older renderer asset hash. It must also remain reinstallable.
    Copy-Item -LiteralPath $previousNamedExe -Destination (Join-Path $target 'Nullpoint-zh.exe') -Force
    Restore-PreviousRenderer
    Assert ((Invoke-Installer @('/S','/currentuser')) -eq 0) 'previous 1.2.3 renderer reinstall'
    Assert-Installed
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value 'Nullpoint 中文版 1.2.3'
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'mixed product names are rejected'
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayName -Value 'Nullpoint 1.2.3'

    Assert ((Invoke-Installer @('/S','/allusers')) -ne 0) 'conflicting scope fails silently'
    Assert-Installed

    Set-Content -LiteralPath (Join-Path $target 'personal-file.txt') -Value 'preserve'
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'unknown extra file stops install'
    Assert (Test-Path -LiteralPath (Join-Path $target 'personal-file.txt')) 'unknown file preserved'
    Remove-Item -LiteralPath (Join-Path $target 'personal-file.txt')

    $oldUninstaller = Join-Path $target 'Uninstall Nullpoint-zh.exe'
    $heldUninstaller = Join-Path $work 'held-uninstaller.exe'
    Move-Item -LiteralPath $oldUninstaller -Destination $heldUninstaller
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'missing uninstaller stops install'
    Move-Item -LiteralPath $heldUninstaller -Destination $oldUninstaller

    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '1.2.4'
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'newer registered version blocks downgrade'
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '1.2.3'

    $fakeRunning = Join-Path $work 'Nullpoint-zh.exe'
    Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Destination $fakeRunning
    $running = Start-Process -FilePath $fakeRunning -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 45' -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    Assert (-not $running.HasExited) 'test process is running'
    Assert ((Invoke-Installer @('/S','/currentuser')) -ne 0) 'running app stops install'
    Stop-Process -Id $running.Id -Force
    $running = $null
    Assert-Installed
    Assert ((Get-FileHash -LiteralPath (Join-Path $profile 'settings.json') -Algorithm SHA256).Hash -eq $profileHash) 'profile remains unchanged'

    # Start the fresh-install scenario from a clean, test-only registry and path.
    Remove-Item -LiteralPath $installKey -Recurse -Force
    Remove-Item -LiteralPath $uninstallKey -Recurse -Force
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    $workPrefix = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
    if (-not $resolvedTarget.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture target.' }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    $target = Join-Path $work 'fresh-install'
    Assert ((Invoke-Installer @('/S','/currentuser',('/D=' + $target))) -eq 0) 'fresh installation'
    Assert-Installed
    Assert ((Get-FileHash -LiteralPath (Join-Path $profile 'settings.json') -Algorithm SHA256).Hash -eq $profileHash) 'fresh install preserved test profile'

    'PASS: legacy 1.2.2 upgrade, both previous 1.2.3 builds, renamed metadata, mixed-name rejection, failure cases, fresh installation, and profile backup'
} finally {
    if ($null -ne $running -and -not $running.HasExited) { Stop-Process -Id $running.Id -Force }
    # Only the explicit test GUID is removed. The fixture files remain for inspection.
    if (Test-Path -LiteralPath $installKey) { Remove-Item -LiteralPath $installKey -Recurse -Force }
    if (Test-Path -LiteralPath $uninstallKey) { Remove-Item -LiteralPath $uninstallKey -Recurse -Force }
    if (Test-Path -LiteralPath $testCache) {
        $expectedCache = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'nullpoint-upgrade-sandbox-updater'))
        $resolvedCache = (Resolve-Path -LiteralPath $testCache).Path
        if ($resolvedCache -ine $expectedCache) { throw 'Unsafe test cache path.' }
        Remove-Item -LiteralPath $resolvedCache -Recurse -Force
    }
    $afterHash = if (Test-Path -LiteralPath $sharedCache -PathType Leaf) { (Get-FileHash -LiteralPath $sharedCache -Algorithm SHA256).Hash } else { $null }
    if ($afterHash -ne $sharedCacheHash) { throw 'The shared installer cache changed during the test.' }
}
