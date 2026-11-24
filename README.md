# MiguelAngelus Mesa

Programa de código aberto para **cuidar da mesa de som digital** (Soundcraft Ui24R / Ui16 / Ui12) das celebrações,
feito pela Pascom da Paróquia São José Operário (Ilha do Governador, RJ). É o quarto programa da família
[MiguelAngelus](https://github.com/dobylucky78-droid/miguelangelus).

Nasceu porque a mesa da paróquia **perdeu a memória duas vezes**: o Mesa guarda shows, snapshots, cues e presets
**fora da mesa**, com histórico, e manda de volta quando precisar. E também para **ajudar quem serve no som**:
uma tela clara, ajuda para acertar o ganho de cada canal, e os músicos ajustando o próprio retorno pelo celular.

> Em construção (versões 0.0.x). Ainda não é divulgado no site da paróquia: chega lá na 1.0.

## O que já faz

| Versão | O que tem |
|---|---|
| **0.0.1–0.0.4** | biblioteca de shows/snapshots/cues/presets guardada no computador (com histórico), comparar com a mesa, mandar para a mesa, copiar show para pendrive |
| **0.0.2–0.0.3** | aba **Mixer** (entradas, auxes, matrizes, FX, faders, medidores) e **tela do canal**: pré-amp, EQ com gráfico, gate, compressor, de-esser, envios, presets, cor |
| **0.0.5–0.0.9** | pares estéreo, pan, grupos de mudo, VCA, subgrupos, vistas do operador, tela de saída com EQ gráfico, matrizes, RTA |
| **0.0.10** | 📱 **celular/tablet** na mesma rede (perfis Operador e Músico — o músico só mexe no próprio retorno) |
| **0.0.11** | 🎤 **Medir o ganho** do canal e 🎸 ponto de partida por instrumento |
| **0.0.12** | 📥 trazer e atualizar tudo o que está gravado na mesa |
| **0.0.13** | mixer com barra lateral e channel strip, Digitech (simulador de amplificador), tablet do operador com o programa completo, página para iPad antigo |
| **0.0.14** | medidores de gate/compressor corrigidos, **gráficos do gate, compressor e de-esser** (dá para ajustar arrastando no gráfico), menos confirmações, 🎤 Medir não sobe o ganho quando o canal passa pelo Digitech · janela **Sobre** |

## Baixar

O programa pronto (assinado) fica em **Releases**: baixe o **`Instalar-MiguelAngelus-Mesa.exe`** e instale
(não pede administrador). Para atualizar, instale a versão nova por cima: a biblioteca e os ajustes ficam.

## Pastas

- `programa/` — o MiguelAngelus Mesa (.NET 8, tela em HTML com WebView2)
  - `Motor/` — conversa com a mesa, biblioteca, celular
  - `web/` — a tela (e as páginas do celular/tablet)
- `marca/` — ícone
- `instalador/` — instalador (Inno Setup 6) e `gerar_versao_mesa.ps1`, que publica, assina e monta a versão

## Compilar

Precisa do .NET 8 SDK. Para rodar, o computador precisa do **WebView2** (já vem no Windows 10/11).

```
cd programa
dotnet publish -c Release -o ..\saida
```

O programa sai "self-contained": não precisa instalar o .NET no computador da igreja.

## Dados e privacidade

- A biblioteca (shows, snapshots, cues, presets e o histórico) e os ajustes ficam em `%LOCALAPPDATA%\MiguelAngelusMesa`,
  só naquele computador. Nada passa por servidor nosso.
- O celular/tablet conversa direto com o computador, na rede local, depois de parear.
- O Mesa só grava na mesa quando alguém manda (botão, fader, preset, show).

## Créditos

- **Miguel Aurelio Dutra Martins** — criou o MiguelAngelus
- **Marcio Aurelio Rios Martins** — idealizou e desenvolveu o Mesa

Soundcraft e Ui24R são marcas da Harman; o Mesa não tem ligação com a fabricante.

## Licença

MIT — veja `LICENSE`. Componentes de terceiros mantêm as suas licenças (WebView2: Microsoft; qrcode.js: MIT, em `programa/web/lib/qrcode`).
