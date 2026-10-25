; Inno Setup script for Arclike on Windows
; Build with: iscc setup.iss

#define MyAppName "Arclike"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Amit Rahman"
#define MyAppURL "https://github.com/amitrahman1026/arclike"
#define MyAppExeName "Arclike.exe"
#define HostName "com.amitrahman1026.arclike"
#define ExtensionId "jlmidbafifiahhcpahkcejphlibhjapo"

[Setup]
AppId={{3F7C2E1A-9B4D-4E8F-A6C5-2D1B0E9F8A7C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=..\dist
OutputBaseFilename=Arclike-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\Arclike\Resources\app-icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "Start Arclike when Windows starts"; GroupDescription: "Other:"; Flags: unchecked

[Files]
Source: "..\dist\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Native messaging host for each Chromium browser. The manifest is written in [Code]
// Write the native messaging manifest. Chrome rejects wildcards in allowed_origins, so it names
// the Arclike extension exactly.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ExePath: string;
  ManifestContent: string;
begin
  if CurStep = ssPostInstall then
  begin
    ExePath := ExpandConstant('{app}\{#MyAppExeName}');
    StringChangeEx(ExePath, '\', '\\', True);
    ManifestContent :=
      '{' + #13#10 +
      '  "name": "{#HostName}",' + #13#10 +
      '  "description": "Arclike native helper",' + #13#10 +
      '  "path": "' + ExePath + '",' + #13#10 +
      '  "type": "stdio",' + #13#10 +
      '  "allowed_origins": ["chrome-extension://{#ExtensionId}/"]' + #13#10 +
      '}';
    SaveStringToFile(ExpandConstant('{app}\{#HostName}.json'), ManifestContent, False);
  end;
end;
