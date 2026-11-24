// Janela principal: a tela é HTML (pasta web\) num WebView2, como no MiguelAngelus e no Cast.
// A tela manda comandos em JSON ({tipo:...}); o programa responde com o estado da mesa e da biblioteca.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;
using MiguelAngelusMesa.Motor;

namespace MiguelAngelusMesa
{
    public sealed class Ajustes
    {
        public string MesaIp { get; set; } = "";
        public bool IniciarComWindows { get; set; } = true;
        public bool Claro { get; set; }
        /// <summary>(0.0.6) vistas do Mixer: listas de canais escolhidas pelo operador (ex.: "Vozes"), só no programa</summary>
        public List<Vista> Vistas { get; set; } = new List<Vista>();
        public sealed class Vista { public string Nome { get; set; } = ""; public List<string> Canais { get; set; } = new List<string>(); }

        static string Arquivo => Path.Combine(Program.PastaDados, "ajustes.json");
        public static Ajustes Ler() { try { if (File.Exists(Arquivo)) return JsonSerializer.Deserialize<Ajustes>(File.ReadAllText(Arquivo)) ?? new Ajustes(); } catch (Exception e) { Registro.Erro("ler ajustes", e); } return new Ajustes(); }
        public void Salvar() { try { File.WriteAllText(Arquivo, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); } catch (Exception e) { Registro.Erro("salvar ajustes", e); } }

        // abrir junto com o Windows: só para este usuário (HKCU\...\Run), nunca numa cópia de teste
        const string Run = @"Software\Microsoft\Windows\CurrentVersion\Run", NomeRun = "MiguelAngelus Mesa";
        public static bool Teste => !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("MESA_DADOS"));
        public void AplicarInicio()
        {
            if (Teste) return;
            try
            {
                using var k = Registry.CurrentUser.OpenSubKey(Run, true);
                if (k == null) return;
                if (IniciarComWindows) k.SetValue(NomeRun, $"\"{Application.ExecutablePath}\" --inicio");
                else if (k.GetValue(NomeRun) != null) k.DeleteValue(NomeRun, false);
            }
            catch (Exception e) { Registro.Erro("abrir com o Windows", e); }
        }
    }

    sealed class Principal : Form
    {
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(15, 20, 32) };
        readonly MesaUi mesa = new MesaUi();
        readonly Biblioteca bib = new Biblioteca();
        readonly Ajustes aj = Ajustes.Ler();
        readonly Timer relogio = new Timer { Interval = 500 };
        volatile bool mesaMudou = true;
        bool ocupado;
        // (0.0.2) Mixer: medidores e mudanças vindas da mesa a cada 80 ms, só com a aba aberta
        readonly Timer rapido = new Timer { Interval = 80 };
        bool mixerAberto;
        readonly Dictionary<string, string> pedidoPreset = new Dictionary<string, string>();   // (0.0.7) "tipo|nome" → aplicar/trazer
        static readonly System.Text.RegularExpressions.Regex DoMixer = new System.Text.RegularExpressions.Regex(
            @"^(?:mgmask|mg\.\d+\.name|[ilpfsav]\.\d+\.(?:name|color|mix|mute|solo|stereoIndex|matrix|pan|mgmask|forceunmute|vca|subgroup|aux\.\d+\.(?:value|mute|post)|fx\.\d+\.(?:value|mute)|mtx\.\d+\.(?:value|mute))|m\.(?:mix|mute|name|solo|dim)|f\.\d+\.fxtype" +
            // (0.0.3) tela do canal: entrada, filtros, EQ, gate, compressor, de-esser, atraso
            @"|[ilpfsa]\.\d+\.(?:src|gain|phantom|invert|hiz|delay|eq\.(?:bypass|easy|hpf\.(?:freq|slope)|lpf\.(?:freq|slope)|b[1-5]\.(?:freq|gain|q))|gate\.(?:enabled|bypass|thresh|attack|hold|release|depth)|dyn\.(?:bypass|threshold|ratio|attack|release|gain|outgain|softknee|autogain)|deesser\.(?:enabled|freq|threshold|ratio)|(?:eq|dyn|gate)\.(?:prname|prmod))" +
            @"|hw\.\d+\.(?:gain|phantom|hiz)" +
            // (0.0.13) Digitech (amp e caixa simulados): a tela só mostra nas entradas 1 e 2 (Hi-Z), como o app da mesa
            @"|i\.\d+\.digitech\.(?:enabled|amp|cab|gain|level|bass|mid|treble)" +
            // (0.0.9) matrizes: o master também manda para elas; pan quando a matriz é estéreo
            @"|[sa]\.\d+\.mtx\.\d+\.pan|m\.mtx\.\d+\.(?:value|mute|pan)" +
            // (0.0.7) tela de saída (aux/matriz e master): EQ gráfico de 31 bandas, filtros, compressor, atraso (segundos), fase; AFS do master (preset "master inteiro")
            @"|a\.\d+\.eq\.(?:hpf|lpf|linked|peak\.\d+)|m\.(?:delayL|delayR|[lr]\.invert|eq\.(?:bypass|linked|[hl]pf\.[lr]|peak\.[lr]\.\d+)|dyn\.(?:bypass|linked|[lr]\.(?:threshold|ratio|attack|release|hold|gain|outgain|softknee))|gate\.(?:enabled|bypass|thresh|attack|hold|release|depth)|(?:eq|dyn|gate)\.(?:prname|prmod)|afs\.(?:enabled|fmode|cmode|numtotal|numfixed|logic|livelift|sensitivity)))$",
            System.Text.RegularExpressions.RegexOptions.Compiled);

        public Principal()
        {
            Text = "MiguelAngelus Mesa " + Program.Versao + (Ajustes.Teste ? "  [CÓPIA DE TESTE]" : "");
            BackColor = Color.FromArgb(15, 20, 32);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            ClientSize = new Size(1360, 860);
            MinimumSize = new Size(900, 600);
            WindowState = Program.AbertoPeloWindows ? FormWindowState.Minimized : FormWindowState.Maximized;
            Controls.Add(web);
            Load += async (s, e) => await Iniciar();
            FormClosing += (s, e) => { relogio.Stop(); Celular.Parar(); try { if (rtaAntes != null && mesa.Valor("var.rta") == rtaAlvo) mesa.Definir("var.rta", rtaAntes).Wait(800); } catch { } mesa.Dispose(); Registro.Info("fechou"); };
        }

        async Task Iniciar()
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.PastaDados, "WebView2"));
                await web.EnsureCoreWebView2Async(env);
                var cw = web.CoreWebView2;
                cw.Settings.AreDefaultContextMenusEnabled = false;
                cw.Settings.IsZoomControlEnabled = false;
                cw.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("MESA_DEVTOOLS") == "1";
                cw.SetVirtualHostNameToFolderMapping("mesa.local", Path.Combine(Program.Pasta, "web"), CoreWebView2HostResourceAccessKind.Allow);
                cw.WebMessageReceived += (s, e) => { try { Mensagem(e.WebMessageAsJson); } catch (Exception ex) { Registro.Erro("mensagem da tela", ex); Aviso("Erro: " + ex.Message); } };
                mesa.Mudou += () => mesaMudou = true;
                // (0.0.7) presets guardados na mesa
                mesa.PresetsMesaChegou += tp => { if (trazendo) esperaLista?.TrySetResult(tp); };
                mesa.PresetsMesaChegou += tp => Na(() => Enviar(new { tipo = "presetsMesa", tp, lista = mesa.PresetsMesa.TryGetValue(tp, out var l) ? l : new List<string>() }));
                mesa.PresetMesaLido += (tp, nome, json) => Na(() =>
                {
                    if (trazendo) { esperaPreset?.TrySetResult(json); return; }   // (0.0.12) o "trazer tudo" é que pediu
                    var v = new Dictionary<string, double>();
                    try { using var d = JsonDocument.Parse(json); foreach (var q in d.RootElement.EnumerateObject()) if (q.Name.StartsWith('.') && q.Value.ValueKind == JsonValueKind.Number) v[q.Name] = q.Value.GetDouble(); }
                    catch { Aviso("A mesa mandou um preset que não deu para ler."); return; }
                    Enviar(new { tipo = "presetMesa", tp, nome, v, para = pedidoPreset.TryGetValue(tp + "|" + nome, out var para) ? para : "" });
                });
                mesa.Aviso += t => { t = t.TrimStart('$'); if (trazendo && (t.StartsWith("SNAPLOAD^") || t.StartsWith("CUELOAD^"))) esperaLoad?.TrySetResult(t); };
                mesa.Aviso += t => { t = t.TrimStart('$'); if (!(trazendo && (t.StartsWith("SNAPLOAD^") || t.StartsWith("CUELOAD^")))) Na(() => Aviso(
                    t == "SHOWEXP_SUCCESS" ? "A mesa gravou no pendrive." :
                    t.StartsWith("SNAPLOAD^") ? $"A mesa carregou o snapshot \"{t.Substring(9)}\". Como estava antes ficou guardado na Biblioteca, em \"{Biblioteca.ShowAntes}\"." :
                    t.StartsWith("CUELOAD^") ? $"A mesa carregou o cue \"{t.Substring(8)}\". Como estava antes ficou guardado na Biblioteca, em \"{Biblioteca.ShowAntes}\"." :
                    "Mesa: " + t.TrimStart('$').Replace('^', ' '))); };
                bool prontaAntes = false;
                relogio.Tick += (s, e) =>
                {
                    if (mesa.Pronta != prontaAntes) { prontaAntes = mesa.Pronta; mesaMudou = true; if (prontaAntes && mixerAberto) EnviarMixer(); }   // (re)conectou: o mixer recebe tudo de novo
                    if (mesaMudou) { mesaMudou = false; EnviarMesa(); }
                };
                relogio.Start();
                rapido.Tick += (s, e) => Rapido();
                rapido.Start();
                // (0.0.10) mesa pelo celular e pelo tablet (vem desligado)
                Celular.Estado = EstadoCelular; Celular.Definir = DefinirCelular;
                Celular.Mensagem = (r, json) => Na(() => { try { MensagemRemota(r, json); } catch (Exception ex) { Registro.Erro("mensagem do tablet", ex); } });
                Celular.Mudou += () => Na(EnviarCelular);
                Celular.Iniciar();
                aj.AplicarInicio();
                mesa.Conectar(aj.MesaIp);
                // (0.0.13) versão nova do programa: limpa o cache do WebView, senão ele mostra a tela antiga (js/css guardados)
                try
                {
                    var marca = Path.Combine(Program.PastaDados, "web.versao");
                    if (!File.Exists(marca) || File.ReadAllText(marca).Trim() != Program.Versao)
                    {
                        await cw.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
                        File.WriteAllText(marca, Program.Versao);
                    }
                }
                catch (Exception e) { Registro.Erro("limpar o cache da tela", e); }
                cw.Navigate("https://mesa.local/index.html");
            }
            catch (Exception e)
            {
                Registro.Erro("iniciar a tela", e);
                MessageBox.Show(this, "Não foi possível abrir a tela do MiguelAngelus Mesa.\n\nVerifique se o \"Microsoft Edge WebView2\" está instalado.\n\n" + e.Message, "MiguelAngelus Mesa", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void Na(Action a) { if (IsDisposed) return; try { if (InvokeRequired) BeginInvoke(a); else a(); } catch (ObjectDisposedException) { } }
        void Enviar(object o)
        {
            try
            {
                var json = JsonSerializer.Serialize(o);
                web.CoreWebView2?.PostWebMessageAsJson(json);
                // (0.0.13) as telas do programa completo nos tablets do operador recebem o mesmo — menos o que é só do computador
                if (Celular.HaRemotas && !SoDoComputador(json))
                    Celular.Difundir(json, json.StartsWith("{\"tipo\":\"vu\"") || json.StartsWith("{\"tipo\":\"rta\"") || json.StartsWith("{\"tipo\":\"valores\"") || json.StartsWith("{\"tipo\":\"mixerEstado\""));
            }
            catch (Exception e) { Registro.Erro("enviar à tela", e); }
        }
        static bool SoDoComputador(string json) => json.StartsWith("{\"tipo\":\"celular\"") || json.StartsWith("{\"tipo\":\"inicio\"") || json.StartsWith("{\"tipo\":\"pendrivesPc\"");
        // o que a tela do tablet NÃO pode pedir: mexer no computador (pastas, pendrive do computador, Windows), na conexão com a mesa,
        // nos pareamentos, e o "trazer tudo" (troca o som várias vezes; fica para quem está no computador)
        static readonly HashSet<string> SoNoComputador = new HashSet<string> { "conectar", "ajustes", "importar", "abrirPasta", "pendrivesPc", "copiarParaPendrive", "trazerTudo", "pararTrazer", "celPedir", "celLigar", "celCodigo", "celTirar" };
        void MensagemRemota(Celular.Remota r, string json)
        {
            string tipo;
            using (var d = JsonDocument.Parse(json)) tipo = d.RootElement.TryGetProperty("tipo", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : "";
            if (SoNoComputador.Contains(tipo)) return;
            switch (tipo)
            {
                case "pronto":
                {
                    var ajR = new { aj.Claro, aj.Vistas, MesaIp = aj.MesaIp, IniciarComWindows = false };
                    Celular.Para(r, JsonSerializer.Serialize(new { tipo = "inicio", versao = Program.Versao, teste = Ajustes.Teste, ajustes = ajR, pastaDados = "", remoto = true, aparelho = r.Nome }));
                    EnviarMesa(); EnviarBiblioteca();
                    Registro.Info($"tablet: programa completo aberto em \"{r.Nome}\"");
                    return;
                }
                case "mixer":
                {
                    using var d = JsonDocument.Parse(json);
                    r.Mixer = d.RootElement.TryGetProperty("aberto", out var ab) && ab.ValueKind == JsonValueKind.True;
                    if (r.Mixer && mesa.Pronta) Celular.Para(r, JsonSerializer.Serialize(new { tipo = "mixerEstado", modelo = mesa.Modelo, v = mesa.Estado().Where(kv => DoMixer.IsMatch(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value) }));
                    if (!r.Mixer && !mixerAberto && !Celular.MixerRemoto) Rta(null);
                    return;
                }
                case "mixerEstado":
                    if (mesa.Pronta) Celular.Para(r, JsonSerializer.Serialize(new { tipo = "mixerEstado", modelo = mesa.Modelo, v = mesa.Estado().Where(kv => DoMixer.IsMatch(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value) }));
                    return;
            }
            Mensagem(json);
        }
        void Aviso(string t) => Enviar(new { tipo = "aviso", texto = t });

        // ---------- (0.0.12) trazer TUDO o que está gravado na mesa para o programa, pela rede ----------
        // A mesa não deixa ler um snapshot sem carregá-lo: carrega um por um, espera sossegar, guarda o estado; no fim
        // volta ao show de antes e manda de volta, chave por chave, o som exato de antes (inclusive o que não estava salvo).
        // O som muda durante a cópia: a tela avisa para usar fora das celebrações.
        volatile bool trazendo, pararTrazer;
        TaskCompletionSource<string> esperaLoad, esperaLista, esperaPreset;
        static readonly string[] TiposPresetMesa = { "ch", "chm", "eqch", "eqaux", "eqm", "dynch", "dynaux", "dynm", "gate", "afs", "digi" };

        async Task Quieto(int maxMs = 10000)
        {
            var ate = DateTime.Now.AddMilliseconds(maxMs);
            await Task.Delay(400);
            while (mesa.SegundosSemMudar < 1.0 && DateTime.Now < ate) await Task.Delay(200);
        }

        async Task TrazerTudo()
        {
            trazendo = true; pararTrazer = false;
            string show0 = mesa.Show, snap0 = mesa.Snapshot, cue0 = mesa.Cue;
            var antes = mesa.Estado();
            var nomeAntes = bib.GuardarAntes(mesa, "trazer tudo da mesa");
            int safes = antes.Count(kv => kv.Key.EndsWith(".safe") && kv.Value == "1");
            void Prog(int feito, int total, string item) => Na(() => Enviar(new { tipo = "trazer", feito, total, item }));

            Prog(0, 0, "pedindo as listas à mesa…");
            await mesa.PedirListas(); await Task.Delay(1200);
            var lista = new List<(string show, string nome, bool cue)>();
            foreach (var s in mesa.Shows.ToList())
            {
                if (mesa.Snapshots.TryGetValue(s, out var l)) lista.AddRange(l.Select(n => (s, n, false)));
                if (mesa.Cues.TryGetValue(s, out var c)) lista.AddRange(c.Select(n => (s, n, true)));
            }
            Registro.Info($"trazer tudo: {lista.Count} snapshot(s)/cue(s) em {mesa.Shows.Count} show(s); antes = {show0} / {snap0}");

            int k = 0, ok = 0, novos = 0, mudados = 0, iguais = 0; var mudadosNomes = new List<string>(); var falhas = new List<string>(); string showAberto = show0;
            foreach (var (s, n, cue) in lista)
            {
                if (pararTrazer || !mesa.Conectada) break;
                Prog(k, lista.Count, $"{s} / {(cue ? "cue " : "")}{n}");
                if (s != showAberto) { await mesa.Mandar("LOADSHOW^" + s); showAberto = s; await Task.Delay(1200); await Quieto(); }
                esperaLoad = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                await mesa.Mandar(cue ? $"LOADCUE^{s}^{n}" : $"LOADSNAPSHOT^{s}^{n}");
                bool carregou = await Task.WhenAny(esperaLoad.Task, Task.Delay(6000)) == esperaLoad.Task;
                await Quieto();
                k++;
                if (!carregou) { falhas.Add($"{s} / {n}"); continue; }
                var nomeB = cue ? "cue · " + n : n; var res = bib.GuardarOuAtualizar(mesa, s, nomeB, "mesa (trazido pela rede)");
                if (res == "novo") novos++; else if (res == "mudou") { mudados++; mudadosNomes.Add($"{s} / {nomeB}"); } else iguais++;
                ok++;
            }

            // presets do usuário na memória da mesa (os de fábrica não precisam)
            int pr = 0, prNovos = 0, prMudados = 0;
            foreach (var tp in TiposPresetMesa)
            {
                if (pararTrazer || !mesa.Conectada) break;
                Prog(k, lista.Count, "presets: " + tp);
                esperaLista = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                await mesa.PedirPresetsMesa(tp);
                if (await Task.WhenAny(esperaLista.Task, Task.Delay(2000)) != esperaLista.Task) continue;
                foreach (var nome in (mesa.PresetsMesa.TryGetValue(tp, out var l) ? l : new List<string>()).Where(x => x.StartsWith("u:")).ToList())
                {
                    esperaPreset = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                    await mesa.LerPresetMesa(tp, nome);
                    if (await Task.WhenAny(esperaPreset.Task, Task.Delay(3000)) != esperaPreset.Task) { falhas.Add($"preset {tp} {nome.Substring(2)}"); continue; }
                    var rp = bib.GuardarPresetDaMesa(tp, nome.Substring(2), esperaPreset.Task.Result);
                    if (rp != null) { pr++; if (rp == "novo") prNovos++; else if (rp == "mudou") { prMudados++; mudadosNomes.Add($"preset {tp} {nome.Substring(2)}"); } }
                }
            }

            // devolver a mesa como estava
            Prog(k, lista.Count, "devolvendo a mesa como estava…");
            if (mesa.Conectada)
            {
                if (show0 != "" && mesa.Show != show0) { await mesa.Mandar("LOADSHOW^" + show0); await Task.Delay(1200); await Quieto(); }
                var agora = mesa.Estado();
                var volta = antes.Where(kv => !Biblioteca.ForaDoSnapshot(kv.Key) && !Biblioteca.SoLeitura(kv.Key) && (!agora.TryGetValue(kv.Key, out var v) || v != kv.Value)).ToList();
                int nv = await mesa.Definir(volta);
                await mesa.Definir(new[] { new KeyValuePair<string, string>("var.currentSnapshot", snap0), new KeyValuePair<string, string>("var.currentCue", cue0) });
                Registro.Info($"trazer tudo: {ok} guardado(s), {pr} preset(s), {falhas.Count} falha(s); devolvidos {nv} de {volta.Count} parâmetro(s)");
                Na(() =>
                {
                    Enviar(new { tipo = "trazer", fim = true, ok, novos, mudados, iguais, mudadosNomes, total = lista.Count, presets = pr, prNovos, prMudados, falhas, devolvidos = nv, aDevolver = volta.Count, safes, parou = pararTrazer });
                    Aviso($"Trazido da mesa: {ok} de {lista.Count} snapshot(s)/cue(s) — {novos} novo(s), {mudados} atualizado(s), {iguais} já iguais" + (pr > 0 ? $"; {pr} preset(s) do usuário ({prNovos} novo(s), {prMudados} atualizado(s))" : "") + ". " + (mudados + prMudados > 0 ? "As versões anteriores dos atualizados ficaram no histórico. " : "") +
                          (nv == volta.Count ? "A mesa voltou exatamente como estava." : $"Atenção: só {nv} de {volta.Count} parâmetros voltaram; use \"{nomeAntes}\" na Biblioteca.") +
                          (falhas.Count > 0 ? $" Não vieram: {string.Join(", ", falhas)}." : ""));
                });
            }
            else Na(() => { Enviar(new { tipo = "trazer", fim = true, ok, total = lista.Count, presets = pr, falhas, caiu = true }); Aviso($"A conexão caiu no meio. Para voltar o som de antes, mande \"{nomeAntes}\" pela Biblioteca."); });
        }

        void EnviarMesa() => Enviar(new
        {
            tipo = "mesa", ip = mesa.Ip, conectada = mesa.Conectada, pronta = mesa.Pronta, erro = mesa.Erro, modelo = mesa.Modelo, firmware = mesa.Firmware,
            show = mesa.Show, snapshot = mesa.Snapshot, cue = mesa.Cue, parametros = mesa.Quantos,
            shows = mesa.Shows.Select(s => new { nome = s, snapshots = mesa.Snapshots.TryGetValue(s, out var l) ? l : new List<string>(), cues = mesa.Cues.TryGetValue(s, out var c) ? c : new List<string>() }),
            pendrives = mesa.Pendrives, importaveis = mesa.Importaveis
        });

        void Rapido()
        {
            Dictionary<string, string> mud = null;
            bool algumMixer = mixerAberto || Celular.MixerRemoto;   // (0.0.13) ou o mixer no tablet do operador
            while (mesa.Mudancas.TryDequeue(out var k))
                if (algumMixer && DoMixer.IsMatch(k)) (mud ??= new Dictionary<string, string>())[k] = mesa.Valor(k);
            if (!algumMixer || !mesa.Conectada) return;
            if (mud != null) Enviar(new { tipo = "valores", v = mud });
            if (rtaAlvo != null && mesa.Valor("var.rta") == rtaAlvo && (DateTime.Now - mesa.RtaEm).TotalSeconds < 0.5 && !ReferenceEquals(mesa.Rta, rtaUltimo))
            { rtaUltimo = mesa.Rta; Enviar(new { tipo = "rta", alvo = rtaAlvo, d = rtaUltimo }); }
            var vu = mesa.Vu;
            if ((DateTime.Now - vu.Em).TotalSeconds < 1)
                Enviar(new { tipo = "vu", e = vu.Entrada, ep = vu.EntradaPre, eb = vu.EntradaBruta, l = vu.Line, p = vu.Player, f = vu.Fx, s = vu.Sub, a = vu.Aux, m = vu.Master, de = vu.DinEntrada, dp = vu.DinPlayer, dl = vu.DinLine });
        }

        // ---------- (0.0.10) mesa pelo celular e pelo tablet ----------
        void EnviarCelular() => Enviar(new { tipo = "celular", ligado = Celular.Ligado, porta = Celular.Porta, erro = Celular.Erro, codigo = Celular.Codigo, perfilCodigo = Celular.PerfilDoCodigo, enderecos = Celular.Enderecos(), aparelhos = Celular.Aparelhos(),
            auxes = Enumerable.Range(0, mesa.Modelo == "ui12" ? 4 : mesa.Modelo == "ui16" ? 6 : 10).Select(n => new { n, nome = mesa.Valor($"a.{n}.name") ?? "", matriz = mesa.Valor($"a.{n}.matrix") == "1" }) });
        static readonly System.Text.RegularExpressions.Regex CelBase = new System.Text.RegularExpressions.Regex(@"^(?:[ilpfsav]\.\d+\.(?:name|color|stereoIndex|matrix)|m\.name|model)$", System.Text.RegularExpressions.RegexOptions.Compiled);
        static readonly System.Text.RegularExpressions.Regex CelLr = new System.Text.RegularExpressions.Regex(@"^(?:[ilpfsav]\.\d+\.(?:mix|mute)|m\.(?:mix|mute))$", System.Text.RegularExpressions.RegexOptions.Compiled);
        object EstadoCelular(Celular.Aparelho ap, string camada)
        {
            var mm = System.Text.RegularExpressions.Regex.Match(ap.Perfil ?? "", @"^aux:(\d{1,2})$");
            if (mm.Success) camada = "a." + mm.Groups[1].Value;                 // o músico só vê o retorno dele
            else if (camada != "lr" && !System.Text.RegularExpressions.Regex.IsMatch(camada ?? "", @"^a\.\d{1,2}$")) camada = "lr";
            System.Text.RegularExpressions.Regex daCamada = camada == "lr" ? CelLr
                : new System.Text.RegularExpressions.Regex($@"^(?:[ilpf]\.\d+\.aux\.{camada.Substring(2)}\.(?:value|mute)|{camada.Replace(".", @"\.")}\.(?:mix|mute))$");
            var v = new Dictionary<string, string>();
            foreach (var kv in mesa.Estado()) if (CelBase.IsMatch(kv.Key) || daCamada.IsMatch(kv.Key)) v[kv.Key] = kv.Value;
            var vu = mesa.Vu; bool vuOk = (DateTime.Now - vu.Em).TotalSeconds < 1;
            return new
            {
                conectada = mesa.Pronta, modelo = mesa.Modelo, camada, v,
                vu = vuOk ? new { e = vu.Entrada, l = vu.Line, p = vu.Player, f = vu.Fx, s = vu.Sub, a = vu.Aux, m = vu.Master } : null,
                vistas = ap.Perfil == "operador" ? aj.Vistas : null
            };
        }
        int DefinirCelular(Celular.Aparelho ap, Dictionary<string, string> v)
        {
            if (!mesa.Pronta) return 0;
            foreach (var kv in v) { _ = mesa.Definir(kv.Key, kv.Value); mesa.Mudancas.Enqueue(kv.Key); }   // a tela do computador acompanha
            return v.Count;
        }

        // (0.0.9) RTA: o operador liga na tela; a mesa só analisa um canal por vez ("var.rta"). Guarda o que estava e devolve
        // ao desligar, ao sair do mixer e ao fechar o programa.
        string rtaAlvo, rtaAntes, rtaUltimo;
        void Rta(string alvo)
        {
            if (string.IsNullOrEmpty(alvo))
            {
                if (rtaAntes != null && mesa.Pronta && mesa.Valor("var.rta") == rtaAlvo) _ = mesa.Definir("var.rta", rtaAntes);
                rtaAlvo = rtaAntes = rtaUltimo = null; return;
            }
            if (!mesa.Pronta || !System.Text.RegularExpressions.Regex.IsMatch(alvo, @"^(?:[ilpsfa]\.\d{1,2}|m)$")) return;
            rtaAntes ??= mesa.Valor("var.rta") ?? "";
            rtaAlvo = alvo; rtaUltimo = null;
            if (mesa.Valor("var.rta") != alvo) _ = mesa.Definir("var.rta", alvo);
        }

        void EnviarMixer() => Enviar(new { tipo = "mixerEstado", modelo = mesa.Modelo, v = mesa.Estado().Where(kv => DoMixer.IsMatch(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value) });

        void EnviarBiblioteca() => Enviar(new { tipo = "biblioteca", dados = bib.Listar(), exports = Biblioteca.ProcurarExports() });

        void Mensagem(string json)
        {
            using var doc = JsonDocument.Parse(json);
            var m = doc.RootElement;
            string S(string n) => m.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "";
            switch (S("tipo"))
            {
                case "pronto":
                    Enviar(new { tipo = "inicio", versao = Program.Versao, teste = Ajustes.Teste, ajustes = aj, pastaDados = Program.PastaDados });
                    EnviarMesa(); EnviarBiblioteca();
                    break;
                case "conectar":
                    aj.MesaIp = S("ip").Trim(); aj.Salvar(); mesa.Conectar(aj.MesaIp); EnviarMesa();
                    break;
                case "ajustes":
                    if (m.TryGetProperty("iniciarComWindows", out var iw)) { aj.IniciarComWindows = iw.GetBoolean(); aj.AplicarInicio(); }
                    if (m.TryGetProperty("claro", out var cl)) aj.Claro = cl.GetBoolean();
                    aj.Salvar();
                    break;
                case "biblioteca": EnviarBiblioteca(); break;
                case "abrirLink":   // (0.0.14) links do Sobre: só estes três, no navegador do computador
                    {
                        var url = S("url");
                        if (url is "https://pascom-sjo.github.io/" or "https://www.youtube.com/@SaoJos%C3%A9Oper%C3%A1rioIlha" or "mailto:contato.miguelangelus@gmail.com")
                            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) { Registro.Erro("abrir link", ex); }
                    }
                    break;
                case "atualizarListas": _ = mesa.PedirListas(); break;

                case "importar":
                {
                    var pasta = S("pasta");
                    if (pasta == "")
                    {
                        using var dlg = new FolderBrowserDialog { Description = "Escolha a pasta \"Exports\" que a mesa gravou no pendrive", UseDescriptionForTitle = true };
                        if (dlg.ShowDialog(this) != DialogResult.OK) return;
                        pasta = dlg.SelectedPath;
                    }
                    var r = bib.Importar(pasta);
                    Aviso(r.novos + r.trocados == 0 ? $"Nada de novo: os {r.iguais} arquivo(s) já estavam guardados iguaizinhos."
                        : $"Guardado no programa: {r.novos} novo(s)" + (r.trocados > 0 ? $", {r.trocados} atualizado(s) (a versão anterior foi para o histórico)" : "") + (r.iguais > 0 ? $"; {r.iguais} já estavam iguais" : "") + ".");
                    EnviarBiblioteca();
                    break;
                }

                case "guardarDaMesa":
                {
                    if (!mesa.Pronta) { Aviso("A mesa ainda não está conectada (ou ainda está mandando o estado)."); return; }
                    string show = S("show"), snap = S("snapshot");
                    if (show == "" || snap == "") { Aviso("Falta o nome do show ou do snapshot."); return; }
                    bib.GuardarDaMesa(mesa, show, snap);
                    Aviso($"Guardado no programa: \"{snap}\" (show {show}), do jeito que a mesa está agora.");
                    EnviarBiblioteca();
                    break;
                }

                case "comparar":
                {
                    string show = S("show"), snap = S("snapshot");
                    if (!mesa.Pronta) { Enviar(new { tipo = "comparacao", show, snapshot = snap, erro = "Conecte a mesa para comparar." }); return; }
                    var d = Biblioteca.Comparar(bib.LerSnapshot(show, snap), mesa);
                    Enviar(new { tipo = "comparacao", show, snapshot = snap, diferencas = d.Select(x => new { x.chave, x.grupo, x.rotulo, x.noArquivo, x.naMesa, x.protegido }) });
                    break;
                }

                case "mandar":
                {
                    if (ocupado) return;
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada."); return; }
                    string show = S("show"), snap = S("snapshot");
                    var escolhidas = m.TryGetProperty("chaves", out var ch) && ch.ValueKind == JsonValueKind.Array ? ch.EnumerateArray().Select(x => x.GetString()).ToHashSet() : null;
                    var d = Biblioteca.Comparar(bib.LerSnapshot(show, snap), mesa).Where(x => !x.protegido && (escolhidas == null || escolhidas.Contains(x.chave))).ToList();
                    if (d.Count == 0) { Aviso("A mesa já está igual ao snapshot guardado."); return; }
                    ocupado = true;
                    Registro.Info($"mandar para a mesa: \"{show} / {snap}\", {d.Count} parâmetro(s)");
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            int n = await mesa.Definir(d.Select(x => new KeyValuePair<string, string>(x.chave, x.arquivoBruto)), k => Na(() => Enviar(new { tipo = "progresso", feito = k, total = d.Count })));
                            Na(() => { Enviar(new { tipo = "progresso", feito = n, total = d.Count, fim = true }); Aviso(n == d.Count ? $"Pronto: {n} parâmetro(s) mandados para a mesa." : $"A conexão caiu no meio: {n} de {d.Count} mandados."); });
                        }
                        finally { ocupado = false; }
                    });
                    break;
                }

                // ---------- (0.0.2) Mixer ----------
                case "mixer":
                    mixerAberto = m.TryGetProperty("aberto", out var ab) && ab.GetBoolean();
                    if (mixerAberto && mesa.Pronta) EnviarMixer();
                    if (!mixerAberto && !Celular.MixerRemoto) Rta(null);
                    break;
                case "rta": Rta(S("alvo")); break;
                case "mixerEstado": if (mesa.Pronta) EnviarMixer(); break;
                case "definir":
                {
                    var k = S("k"); var v = S("v");
                    if (!mesa.Pronta || !DoMixer.IsMatch(k)) return;   // a tela do mixer só mexe no que é do mixer
                    _ = mesa.Definir(k, v);
                    if (Celular.HaRemotas) mesa.Mudancas.Enqueue(k);   // (0.0.13) a outra tela (computador ou tablet) acompanha; quem mexeu ignora o eco
                    break;
                }
                // ---------- (0.0.12) trazer tudo da mesa (a tela já pediu confirmação) ----------
                case "trazerTudo":
                {
                    if (ocupado || trazendo) return;
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada (ou ainda está mandando o estado)."); return; }
                    ocupado = true;
                    _ = Task.Run(async () =>
                    {
                        try { await TrazerTudo(); }
                        catch (Exception e) { Registro.Erro("trazer tudo", e); Na(() => { Enviar(new { tipo = "trazer", fim = true, erro = e.Message }); Aviso("Parou no meio: " + e.Message + $" — o som de antes está na Biblioteca, em \"{Biblioteca.ShowAntes}\"."); }); }
                        finally { trazendo = false; ocupado = false; Na(EnviarBiblioteca); }
                    });
                    break;
                }
                case "pararTrazer": pararTrazer = true; break;

                // ---------- (0.0.4) shows, snapshots e cues NA MESA (a tela já pediu confirmação) ----------
                case "naMesa":
                {
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada."); return; }
                    string acao = S("acao"), show = S("show").Trim(), nome = S("nome").Trim();
                    switch (acao)
                    {
                        case "carregarShow":
                            Registro.Info($"mesa: carregar show \"{show}\"");
                            _ = mesa.CarregarShow(show); Aviso($"Show \"{show}\" aberto na mesa (o som não muda até carregar um snapshot).");
                            break;
                        case "carregarSnapshot":
                        case "carregarCue":
                        {
                            bool cue = acao == "carregarCue";
                            var antes = bib.GuardarAntes(mesa, $"{show} / {nome}");   // dá para desfazer pela Biblioteca
                            Registro.Info($"mesa: carregar {(cue ? "cue" : "snapshot")} \"{show} / {nome}\"");
                            _ = cue ? mesa.CarregarCue(show, nome) : mesa.CarregarSnapshot(show, nome);
                            Aviso($"{(cue ? "Cue" : "Snapshot")} \"{nome}\" carregado na mesa. Como estava antes ficou guardado na Biblioteca, em \"{Biblioteca.ShowAntes}\".");
                            EnviarBiblioteca();
                            break;
                        }
                        case "salvarSnapshot":
                        case "salvarCue":
                        {
                            bool cue = acao == "salvarCue";
                            if (show == "" || nome == "") { Aviso("Falta o nome."); return; }
                            Registro.Info($"mesa: salvar {(cue ? "cue" : "snapshot")} \"{show} / {nome}\"");
                            _ = cue ? mesa.SalvarCue(show, nome) : mesa.SalvarSnapshot(show, nome);
                            if (!cue) { bib.GuardarDaMesa(mesa, show, nome); EnviarBiblioteca(); }   // a cópia no programa fica igual à da mesa
                            Aviso(cue ? $"Cue \"{nome}\" salvo na mesa." : $"Snapshot \"{nome}\" salvo na mesa e guardado no programa.");
                            break;
                        }
                        case "criarShow":
                            if (show == "") return;
                            Registro.Info($"mesa: criar show \"{show}\"");
                            _ = mesa.CriarShow(show); Aviso($"Show \"{show}\" criado na mesa.");
                            break;
                        case "importaveis": _ = mesa.PedirImportaveis(); break;
                        case "importar":
                        {
                            var item = S("item"); if (item == "") return;
                            Registro.Info($"mesa: importar show do pendrive \"{item}\"");
                            _ = mesa.ImportarShow(item); Aviso($"A mesa está copiando \"{item}\" do pendrive…");
                            break;
                        }
                    }
                    break;
                }

                // (0.0.10) mesa pelo celular e pelo tablet
                case "celPedir": EnviarCelular(); break;
                case "celLigar": Celular.Ligar(m.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True); break;
                case "celCodigo": Celular.CodigoPara(S("perfil")); break;
                case "celTirar": Celular.Tirar(S("id")); break;
                case "vistas":
                {
                    var l = new List<Ajustes.Vista>();
                    if (m.TryGetProperty("lista", out var vl) && vl.ValueKind == JsonValueKind.Array)
                        foreach (var x in vl.EnumerateArray().Take(20))
                        {
                            var nome = x.TryGetProperty("Nome", out var n) ? (n.GetString() ?? "").Trim() : "";
                            var canais = x.TryGetProperty("Canais", out var c) && c.ValueKind == JsonValueKind.Array ? c.EnumerateArray().Select(y => y.GetString() ?? "").Where(y => System.Text.RegularExpressions.Regex.IsMatch(y, @"^[ilpfsav]:\d{1,2}$")).Distinct().ToList() : new List<string>();
                            if (nome.Length > 0 && nome.Length <= 30) l.Add(new Ajustes.Vista { Nome = nome, Canais = canais });
                        }
                    aj.Vistas = l; aj.Salvar();
                    break;
                }
                case "pendrivesPc": Enviar(new { tipo = "pendrivesPc", lista = Biblioteca.PendrivesNoComputador() }); break;
                case "copiarParaPendrive":
                {
                    string show = S("show"), raiz = S("raiz");
                    int n = bib.CopiarShowParaPendrive(show, raiz);
                    Aviso($"Show \"{show}\" copiado para o pendrive ({n} arquivos, na pasta Exports). Agora espete o pendrive na mesa e use \"Importar do pendrive\" na aba Mesa.");
                    break;
                }

                // ---------- (0.0.3) presets de canal guardados no programa ----------
                case "presets":
                    Enviar(new { tipo = "presets", tp = S("tp"), lista = Biblioteca.LerPresets(S("tp")) });
                    break;
                case "guardarPreset":
                {
                    var tp = S("tp"); var nome = S("nome").Trim();
                    var v = new Dictionary<string, double>();
                    if (m.TryGetProperty("v", out var vv) && vv.ValueKind == JsonValueKind.Object)
                        foreach (var p in vv.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number) v[p.Name] = p.Value.GetDouble();
                    if (v.Count == 0) { Aviso("Nada para guardar."); return; }
                    bib.GuardarPreset(tp, nome, v);
                    Aviso($"Preset \"{nome}\" guardado no programa.");
                    Enviar(new { tipo = "presets", tp, lista = Biblioteca.LerPresets(tp) });
                    break;
                }
                case "apagarPreset":
                {
                    var tp = S("tp"); var nome = S("nome");
                    bib.ApagarPreset(tp, nome);
                    Aviso($"Preset \"{nome}\" apagado (uma cópia ficou no histórico da biblioteca).");
                    Enviar(new { tipo = "presets", tp, lista = Biblioteca.LerPresets(tp) });
                    break;
                }
                // ---------- (0.0.7) presets NA MESA: ler é livre; gravar só com o botão + confirmação na tela ----------
                case "presetsMesa":
                    if (mesa.Pronta) _ = mesa.PedirPresetsMesa(S("tp"));
                    break;
                case "lerPresetMesa":
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada."); return; }
                    pedidoPreset[S("tp") + "|" + S("nome")] = S("para");
                    _ = mesa.LerPresetMesa(S("tp"), S("nome"));
                    break;
                case "gravarPresetMesa":
                {
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada."); return; }
                    var tp = S("tp"); var nome = S("nome").Trim();
                    if (nome.Length == 0 || nome.Length > 40) { Aviso("Dê um nome de até 40 letras."); return; }
                    var sb = new System.Text.StringBuilder("{"); bool primeiro = true;
                    if (m.TryGetProperty("v", out var vv) && vv.ValueKind == JsonValueKind.Object)
                        foreach (var q in vv.EnumerateObject())
                            if (q.Name.StartsWith('.') && System.Text.RegularExpressions.Regex.IsMatch(q.Name, @"^[\w.]+$") && q.Value.ValueKind == JsonValueKind.Number)
                            { sb.Append(primeiro ? "" : ",").Append(JsonSerializer.Serialize(q.Name)).Append(':').Append(q.Value.GetDouble().ToString("R", System.Globalization.CultureInfo.InvariantCulture)); primeiro = false; }
                    sb.Append('}');
                    if (primeiro) { Aviso("Nada para gravar."); return; }
                    _ = mesa.GravarPresetMesa(tp, nome, sb.ToString()).ContinueWith(x => Na(() => Aviso(x.Result ? $"Preset \"{nome}\" gravado na memória da mesa." : "Não deu para gravar o preset na mesa.")));
                    break;
                }
                case "pendrives": _ = mesa.PedirPendrives(); break;
                case "exportarPendrive":
                    if (!mesa.Pronta) { Aviso("A mesa não está conectada."); return; }
                    _ = mesa.ExportarShow(S("pendrive"), S("show"));
                    break;
                case "abrirPasta":
                    try { Directory.CreateDirectory(Biblioteca.Raiz); System.Diagnostics.Process.Start("explorer.exe", Biblioteca.Raiz); } catch (Exception e) { Registro.Erro("abrir pasta", e); }
                    break;
            }
        }
    }
}
