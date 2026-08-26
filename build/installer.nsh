!include "getProcessInfo.nsh"

!define ROVAI_INSTALLER_PROCESS_COORDINATOR "rovai-installer-process-coordinator.ps1"
!define ROVAI_SHUTDOWN_POLL_MS 500
!define ROVAI_GRACEFUL_SHUTDOWN_MS 20000
!define ROVAI_MANUAL_SHUTDOWN_MS 20000
!define ROVAI_FORCE_SHUTDOWN_MS 5000
!define ROVAI_GRACEFUL_SHUTDOWN_TICKS 40
!define ROVAI_MANUAL_SHUTDOWN_TICKS 40
!define ROVAI_FORCE_SHUTDOWN_TICKS 10

Var pid
Var rovaiProcessStatus
Var rovaiShutdownTicks
Var rovaiShutdownPrompt
Var rovaiShutdownFailure
!ifndef BUILD_UNINSTALLER
  Var rovaiUninstallFailure
!endif

; electron-builder uses the same appCannotBeClosed string when a process remains,
; package extraction is locked, or the previous uninstaller returns a non-zero
; result. Keep Retry accurate for the release languages instead of claiming that
; the App is necessarily still running.
!macro customHeader
  ; customHeader expands after electron-builder has emitted every bundled
  ; translation, so these app-specific corrections deterministically win.
  !pragma warning disable 6030
  LangString appCannotBeClosed 1033 "${PRODUCT_NAME} setup could not continue. A related process may still be running, or the previous uninstaller may have failed. Close related processes and click Retry. If Retry returns here again, click Cancel and review the reported error."
  LangString appCannotBeClosed 2052 "${PRODUCT_NAME} 安装无法继续。可能仍有相关进程正在运行，或旧版卸载程序执行失败。请关闭相关进程后点击“重试”；如果重试后仍返回此处，请点击“取消”并查看随后报告的错误。"
  LangString appCannotBeClosed 1028 "${PRODUCT_NAME} 安裝無法繼續。可能仍有相關程序正在執行，或舊版解除安裝程式執行失敗。請關閉相關程序後點擊「重試」；如果重試後仍返回此處，請點擊「取消」並查看隨後回報的錯誤。"
  !pragma warning default 6030
!macroend

!macro ROVAI_RUN_PROCESS_COORDINATOR ACTION RESULT
  nsExec::ExecToLog '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\${ROVAI_INSTALLER_PROCESS_COORDINATOR}" -Action "${ACTION}" -InstallDirectory "$INSTDIR\." -ExecutableName "${APP_EXECUTABLE_FILENAME}" -ExcludeProcessId $pid'
  Pop ${RESULT}
!macroend

!macro ROVAI_RUN_PROCESS_COORDINATOR_WAIT TIMEOUT_MS RESULT
  nsExec::ExecToLog '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\${ROVAI_INSTALLER_PROCESS_COORDINATOR}" -Action "WaitForExit" -InstallDirectory "$INSTDIR\." -ExecutableName "${APP_EXECUTABLE_FILENAME}" -ExcludeProcessId $pid -TimeoutMilliseconds "${TIMEOUT_MS}"'
  Pop ${RESULT}
!macroend

; Return the same convention as electron-builder's FIND_PROCESS macro:
; 0 means at least one relevant process remains; non-zero means quiescent.
!macro ROVAI_FIND_INSTALL_PROCESSES RESULT
  ${if} $IsPowerShellAvailable == 0
    !insertmacro ROVAI_RUN_PROCESS_COORDINATOR "Status" ${RESULT}
    ${if} ${RESULT} == 0
      StrCpy ${RESULT} 1
    ${elseif} ${RESULT} == 10
      StrCpy ${RESULT} 0
    ${elseif} ${RESULT} == 11
      ; A same-name process whose executable path cannot be read is commonly an
      ; elevated Rovai process. Treat it as running, but never force an unknown PID.
      StrCpy ${RESULT} 0
    ${else}
      DetailPrint "Rovai process coordinator was unavailable (exit ${RESULT}); using the image-name fallback."
      StrCpy $IsPowerShellAvailable 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" ${RESULT}
      ${if} ${RESULT} != 0
        !insertmacro FIND_PROCESS "rovai-core.exe" ${RESULT}
      ${endif}
      ${if} ${RESULT} != 0
        !insertmacro FIND_PROCESS "rovai.exe" ${RESULT}
      ${endif}
    ${endif}
  ${else}
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" ${RESULT}
    ${if} ${RESULT} != 0
      !insertmacro FIND_PROCESS "rovai-core.exe" ${RESULT}
    ${endif}
    ${if} ${RESULT} != 0
      !insertmacro FIND_PROCESS "rovai.exe" ${RESULT}
    ${endif}
  ${endif}
!macroend

!macro ROVAI_REQUEST_GRACEFUL_CLOSE
  ${if} $IsPowerShellAvailable == 0
    !insertmacro ROVAI_RUN_PROCESS_COORDINATOR "RequestClose" $rovaiProcessStatus
    DetailPrint "Rovai graceful close request returned $rovaiProcessStatus."
  ${else}
    DetailPrint "Automatic close is unavailable because the exact Rovai process identity could not be verified."
  ${endif}
!macroend

!macro ROVAI_FORCE_CLOSE
  ${if} $IsPowerShellAvailable == 0
    !insertmacro ROVAI_RUN_PROCESS_COORDINATOR "ForceClose" $rovaiProcessStatus
    DetailPrint "Rovai force-close request returned $rovaiProcessStatus."
  ${else}
    DetailPrint "Refusing to force-close a process whose installation path could not be verified."
  ${endif}
!macroend

!macro ROVAI_SET_SHUTDOWN_MESSAGES
  ${if} $IsPowerShellAvailable != 0
    ${if} $LANGUAGE == 2052
      StrCpy $rovaiShutdownPrompt "安装器无法验证 Rovai 进程的安装路径，因此不会自动结束任何进程。请在任务管理器中关闭 Rovai AI、rovai-core 和 rovai，然后点击“重试”再等待 20 秒；点击“取消”停止安装。"
      StrCpy $rovaiShutdownFailure "仍检测到 Rovai 进程，或无法验证其安装路径，安装已安全停止。请关闭对应进程，并确认 Windows PowerShell 未被策略禁用，然后重新运行安装程序。"
    ${elseif} $LANGUAGE == 1028
      StrCpy $rovaiShutdownPrompt "安裝程式無法驗證 Rovai 程序的安裝路徑，因此不會自動結束任何程序。請在工作管理員中關閉 Rovai AI、rovai-core 和 rovai，然後點擊「重試」再等待 20 秒；點擊「取消」停止安裝。"
      StrCpy $rovaiShutdownFailure "仍偵測到 Rovai 程序，或無法驗證其安裝路徑，安裝已安全停止。請關閉對應程序，並確認 Windows PowerShell 未被原則停用，然後重新執行安裝程式。"
    ${else}
      StrCpy $rovaiShutdownPrompt "Setup could not verify the installation path of the Rovai processes, so it will not end any process automatically. Close Rovai AI, rovai-core, and rovai in Task Manager, then click Retry to wait another 20 seconds, or Cancel to stop setup."
      StrCpy $rovaiShutdownFailure "Rovai processes are still detected, or their installation paths could not be verified, so setup stopped safely. Close them and confirm that Windows PowerShell is not disabled by policy, then run setup again."
    ${endif}
  ${elseif} $LANGUAGE == 2052
    StrCpy $rovaiShutdownPrompt "Rovai AI 在 20 秒内尚未完成受控退出。$\r$\n$\r$\n点击“是”仅强制关闭安装目录内仍在运行的 Rovai 进程；点击“否”可再等待 20 秒，以便你手动关闭；点击“取消”停止安装。"
    StrCpy $rovaiShutdownFailure "Rovai AI 仍无法退出，安装已安全停止。它可能以管理员身份或在其他 Windows 会话中运行。请在任务管理器中结束对应进程，然后重新运行安装程序。"
  ${elseif} $LANGUAGE == 1028
    StrCpy $rovaiShutdownPrompt "Rovai AI 在 20 秒內尚未完成受控退出。$\r$\n$\r$\n點擊「是」僅強制關閉安裝目錄內仍在執行的 Rovai 程序；點擊「否」可再等待 20 秒，以便你手動關閉；點擊「取消」停止安裝。"
    StrCpy $rovaiShutdownFailure "Rovai AI 仍無法退出，安裝已安全停止。它可能以系統管理員身分或在其他 Windows 工作階段中執行。請在工作管理員中結束對應程序，然後重新執行安裝程式。"
  ${else}
    StrCpy $rovaiShutdownPrompt "Rovai AI did not finish its controlled shutdown within 20 seconds.$\r$\n$\r$\nClick Yes to force-close only Rovai processes inside the installation directory, No to wait another 20 seconds while you close it manually, or Cancel to stop setup."
    StrCpy $rovaiShutdownFailure "Rovai AI still could not exit, so setup stopped without replacing files. It may be running as administrator or in another Windows session. End the corresponding processes in Task Manager, then run setup again."
  ${endif}
!macroend

!macro ROVAI_WAIT_FOR_QUIESCENCE TIMEOUT_MS TICKS LOOP_ID EXHAUSTED_LABEL
  ${if} $IsPowerShellAvailable == 0
    !insertmacro ROVAI_RUN_PROCESS_COORDINATOR_WAIT ${TIMEOUT_MS} $rovaiProcessStatus
    ${if} $rovaiProcessStatus == 0
      Goto rovai_not_running
    ${elseif} $rovaiProcessStatus == 10
      Goto ${EXHAUSTED_LABEL}
    ${elseif} $rovaiProcessStatus == 11
      Goto ${EXHAUSTED_LABEL}
    ${else}
      DetailPrint "Rovai wait coordinator was unavailable (exit $rovaiProcessStatus); using the image-name fallback."
      StrCpy $IsPowerShellAvailable 1
    ${endif}
  ${endif}

  ; Path verification is unavailable. Poll only the three exact image names and
  ; never force them; the elapsed time can include native task-list overhead.
  StrCpy $rovaiShutdownTicks 0
  rovai_wait_${LOOP_ID}:
    !insertmacro ROVAI_FIND_INSTALL_PROCESSES $rovaiProcessStatus
    ${if} $rovaiProcessStatus != 0
      Goto rovai_not_running
    ${endif}
    ${if} $rovaiShutdownTicks >= ${TICKS}
      Goto ${EXHAUSTED_LABEL}
    ${endif}
    Sleep ${ROVAI_SHUTDOWN_POLL_MS}
    IntOp $rovaiShutdownTicks $rovaiShutdownTicks + 1
    Goto rovai_wait_${LOOP_ID}
!macroend

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $0 $1 $2 $3
  InitPluginsDir
  File /oname=$PLUGINSDIR\${ROVAI_INSTALLER_PROCESS_COORDINATOR} "${BUILD_RESOURCES_DIR}\installer-process-coordinator.ps1"
  !insertmacro IS_POWERSHELL_AVAILABLE

  !insertmacro ROVAI_FIND_INSTALL_PROCESSES $rovaiProcessStatus
  ${if} $rovaiProcessStatus != 0
    Goto rovai_not_running
  ${endif}

  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" IDOK rovai_begin_shutdown IDCANCEL rovai_cancel_setup
  ${EndIf}

  rovai_begin_shutdown:
    DetailPrint "Requesting Rovai AI controlled shutdown and waiting up to 20 seconds."
    !insertmacro ROVAI_REQUEST_GRACEFUL_CLOSE
    !insertmacro ROVAI_WAIT_FOR_QUIESCENCE ${ROVAI_GRACEFUL_SHUTDOWN_MS} ${ROVAI_GRACEFUL_SHUTDOWN_TICKS} graceful rovai_graceful_timeout

  rovai_graceful_timeout:
    ${if} ${Silent}
      Goto rovai_force_shutdown
    ${endif}
    !insertmacro ROVAI_SET_SHUTDOWN_MESSAGES
    ${if} $IsPowerShellAvailable != 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$rovaiShutdownPrompt" IDRETRY rovai_manual_wait
    ${else}
      MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION "$rovaiShutdownPrompt" IDYES rovai_force_shutdown IDNO rovai_manual_wait
    ${endif}
    Goto rovai_cancel_setup

  rovai_manual_wait:
    DetailPrint "Waiting another 20 seconds for Rovai AI to be closed manually."
    !insertmacro ROVAI_WAIT_FOR_QUIESCENCE ${ROVAI_MANUAL_SHUTDOWN_MS} ${ROVAI_MANUAL_SHUTDOWN_TICKS} manual rovai_shutdown_failed

  rovai_force_shutdown:
    DetailPrint "Controlled shutdown timed out; force-closing only verified processes from $INSTDIR."
    !insertmacro ROVAI_FORCE_CLOSE
    !insertmacro ROVAI_WAIT_FOR_QUIESCENCE ${ROVAI_FORCE_SHUTDOWN_MS} ${ROVAI_FORCE_SHUTDOWN_TICKS} force rovai_shutdown_failed

  rovai_shutdown_failed:
    !insertmacro ROVAI_SET_SHUTDOWN_MESSAGES
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$rovaiShutdownFailure"
    ${EndIf}
    SetErrorLevel 3
    Quit

  rovai_cancel_setup:
    SetErrorLevel 2
    Quit

  rovai_not_running:
!macroend

!macro customUnInstallCheck
  IfErrors rovai_uninstaller_launch_failed 0
  ${if} $R0 != 0
    DetailPrint "Previous Rovai AI uninstaller failed with exit code $R0."
    ${if} $LANGUAGE == 2052
      StrCpy $rovaiUninstallFailure "旧版 Rovai AI 卸载程序执行失败，错误码：$R0。安装已停止；这不是应用仍在后台的证明。请保存安装日志后重新运行安装程序。"
    ${elseif} $LANGUAGE == 1028
      StrCpy $rovaiUninstallFailure "舊版 Rovai AI 解除安裝程式執行失敗，錯誤碼：$R0。安裝已停止；這不代表應用程式仍在背景執行。請儲存安裝記錄後重新執行安裝程式。"
    ${else}
      StrCpy $rovaiUninstallFailure "The previous Rovai AI uninstaller failed with exit code $R0. Setup stopped; this does not prove that the App is still running. Save the installer log, then run setup again."
    ${endif}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$rovaiUninstallFailure"
    ${EndIf}
    SetErrorLevel 4
    Quit
  ${endif}
  Goto rovai_uninstaller_check_complete

  rovai_uninstaller_launch_failed:
    DetailPrint "Previous Rovai AI uninstaller could not be launched."
    ${if} $LANGUAGE == 2052
      StrCpy $rovaiUninstallFailure "无法启动旧版 Rovai AI 卸载程序。安装已停止；这不是应用仍在后台的证明。请保存安装日志后重新运行安装程序。"
    ${elseif} $LANGUAGE == 1028
      StrCpy $rovaiUninstallFailure "無法啟動舊版 Rovai AI 解除安裝程式。安裝已停止；這不代表應用程式仍在背景執行。請儲存安裝記錄後重新執行安裝程式。"
    ${else}
      StrCpy $rovaiUninstallFailure "The previous Rovai AI uninstaller could not be launched. Setup stopped; this does not prove that the App is still running. Save the installer log, then run setup again."
    ${endif}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "$rovaiUninstallFailure"
    ${EndIf}
    SetErrorLevel 4
    Quit

  rovai_uninstaller_check_complete:
!macroend

!macro customInstallMode
  ; Rovai AI ships only as a non-admin, current-user installation.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstallSection
  Section /o "删除 Rovai AI 用户数据" un.RemoveRovaiUserData
    MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 \
      "这将永久删除 $LOCALAPPDATA\Rovai AI 及其中的会话、消息、运行记录和设置。是否继续？" \
      IDNO keepRovaiUserData
    RMDir /r "$LOCALAPPDATA\Rovai AI"
    keepRovaiUserData:
  SectionEnd
!macroend
