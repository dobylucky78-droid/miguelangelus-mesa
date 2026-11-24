; Instalador do MiguelAngelus Mesa (Inno Setup 6) — o mesmo jeito do instalador do Cast.
; Gerar tudo assinado: powershell -ExecutionPolicy Bypass -File mesa\instalador\gerar_versao_mesa.ps1
;
; - Instala por usuário, sem pedir administrador (pode escolher "para todos" se quiser).
; - Os dados (biblioteca de shows/snapshots/presets, histórico, ajustes, vistas) ficam em %LOCALAPPDATA%\MiguelAngelusMesa
;   e NÃO são apagados ao desinstalar nem ao instalar uma versão nova por cima.
; - Ao desinstalar, tira o "abrir junto com o Windows" (o programa grava em HKCU\...\Run).

#define Nome "MiguelAngelus Mesa"
#define Versao "0.0.14"
#define Editor "Paróquia São José Operário — PASCOM"
#define Exe "MiguelAngelusMesa.exe"

[Setup]
; AppId fixo: versões novas instalam por cima desta
AppId={{7BB0B79E-7F05-4548-A937-128E3043013A}
AppName={#Nome}
AppVersion={#Versao}
AppVerName={#Nome} {#Versao}
AppPublisher={#Editor}
AppPublisherURL=https://pascom-sjo.github.io/
AppSupportURL=https://github.com/dobylucky78-droid/miguelangelus-mesa
AppComments=Mesa de som das celebrações
VersionInfoVersion={#Versao}
VersionInfoDescription=Instalador do {#Nome}
DefaultDirName={autopf}\{#Nome}
DefaultGroupName={#Nome}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=.
OutputBaseFilename=Instalar MiguelAngelus Mesa {#Versao}
SetupIconFile=..\programa\icone.ico
UninstallDisplayIcon={app}\{#Exe}
UninstallDisplayName={#Nome}
WizardStyle=modern
DisableWelcomePage=no
Compression=lzma2/max
SolidCompression=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalho"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "saida\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; arquivos de versões antigas que não vêm mais
Type: filesandordirs; Name: "{app}\web"

[Icons]
Name: "{group}\{#Nome}"; Filename: "{app}\{#Exe}"; Comment: "Mesa de som das celebrações"
Name: "{group}\Desinstalar o {#Nome}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#Nome}"; Filename: "{app}\{#Exe}"; Tasks: atalho; Comment: "Mesa de som das celebrações"

[Run]
Filename: "{app}\{#Exe}"; Description: "Abrir o {#Nome} agora"; Flags: nowait postinstall skipifsilent
Filename: "{app}\{#Exe}"; Flags: nowait postinstall skipifnotsilent

[Messages]
pt.WelcomeLabel2=Este assistente vai instalar o [name/ver] neste computador.%n%nO MiguelAngelus Mesa controla a mesa de som digital (Soundcraft Ui) pela rede, guarda shows, snapshots e presets fora da mesa e ajuda a acertar o som das celebrações.%n%nSe já houver uma versão instalada, ela será atualizada e a biblioteca e os ajustes serão mantidos.

[Code]
// Avisa (sem impedir) se faltar o WebView2 (a tela do programa)
function TemWebView2: Boolean;
var v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) and (v <> '') and (v <> '0.0.0.0') or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) and (v <> '') and (v <> '0.0.0.0');
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if WizardSilent then Exit;
  if not TemWebView2 then
    Result := MsgBox('Este computador ainda não tem o Microsoft Edge WebView2 (a tela do Mesa).' + #13#10#13#10 +
      'O Mesa instala assim mesmo; ao terminar, abro a página para baixar.' + #13#10#13#10 +
      'Continuar a instalação?', mbConfirmation, MB_YESNO) = IDYES;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var erro: Integer;
begin
  if (CurStep = ssDone) and not WizardSilent and not TemWebView2 then
    ShellExec('open', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', '', '', SW_SHOWNORMAL, ewNoWait, erro);
end;

// ao desinstalar: tira o "abrir junto com o Windows" (os dados em %LOCALAPPDATA% ficam)
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'MiguelAngelus Mesa');
end;
