Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "x64.nsh"
!define APP_ID "de.kerncloud.bridge"
!define INSTALL_KEY "Software\KeRnCloud\BridgeInstaller"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\KeRnCloudBridge"
; Fixed section order below: app=0, menu=1, desktop=2, startup=3.
!define MENU_INDEX 1
!define DESKTOP_INDEX 2
!define STARTUP_INDEX 3
Name "KeRnCloud Bridge"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\KeRnCloud Bridge"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID zlib
; A failed uninstaller signature aborts the signed Windows build.
!ifdef BRIDGE_SIGN_NODE
  !ifndef BRIDGE_SIGN_SCRIPT
    !error "BRIDGE_SIGN_SCRIPT is required"
  !endif
  !uninstfinalize '"${BRIDGE_SIGN_NODE}" "${BRIDGE_SIGN_SCRIPT}" "%1"' = 0
!endif
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "KeRnCloud Bridge Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "KeRnCloud Bridge per-user installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "KeRn-WS"
VIAddVersionKey /LANG=1033 "LegalCopyright" "KeRn-WS"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "KeRnCloud Bridge"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_PRE DirectoryPre
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\KeRnCloud Bridge.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

LangString WelcomeText ${LANG_GERMAN} "Die Bridge wird nur für deinen Windows-Benutzer installiert. Es sind keine Administratorrechte nötig.$\r$\n$\r$\nIm nächsten Schritt wählst du Startmenü, Desktop-Verknüpfung und optionalen Autostart. Autostart ist standardmäßig aus; die App bleibt nach dem Start pausiert.$\r$\n$\r$\nEs werden keine Router-Ports geöffnet."
LangString WelcomeText ${LANG_ENGLISH} "Bridge is installed for your Windows user only, without administrator privileges.$\r$\n$\r$\nChoose Start menu, desktop shortcut and optional startup on the next page. Startup is off by default; Bridge always starts paused.$\r$\n$\r$\nNo router ports are opened."
LangString AppSection ${LANG_GERMAN} "Bridge-App (erforderlich)"
LangString AppSection ${LANG_ENGLISH} "Bridge app (required)"
LangString MenuSection ${LANG_GERMAN} "Einträge im Startmenü"
LangString MenuSection ${LANG_ENGLISH} "Start menu entries"
LangString DesktopSection ${LANG_GERMAN} "Desktop-Verknüpfung"
LangString DesktopSection ${LANG_ENGLISH} "Desktop shortcut"
LangString StartupSection ${LANG_GERMAN} "Mit Windows starten (Bridge bleibt pausiert)"
LangString StartupSection ${LANG_ENGLISH} "Start with Windows (Bridge stays paused)"
LangString CloseApp ${LANG_GERMAN} "Bitte KeRnCloud Bridge zuerst über das Fenster schließen. Laufende Aktionen werden nicht zwangsweise beendet."
LangString CloseApp ${LANG_ENGLISH} "Close KeRnCloud Bridge first. Setup will not force-stop running actions."
LangString BadDir ${LANG_GERMAN} "Bitte einen leeren eigenen Installationsordner auswählen. Vorhandene fremde Dateien oder Systemordner werden nicht übernommen."
LangString BadDir ${LANG_ENGLISH} "Choose an empty dedicated installation directory. Existing unrelated files or system folders are not accepted."
LangString KeepData ${LANG_GERMAN} "Programm und erstellte Verknüpfungen werden entfernt. Lokale Verbindungseinstellungen und das Aktionsjournal bleiben im Benutzerprofil erhalten. Vor einer endgültigen Entfernung das Gerät in KeRnCloud widerrufen."
LangString KeepData ${LANG_ENGLISH} "The app and setup-created shortcuts are removed. Local connection settings and the action journal are retained in your user profile. Revoke the device in KeRnCloud before permanent removal."

Var Parameters
Var PreviousDesktop
Var PreviousMenu
Var ExistingInstall

Section "$(AppSection)" SEC_APP
  SectionIn RO
  Call CheckAppClosed
  Call ValidateDirectory
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "$(BadDir)" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  File /r "${APP_FILES_DIR}/*"
  ${If} ${Errors}
    SetErrorLevel 3
    Abort
  ${EndIf}
  WriteINIStr "$INSTDIR\bridge-install.ini" "Bridge" "AppId" "${APP_ID}"
  WriteINIStr "$INSTDIR\bridge-install.ini" "Bridge" "Version" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallDir" "$INSTDIR"
  WriteRegDWORD HKCU "${INSTALL_KEY}" "Desktop" 0
  WriteRegDWORD HKCU "${INSTALL_KEY}" "StartMenu" 0
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "KeRnCloud Bridge"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "KeRn-WS"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\KeRnCloud Bridge.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${APP_SIZE_KB}
  ${IfNot} ${SectionIsSelected} ${MENU_INDEX}
    ${If} $PreviousMenu == 1
      Delete "$SMPROGRAMS\KeRnCloud Bridge\KeRnCloud Bridge.lnk"
      Delete "$SMPROGRAMS\KeRnCloud Bridge\Uninstall.lnk"
      RMDir "$SMPROGRAMS\KeRnCloud Bridge"
    ${EndIf}
  ${EndIf}
  ${IfNot} ${SectionIsSelected} ${DESKTOP_INDEX}
    ${If} $PreviousDesktop == 1
      Delete "$DESKTOP\KeRnCloud Bridge.lnk"
    ${EndIf}
  ${EndIf}
  ${IfNot} ${SectionIsSelected} ${STARTUP_INDEX}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${EndIf}
SectionEnd

Section "$(MenuSection)" SEC_MENU
  ${If} $PreviousMenu != 1
    IfFileExists "$SMPROGRAMS\KeRnCloud Bridge\KeRnCloud Bridge.lnk" menu_conflict
    IfFileExists "$SMPROGRAMS\KeRnCloud Bridge\Uninstall.lnk" menu_conflict
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\KeRnCloud Bridge"
  ClearErrors
  CreateShortCut "$SMPROGRAMS\KeRnCloud Bridge\KeRnCloud Bridge.lnk" "$INSTDIR\KeRnCloud Bridge.exe" "" "$INSTDIR\KeRnCloud Bridge.exe"
  CreateShortCut "$SMPROGRAMS\KeRnCloud Bridge\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  ${IfNot} ${Errors}
    WriteRegDWORD HKCU "${INSTALL_KEY}" "StartMenu" 1
  ${EndIf}
  Goto menu_done
  menu_conflict:
    DetailPrint "Existing unrelated Start menu entries were preserved."
  menu_done:
SectionEnd

Section /o "$(DesktopSection)" SEC_DESKTOP
  ${If} $PreviousDesktop != 1
    IfFileExists "$DESKTOP\KeRnCloud Bridge.lnk" desktop_conflict
  ${EndIf}
  ClearErrors
  CreateShortCut "$DESKTOP\KeRnCloud Bridge.lnk" "$INSTDIR\KeRnCloud Bridge.exe" "" "$INSTDIR\KeRnCloud Bridge.exe"
  ${IfNot} ${Errors}
    WriteRegDWORD HKCU "${INSTALL_KEY}" "Desktop" 1
  ${EndIf}
  Goto desktop_done
  desktop_conflict:
    DetailPrint "Existing unrelated desktop shortcut was preserved."
  desktop_done:
SectionEnd

Section /o "$(StartupSection)" SEC_STARTUP
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}" '"$INSTDIR\KeRnCloud Bridge.exe" --autostart'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_APP} "KeRnCloud Bridge ${APP_VERSION}"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MENU} "$(MenuSection)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "$(DesktopSection)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTUP} "$(StartupSection)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

!macro Option SWITCH SECTION
  ClearErrors
  ${GetOptions} $Parameters "/${SWITCH}=" $0
  ${IfNot} ${Errors}
    ${If} $0 == "1"
      !insertmacro SelectSection ${SECTION}
    ${ElseIf} $0 == "0"
      !insertmacro UnselectSection ${SECTION}
    ${Else}
      SetErrorLevel 4
      Abort
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "Windows x64 is required." /SD IDOK
    Abort
  ${EndIf}
  IfSilent language_done
  !insertmacro MUI_LANGDLL_DISPLAY
  language_done:
  StrCpy $ExistingInstall 0
  StrCpy $PreviousDesktop 0
  StrCpy $PreviousMenu 0
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != ""
    ReadINIStr $1 "$0\bridge-install.ini" "Bridge" "AppId"
    ${If} $1 == "${APP_ID}"
      StrCpy $ExistingInstall 1
      StrCpy $INSTDIR $0
      ReadRegDWORD $PreviousDesktop HKCU "${INSTALL_KEY}" "Desktop"
      ReadRegDWORD $PreviousMenu HKCU "${INSTALL_KEY}" "StartMenu"
      ${If} $PreviousDesktop == 1
        !insertmacro SelectSection ${SEC_DESKTOP}
      ${EndIf}
      ${If} $PreviousMenu != 1
        !insertmacro UnselectSection ${SEC_MENU}
      ${EndIf}
      ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
      ${If} $1 == '"$INSTDIR\KeRnCloud Bridge.exe" --autostart'
        !insertmacro SelectSection ${SEC_STARTUP}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${If} $1 != ""
    !insertmacro SelectSection ${SEC_STARTUP}
  ${EndIf}
  ${GetParameters} $Parameters
  !insertmacro Option "DESKTOP" ${SEC_DESKTOP}
  !insertmacro Option "STARTMENU" ${SEC_MENU}
  !insertmacro Option "AUTOSTART" ${SEC_STARTUP}
FunctionEnd

Function DirectoryPre
  ${If} $ExistingInstall == 1
    Abort
  ${EndIf}
FunctionEnd

Function ValidateDirectory
  ClearErrors
  ; Unlike NSIS GetFullPathName, the Windows API also accepts a new directory.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i .r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $0 == ""
    SetErrors
    Return
  ${EndIf}
  StrCpy $INSTDIR $0
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == $0
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$SYSDIR"
  ${OrIf} $INSTDIR == "$PROGRAMFILES"
  ${OrIf} $INSTDIR == "$PROGRAMFILES64"
  ${OrIf} $INSTDIR == "$PROFILE"
  ${OrIf} $INSTDIR == "$APPDATA"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA"
  ${OrIf} $INSTDIR == "$DESKTOP"
  ${OrIf} $INSTDIR == "$SMPROGRAMS"
  ${OrIf} $INSTDIR == "$TEMP"
    SetErrors
    Return
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\bridge-install.ini" "Bridge" "AppId"
  ${If} $0 == "${APP_ID}"
    ClearErrors
    Return
  ${EndIf}
  ClearErrors
  FindFirst $1 $2 "$INSTDIR\*"
  ${If} ${Errors}
    ClearErrors
    Return
  ${EndIf}
  directory_loop:
    ${If} $2 != "."
    ${AndIf} $2 != ".."
    ${AndIf} $2 != ""
      FindClose $1
      SetErrors
      Return
    ${EndIf}
    FindNext $1 $2
    IfErrors directory_empty
    Goto directory_loop
  directory_empty:
    FindClose $1
    ClearErrors
FunctionEnd

Function .onVerifyInstDir
  Call ValidateDirectory
  ${If} ${Errors}
    Abort
  ${EndIf}
FunctionEnd

Function CheckAppClosed
  StrCpy $9 0
  check_again:
  FindWindow $0 "Chrome_WidgetWin_1" "KeRnCloud Bridge"
  ${If} $0 != 0
    ClearErrors
    ${GetOptions} $Parameters "--updated" $8
    ${IfNot} ${Errors}
    ${AndIf} $9 < 120
      IntOp $9 $9 + 1
      Sleep 250
      Goto check_again
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseApp)" /SD IDCANCEL IDRETRY check_again
    SetErrorLevel 5
    Abort
  ${EndIf}

  ; Renderer/GPU helpers can retain the executable briefly after the window is
  ; gone. Wait for exclusive write access instead of risking a partial overwrite.
  ClearErrors
  ${GetOptions} $Parameters "--updated" $8
  ${IfNot} ${Errors}
    IfFileExists "$INSTDIR\KeRnCloud Bridge.exe" 0 update_file_ready
    StrCpy $9 0
    update_file_wait:
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\KeRnCloud Bridge.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p .r0'
      ${If} $0 != -1
        System::Call 'kernel32::CloseHandle(p r0)'
        Goto update_file_ready
      ${EndIf}
      IntOp $9 $9 + 1
      ${If} $9 < 120
        Sleep 250
        Goto update_file_wait
      ${EndIf}
      SetErrorLevel 5
      Abort
    update_file_ready:
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallDir"
  ${If} $0 != "$INSTDIR"
    SetErrorLevel 6
    Abort
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\bridge-install.ini" "Bridge" "AppId"
  ${If} $0 != "${APP_ID}"
    SetErrorLevel 6
    Abort
  ${EndIf}
  un_check_again:
  FindWindow $0 "Chrome_WidgetWin_1" "KeRnCloud Bridge"
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseApp)" /SD IDCANCEL IDRETRY un_check_again
    SetErrorLevel 5
    Abort
  ${EndIf}
  IfSilent un_notice_done
  MessageBox MB_OK|MB_ICONINFORMATION "$(KeepData)"
  un_notice_done:
FunctionEnd

Section "Uninstall"
  ReadRegDWORD $0 HKCU "${INSTALL_KEY}" "Desktop"
  ${If} $0 == 1
    Delete "$DESKTOP\KeRnCloud Bridge.lnk"
  ${EndIf}
  ReadRegDWORD $0 HKCU "${INSTALL_KEY}" "StartMenu"
  ${If} $0 == 1
    Delete "$SMPROGRAMS\KeRnCloud Bridge\KeRnCloud Bridge.lnk"
    Delete "$SMPROGRAMS\KeRnCloud Bridge\Uninstall.lnk"
    RMDir "$SMPROGRAMS\KeRnCloud Bridge"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${If} $0 == '"$INSTDIR\KeRnCloud Bridge.exe" --autostart'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${EndIf}
  ; This generated list deletes only files delivered by this package. No recursive deletion.
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\bridge-install.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"
SectionEnd

Function .onInstSuccess
  ClearErrors
  ${GetOptions} $Parameters "--force-run" $0
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\KeRnCloud Bridge.exe" --update-completed'
  ${EndIf}
FunctionEnd
