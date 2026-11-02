# -*- coding: utf-8 -*-
!ifndef BUILD_UNINSTALLER
  Var NPState
  Var NPError
  Var NPShell
  Var NPMode
  Var NPScope
  Var NPExit
  Var NPFailure
!endif

# The installed uninstaller also uses a non-destructive process check.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "请先从托盘完全退出 Nullpoint，再重新运行安装器。"
    ${endIf}
    SetErrorLevel 2
    Quit
  ${endIf}
!macroend

!ifndef BUILD_UNINSTALLER
!macro customHeader
  Function NPAbort
    ${if} $NPFailure == ""
      StrCpy $NPFailure "安装检查未完成，请重新运行安装器。"
      ClearErrors
      FileOpen $0 "$NPError" r
      IfErrors +3
      FileReadUTF16LE $0 $NPFailure
      FileClose $0
      ${if} $NPFailure == ""
        StrCpy $NPFailure "安装检查未完成，请重新运行安装器。"
      ${endIf}
    ${endIf}
    ${ifNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$NPFailure"
    ${endIf}
    SetErrorLevel 2
    Quit
  FunctionEnd

  Function NPScan
    StrCpy $NPFailure ""
    nsExec::ExecToStack /TIMEOUT=120000 '"$NPShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-guard.ps1" -Phase Scan -StatePath "$NPState" -ErrorPath "$NPError" -ManifestPath "$PLUGINSDIR\upgrade-manifests.json" -TargetVersion "${VERSION}"'
    Pop $NPExit
    Pop $0
    ${if} $NPExit != 0
      Call NPAbort
    ${endIf}
    ClearErrors
    FileOpen $0 "$NPState.mode" r
    IfErrors 0 +3
      StrCpy $NPFailure "无法读取安装检查结果，请重新运行安装器。"
      Call NPAbort
    FileRead $0 $NPMode
    FileClose $0
  FunctionEnd

  Function NPPrepare
    StrCpy $NPFailure ""
    ${if} $installMode == "all"
      StrCpy $NPScope "all"
    ${else}
      StrCpy $NPScope "user"
    ${endIf}
    nsExec::ExecToStack /TIMEOUT=300000 '"$NPShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-guard.ps1" -Phase Prepare -StatePath "$NPState" -ErrorPath "$NPError" -ManifestPath "$PLUGINSDIR\upgrade-manifests.json" -TargetPath "$INSTDIR" -Scope "$NPScope" -TargetVersion "${VERSION}"'
    Pop $NPExit
    Pop $0
    ${if} $NPExit != 0
      Call NPAbort
    ${endIf}
  FunctionEnd

  Function NPBeforeInstall
    # Match electron-builder's later directory sanitization before checking the target.
    ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
    ${if} $0 == ""
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${endIf}
    Call NPPrepare
    Abort
  FunctionEnd

  Function NPFinal
    StrCpy $NPFailure ""
    nsExec::ExecToStack /TIMEOUT=300000 '"$NPShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\upgrade-guard.ps1" -Phase Final -StatePath "$NPState" -ErrorPath "$NPError" -ManifestPath "$PLUGINSDIR\upgrade-manifests.json" -TargetVersion "${VERSION}"'
    Pop $NPExit
    Pop $0
    ${if} $NPExit != 0
      Call NPAbort
    ${endIf}
  FunctionEnd
!macroend

!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\upgrade-core.ps1 "${BUILD_RESOURCES_DIR}\upgrade-core.ps1"
  File /oname=$PLUGINSDIR\upgrade-guard.ps1 "${BUILD_RESOURCES_DIR}\upgrade-guard.ps1"
  File /oname=$PLUGINSDIR\upgrade-manifests.json "${BUILD_RESOURCES_DIR}\upgrade-manifests.json"
  StrCpy $NPState "$PLUGINSDIR\nullpoint-state.json"
  StrCpy $NPError "$PLUGINSDIR\nullpoint-error.txt"
  StrCpy $NPShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${ifNot} ${RunningX64}
    StrCpy $NPShell "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${endIf}
  Call NPScan

  ${if} $NPMode == "all"
    ${if} ${isForCurrentUser}
      StrCpy $NPFailure "已存在所有用户安装，不能指定仅当前用户安装。请移除 /currentuser 后重试。"
      Call NPAbort
    ${endIf}
  ${elseif} $NPMode == "user"
    ${if} ${isForAllUsers}
      StrCpy $NPFailure "已存在当前用户安装，不能切换安装范围。请移除 /allusers 后重试。"
      Call NPAbort
    ${endIf}
  ${endIf}

  ${if} ${Silent}
    ${if} $NPMode == "all"
      ${ifNot} ${UAC_IsAdmin}
        StrCpy $NPFailure "升级所有用户安装需要管理员权限。"
        Call NPAbort
      ${endIf}
      !insertmacro setInstallModePerAllUsers
    ${elseif} $NPMode == "user"
      !insertmacro setInstallModePerUser
    ${elseif} $installMode == "all"
      ${ifNot} ${UAC_IsAdmin}
        StrCpy $NPFailure "所有用户安装需要管理员权限。"
        Call NPAbort
      ${endIf}
    ${endIf}
    Call NPPrepare
  ${endIf}
!macroend

!macro customInstallMode
  ${if} $NPMode == "all"
    # The stock forced-mode branch quits with a success exit code when UAC is
    # cancelled. Handle that branch here and preserve the elevated child's code.
    ${ifNot} ${UAC_IsAdmin}
      ShowWindow $HWNDPARENT ${SW_HIDE}
      !insertmacro UAC_RunElevated
      ${if} $0 != 0
        StrCpy $NPFailure "升级所有用户安装需要管理员授权，安装已停止。"
        Call NPAbort
      ${elseif} $1 == 1
        SetErrorLevel $2
        Quit
      ${else}
        StrCpy $NPFailure "无法获得管理员权限，安装已停止。"
        Call NPAbort
      ${endIf}
    ${endIf}
    StrCpy $isForceMachineInstall "1"
  ${elseif} $NPMode == "user"
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend

!macro customPageAfterChangeDir
  Page custom NPBeforeInstall
!macroend

!macro customUnInstallCheck
  IfErrors 0 +3
    StrCpy $NPFailure "无法启动旧版本卸载器，安装已停止。"
    Call NPAbort
  ${if} $R0 != 0
    StrCpy $NPFailure "旧版本卸载失败（代码 $R0），安装已停止。"
    Call NPAbort
  ${endIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

!macro customInstall
  Call NPFinal
!macroend
!endif
