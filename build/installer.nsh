!macro customInstallMode
  ; Rovai AI v1 ships only as a non-admin, current-user installation.
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
