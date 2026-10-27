; DualClip v1.0.2 Inno Setup script — Next-Next-Finish simplicity.
; Per-user install (no UAC prompts), self-contained payload (no .NET install needed).
; Build payload first: dotnet publish DualClip.csproj -c Release -r win-x64 --self-contained true -o publish\win-x64
; Compile installer: iscc installer\DualClip.iss
; Source layout note: ONLY publish output is packaged (never the repo root).

#define MyAppName "DualClip"
#define MyAppVersion "1.0.2"
#define MyAppPublisher "DualClip"
#define MyAppExeName "DualClip.exe"

[Setup]
AppId={{08058125-F962-4ABC-888F-D4F65A6065EE}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=DualClip-Setup-1.0.2
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
CloseApplications=yes
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
; portable.dat is EXCLUDED on purpose: it would flip the installed app into
; portable mode (data next to the exe). Portable builds ship it via the zip.
Source: "..\publish\win-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "portable.dat"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"
Name: "autostart"; Description: "Start {#MyAppName} automatically with &Windows"

[Registry]
Root: HKCU; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{app}\{#MyAppExeName}"" --hidden"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function WebView2Available(): Boolean;
var
  EdgePath: String;
begin
  { Standalone Evergreen Runtime registration (system + per-user, 64 + 32-bit views) }
  Result := RegKeyExists(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8B0B-00C0079FDB2C}')
    or RegKeyExists(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8B0B-00C0079FDB2C}')
    or RegKeyExists(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8B0B-00C0079FDB2C}');
  { Fallback: Edge Stable itself ships a usable WebView2 (no standalone key on such machines) }
  if not Result then
    Result := FileExists('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
      or FileExists('C:\Program Files\Microsoft\Edge\Application\msedge.exe')
      or RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', '', EdgePath)
      or RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', '', EdgePath);
end;

function InitializeSetup(): Boolean;
var
  Res: Integer;
begin
  Result := True;
  if not WebView2Available() then
  begin
    Res := MsgBox('The WebView2 runtime was not detected. DualClip needs it to display its window.' + #13#10 + #13#10 +
      'Click Yes to open the download page, then run this installer again after installing it.',
      mbConfirmation, MB_YESNO);
    if Res = IDYES then
      ShellExec('', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOW, ewNoWait, Res);
    Result := False;
  end;
end;
