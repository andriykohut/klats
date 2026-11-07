; The Windows installers, compiled by build.ps1 with Inno Setup 6.3 or later
; (x64compatible and UTF-8 without a BOM need it):
;   ISCC /DAppVersion=1.2.3 klats.iss            -> dist\Klats-Setup.exe
;   ISCC /DAppVersion=1.2.3 /DOffline klats.iss  -> dist\Klats-Setup-Offline.exe
; The offline one also carries Microsoft's WebView2 runtime installer, for PCs
; without internet, and runs it only when the runtime is missing. Relative
; paths resolve against this folder.

[Setup]
; Ties every version's installer to one uninstall entry, so a newer installer
; upgrades in place. Generated once with uuidgen on 2026-11-07; never change it.
AppId={{2C2A5437-ABBE-4F1F-AD29-6EE7E09FD1AC}
AppName={cm:AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\Klats
DisableProgramGroupPage=yes
PrivilegesRequired=admin
; klats.exe is an x64 build: Setup refuses 32-bit Windows and installs into
; the 64-bit Program Files.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ShowLanguageDialog=auto
ChangesAssociations=yes
CloseApplications=yes
; The mutex Wails' single-instance lock holds while Klats runs ("wails-app-" +
; UniqueID + "-sim"), so setup and uninstall ask the teacher to close Klats
; first, even when it sits in the tray where the restart manager can't reach it.
AppMutex=wails-app-ua.klats.teacher-sim
SetupIconFile=..\icon\klats.ico
; klats.exe has no icon resource; the window takes its icon from Wails.
UninstallDisplayIcon={app}\klats.ico
WizardStyle=modern
OutputDir=..\..\dist
#ifdef Offline
OutputBaseFilename=Klats-Setup-Offline
#else
OutputBaseFilename=Klats-Setup
#endif

[Languages]
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ukrainian.AppName=Клац
english.AppName=Klats
ukrainian.DesktopIcon=Створити значок на робочому столі
english.DesktopIcon=Create a desktop icon
ukrainian.LaunchKlats=Запустити Клац
english.LaunchKlats=Launch Klats
ukrainian.DeleteData=Також видалити мої тести й результати?
english.DeleteData=Also delete my tests and results?
ukrainian.FileTypeName=Тест Клацу
english.FileTypeName=Klats test

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"

[Files]
Source: "..\..\dist\klats.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\icon\klats.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\icon\klats-file.ico"; DestDir: "{app}"; Flags: ignoreversion
#ifdef Offline
Source: "..\..\dist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: nocompression; Check: WebView2Missing
#endif

[Icons]
Name: "{autoprograms}\{cm:AppName}"; Filename: "{app}\klats.exe"; IconFilename: "{app}\klats.ico"
Name: "{autodesktop}\{cm:AppName}"; Filename: "{app}\klats.exe"; IconFilename: "{app}\klats.ico"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.klats"; ValueType: string; ValueName: ""; ValueData: "Klats.Test"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Klats.Test"; ValueType: string; ValueName: ""; ValueData: "{cm:FileTypeName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Klats.Test\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\klats-file.ico"
; The path must be the only argument: Wails reports a file opened at launch
; only when the program gets exactly one.
Root: HKA; Subkey: "Software\Classes\Klats.Test\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\klats.exe"" ""%1"""

[Run]
; Students reach Klats over the lab network: Windows marks unknown networks
; Public, and a domain-joined PC's school network is Domain.
; The delete keeps an install over an older version from adding a second rule.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Klats"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Klats"" dir=in action=allow program=""{app}\klats.exe"" profile=domain,private,public remoteip=localsubnet enable=yes"; Flags: runhidden
#ifdef Offline
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; Check: WebView2Missing
#endif
Filename: "{app}\klats.exe"; Description: "{cm:LaunchKlats}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Klats"""; Flags: runhidden; RunOnceId: "DeleteFirewallRule"

[Code]
// Reports whether the machine-wide WebView2 runtime is absent: Microsoft's
// registry value pv is missing, empty or 0.0.0.0. Used by the offline build.
function WebView2Missing: Boolean;
var
  Version: String;
begin
  Result := not RegQueryStringValue(HKLM,
      'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      'pv', Version)
    or (Version = '') or (Version = '0.0.0.0');
end;

// Offers to delete the data folder once the program is gone; "No" is the
// default, and a silent uninstall keeps the data. Under an admin install this
// is the folder of the user running the uninstaller.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // MsgBox sits in an inner if rather than in the and, so it is called only
  // in the post-uninstall step of an uninstall that is not silent.
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
    if MsgBox(CustomMessage('DeleteData'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Klats'), True, True, True);
end;
