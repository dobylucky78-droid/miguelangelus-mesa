# Gera uma versão ASSINADA do MiguelAngelus Mesa: publica o programa, assina o .exe e a .dll, monta o instalador,
# assina o instalador e copia para a área de trabalho (com número e com o nome fixo) e a pasta da pendrive.
# Antes: abrir o SimplySign Desktop e entrar (e-mail + código do app SimplySign no celular).
# Uso:  powershell -ExecutionPolicy Bypass -File mesa\instalador\gerar_versao_mesa.ps1
$ErrorActionPreference = 'Stop'
$pastaMesa = Split-Path $PSScriptRoot -Parent               # ...\Lumen\mesa
$lumen = Split-Path $pastaMesa -Parent                      # ...\Lumen
$signtool = Join-Path $lumen 'instalador\signtool\signtool.exe'
$assinante = 'Open Source Developer Marcio Aurelio Rios Martins'
$carimbo = 'http://time.certum.pl'
$iscc = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'

function Assinar($arquivo) {
  Write-Host "Assinando $arquivo"
  & $signtool sign /n $assinante /fd sha256 /tr $carimbo /td sha256 /d 'MiguelAngelus Mesa' $arquivo
  if ($LASTEXITCODE) { throw "Falhou ao assinar $arquivo (o SimplySign Desktop está aberto e conectado?)" }
  & $signtool verify /pa /q $arquivo
  if ($LASTEXITCODE) { throw "Assinatura não conferiu: $arquivo" }
}

# versão: a do .iss tem de ser a mesma do .csproj
$iss = Join-Path $PSScriptRoot 'MiguelAngelusMesa.iss'
$versao = ([regex]'#define Versao "([^"]+)"').Match((Get-Content $iss -Raw -Encoding utf8)).Groups[1].Value
$csproj = Join-Path $pastaMesa 'programa\MiguelAngelusMesa.csproj'
$vproj = ([regex]'<Version>([^<]+)</Version>').Match((Get-Content $csproj -Raw -Encoding utf8)).Groups[1].Value
if ($versao -ne $vproj) { throw "Versões diferentes: instalador $versao, programa $vproj" }
$nomeInstalador = "Instalar MiguelAngelus Mesa $versao.exe"

# 1) publicar
$saida = Join-Path $PSScriptRoot 'saida'
if (Test-Path $saida) { Remove-Item -Recurse -Force $saida }
Push-Location (Join-Path $pastaMesa 'programa')
dotnet publish -c Release -o $saida | Select-Object -Last 1
if ($LASTEXITCODE) { throw 'dotnet publish falhou' }
Pop-Location
# sobras do publish que não servem ao programa
Get-ChildItem $saida -Include '*.lib', '*.pdb', 'Microsoft.Web.WebView2.*.xml' -Recurse | Remove-Item -Force

# 2) assinar o programa
Assinar (Join-Path $saida 'MiguelAngelusMesa.exe')
Assinar (Join-Path $saida 'MiguelAngelusMesa.dll')

# 3) instalador
& $iscc /Q $iss
if ($LASTEXITCODE) { throw 'Inno Setup falhou' }
$instalador = Join-Path $PSScriptRoot $nomeInstalador
Assinar $instalador

# 4) cópias (nome fixo: o link .../miguelangelus-mesa/releases/latest/download/Instalar-MiguelAngelus-Mesa.exe baixa sempre a mais nova)
$desktop = Split-Path $lumen -Parent
Copy-Item $instalador (Join-Path $desktop $nomeInstalador) -Force
Copy-Item $instalador (Join-Path $desktop 'Instalar-MiguelAngelus-Mesa.exe') -Force
$pendrive = Join-Path $desktop 'Pendrive MiguelAngelus'
if (Test-Path $pendrive) { Copy-Item $instalador (Join-Path $pendrive $nomeInstalador) -Force }
Write-Host ("Pronto: $nomeInstalador assinado por $assinante ({0:N0} MB)" -f ((Get-Item $instalador).Length / 1MB))
