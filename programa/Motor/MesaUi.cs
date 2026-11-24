// Mesas Soundcraft Ui (Ui12, Ui16, Ui24R) pela rede: o mesmo protocolo do app da própria mesa (WebSocket em ws://IP/).
// Mensagens "3:::COMANDO^a^b". Ao conectar, a mesa manda o estado inteiro (SETD = número, SETS = texto); depois manda
// só o que muda. A mesa NÃO devolve o valor para quem o mandou. "ALIVE" a cada segundo mantém a conexão.
// Lido e conferido na Ui24R fw 3.5.8328 em 22/11/2026 (ver memória do projeto e o MesaUi.cs do Cast).
// Este programa só MANDA alguma coisa para a mesa quando o operador pede (botão), nunca sozinho.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MiguelAngelusMesa.Motor
{
    public sealed class MesaUi : IDisposable
    {
        ClientWebSocket ws;
        CancellationTokenSource cts;
        readonly SemaphoreSlim envio = new SemaphoreSlim(1, 1);
        readonly ConcurrentDictionary<string, string> estado = new ConcurrentDictionary<string, string>();
        readonly ConcurrentDictionary<string, bool> texto = new ConcurrentDictionary<string, bool>();   // chaves que vieram por SETS
        DateTime ultimoSet = DateTime.MinValue, conectouEm;

        public string Ip { get; private set; } = "";
        public bool Conectada { get; private set; }
        /// <summary>conectada e com o estado inicial já recebido (o "dump" chega em rajada logo ao conectar)</summary>
        public bool Pronta => Conectada && estado.Count > 100 && (DateTime.Now - conectouEm).TotalSeconds > 2 && (DateTime.Now - ultimoSet).TotalSeconds > 1;
        /// <summary>(0.0.12) há quanto tempo a mesa não manda nenhuma mudança (depois de carregar um snapshot, espera sossegar)</summary>
        public double SegundosSemMudar => (DateTime.Now - ultimoSet).TotalSeconds;
        public string Erro { get; private set; } = "";
        public string Modelo => Valor("model") ?? "";
        public string Firmware => Valor("firmware") ?? "";
        public string Show => Valor("var.currentShow") ?? "";
        public string Snapshot => Valor("var.currentSnapshot") ?? "";
        public string Cue => Valor("var.currentCue") ?? "";

        public List<string> Shows { get; private set; } = new List<string>();
        public readonly ConcurrentDictionary<string, List<string>> Snapshots = new ConcurrentDictionary<string, List<string>>();
        public readonly ConcurrentDictionary<string, List<string>> Cues = new ConcurrentDictionary<string, List<string>>();
        public List<string> Pendrives { get; private set; } = new List<string>();

        /// <summary>mudou algo (conexão, listas ou parâmetros). Pode vir em rajada: quem escuta junta.</summary>
        public event Action Mudou;
        /// <summary>mensagens da mesa para o operador (MSG^...), ex.: "$SHOWEXP_SUCCESS"</summary>
        public event Action<string> Aviso;

        public string Valor(string chave) => estado.TryGetValue(chave, out var v) ? v : null;
        public IReadOnlyDictionary<string, string> Estado() => new Dictionary<string, string>(estado);
        public bool EhTexto(string chave) => texto.ContainsKey(chave);
        public int Quantos => estado.Count;

        public void Conectar(string ip)
        {
            ip = (ip ?? "").Trim();
            if (ip == Ip && cts != null) return;
            Desconectar();
            Ip = ip;
            if (ip == "") { Erro = ""; Mudou?.Invoke(); return; }
            cts = new CancellationTokenSource();
            var c = cts.Token;
            _ = Task.Run(() => Laco(ip, c));
        }

        void Desconectar()
        {
            try { cts?.Cancel(); } catch { }
            cts = null;
            try { ws?.Abort(); ws?.Dispose(); } catch { }
            ws = null; Conectada = false;
            estado.Clear(); texto.Clear(); Shows = new List<string>(); Snapshots.Clear(); Cues.Clear(); Pendrives = new List<string>();
        }

        async Task Laco(string ip, CancellationToken c)
        {
            while (!c.IsCancellationRequested)
            {
                try
                {
                    ws = new ClientWebSocket();
                    ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(10);
                    using (var t = CancellationTokenSource.CreateLinkedTokenSource(c)) { t.CancelAfter(5000); await ws.ConnectAsync(new Uri($"ws://{ip}/"), t.Token); }
                    estado.Clear(); texto.Clear();
                    Conectada = true; conectouEm = DateTime.Now; Erro = "";
                    Registro.Info("mesa: conectada em " + ip);
                    Mudou?.Invoke();
                    var vivo = Task.Run(async () => { while (!c.IsCancellationRequested && ws.State == WebSocketState.Open) { await Mandar("ALIVE"); await Task.Delay(1000, c); } });
                    _ = Task.Run(async () => { await Task.Delay(2500, c); await PedirListas(); });
                    await Receber(c);
                }
                catch (OperationCanceledException) when (c.IsCancellationRequested) { break; }
                catch (Exception e) { Erro = e.Message; }
                if (Conectada) Registro.Info("mesa: conexão caiu (" + Erro + ")");
                Conectada = false; Mudou?.Invoke();
                try { await Task.Delay(3000, c); } catch { break; }
            }
        }

        async Task Receber(CancellationToken c)
        {
            var buf = new byte[1 << 16];
            var sb = new StringBuilder();
            while (!c.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buf, c);
                if (r.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                if (!r.EndOfMessage) continue;
                var msg = sb.ToString(); sb.Clear();
                bool mudou = false;
                foreach (var linha in msg.Split('\n'))
                {
                    var l = linha.StartsWith("3:::") ? linha.Substring(4) : linha;
                    if (l.StartsWith("VU2^")) { LerVu(l.Substring(4)); continue; }
                    if (l.StartsWith("RTA^")) { Rta = l.Substring(4).Trim(); RtaEm = DateTime.Now; continue; }
                    if (l.Length == 0 || l == "2::" || l == "ALIVE" || l.StartsWith("VUA^") || l.StartsWith("RTA^")) continue;
                    if (l.StartsWith("SETD^") || l.StartsWith("SETS^"))
                    {
                        var p = l.Split('^');
                        if (p.Length < 3) continue;
                        estado[p[1]] = string.Join("^", p.Skip(2));
                        if (l[3] == 'S') texto[p[1]] = true;
                        if (Pronta) Mudancas.Enqueue(p[1]);   // depois do estado inicial: a tela recebe só o que mudou
                        ultimoSet = DateTime.Now; mudou = true;
                    }
                    else if (l.StartsWith("SHOWLIST^")) { Shows = l.Split('^').Skip(1).Where(x => x != "").ToList(); mudou = true; }
                    else if (l.StartsWith("SNAPSHOTLIST^")) { var p = l.Split('^'); if (p.Length > 1) Snapshots[p[1]] = p.Skip(2).Where(x => x != "").ToList(); mudou = true; }
                    else if (l.StartsWith("CUELIST^")) { var p = l.Split('^'); if (p.Length > 1) Cues[p[1]] = p.Skip(2).Where(x => x != "").ToList(); mudou = true; }
                    else if (l.StartsWith("IMPORTSHOWLIST")) { Importaveis = l.Split('^').Skip(1).Where(x => x != "").ToList(); mudou = true; }
                    else if (l.StartsWith("USBMOUNTS^")) { Pendrives = l.Split('^').Skip(1).Where(x => x != "").ToList(); mudou = true; }
                    else if (l.StartsWith("PRESETLIST^")) { var p = l.Split('^'); if (p.Length > 1) { PresetsMesa[p[1]] = p.Skip(2).Where(x => x != "").ToList(); PresetsMesaChegou?.Invoke(p[1]); } }
                    else if (l.StartsWith("READPRESET^")) { var p = l.Split('^'); if (p.Length > 3) PresetMesaLido?.Invoke(p[1], p[2], string.Join("^", p.Skip(3))); }
                    else if (l.StartsWith("MSG^")) { var t = l.Substring(4); Registro.Info("mesa: aviso " + t); Aviso?.Invoke(t); }
                }
                if (mudou) Mudou?.Invoke();
            }
        }

        public async Task<bool> Mandar(string comando)
        {
            var w = ws;
            if (w == null || w.State != WebSocketState.Open) return false;
            await envio.WaitAsync();
            try { await w.SendAsync(Encoding.UTF8.GetBytes("3:::" + comando), WebSocketMessageType.Text, true, CancellationToken.None); return true; }
            catch (Exception e) { Erro = e.Message; return false; }
            finally { envio.Release(); }
        }

        public async Task PedirListas()
        {
            if (!await Mandar("SHOWLIST")) return;
            await Task.Delay(800);
            foreach (var s in Shows.ToList()) { await Mandar("SNAPSHOTLIST^" + s); await Mandar("CUELIST^" + s); await Task.Delay(150); }
        }

        // ---------- (0.0.4) shows, snapshots e cues NA MESA — sempre por pedido do operador, com confirmação na tela ----------
        static string N(string s) => (s ?? "").Replace("^", "_").Trim();
        async Task Depois(string show) { await Task.Delay(700); await Mandar("SHOWLIST"); await Task.Delay(300); if (show != "") { await Mandar("SNAPSHOTLIST^" + show); await Mandar("CUELIST^" + show); } }
        public async Task CarregarShow(string show) { await Mandar("LOADSHOW^" + N(show)); await Depois(N(show)); }
        public async Task CarregarSnapshot(string show, string snap) { await Mandar($"LOADSNAPSHOT^{N(show)}^{N(snap)}"); }
        public async Task SalvarSnapshot(string show, string snap) { await Mandar($"SAVESNAPSHOT^{N(show)}^{N(snap)}"); await Depois(N(show)); }
        public async Task CarregarCue(string show, string cue) { await Mandar($"LOADCUE^{N(show)}^{N(cue)}"); }
        public async Task SalvarCue(string show, string cue) { await Mandar($"SAVECUE^{N(show)}^{N(cue)}"); await Depois(N(show)); }
        public async Task CriarShow(string show) { await Mandar("CREATESHOW^" + N(show)); await Depois(N(show)); }
        /// <summary>shows que a mesa acha no pendrive espetado NELA (resposta IMPORTSHOWLIST^…)</summary>
        public List<string> Importaveis { get; private set; } = null;
        public Task<bool> PedirImportaveis() { Importaveis = null; return Mandar("IMPORTSHOWLIST"); }
        public async Task ImportarShow(string item) { await Mandar("IMPORTSHOW^" + item); await Task.Delay(1500); await PedirListas(); }

        // ---------- (0.0.7) presets guardados NA MESA (os do app da mesa e os de fábrica) ----------
        // PRESETLIST^tipo → PRESETLIST^tipo^u:nome^f:nome…   READPRESET^tipo^u:nome → READPRESET^tipo^u:nome^{json}
        // WRITEPRESET^tipo^u:nome^{json} (grava na memória da mesa)   DELETEPRESET^tipo^u:nome   (app da mesa, lido em 22/11/2026)
        public readonly ConcurrentDictionary<string, List<string>> PresetsMesa = new ConcurrentDictionary<string, List<string>>();
        public event Action<string> PresetsMesaChegou;
        public event Action<string, string, string> PresetMesaLido;
        static bool TipoPresetOk(string tp) => System.Text.RegularExpressions.Regex.IsMatch(tp ?? "", "^[a-z]{1,12}$");
        public Task<bool> PedirPresetsMesa(string tp) => TipoPresetOk(tp) ? Mandar("PRESETLIST^" + tp) : Task.FromResult(false);
        public Task<bool> LerPresetMesa(string tp, string nome) => TipoPresetOk(tp) && System.Text.RegularExpressions.Regex.IsMatch(nome ?? "", "^[uf]:") ? Mandar($"READPRESET^{tp}^{nome.Replace("^", "_")}") : Task.FromResult(false);
        public async Task<bool> GravarPresetMesa(string tp, string nome, string json)
        {
            if (!TipoPresetOk(tp) || string.IsNullOrWhiteSpace(nome) || json.Contains('^') || json.Contains('\n')) return false;
            var ok = await Mandar($"WRITEPRESET^{tp}^u:{N(nome)}^{json}");
            if (ok) { Registro.Info($"mesa: preset {tp} \"{N(nome)}\" gravado na mesa"); await Task.Delay(500); await PedirPresetsMesa(tp); }
            return ok;
        }
        public async Task<bool> ApagarPresetMesa(string tp, string nome)
        {
            if (!TipoPresetOk(tp) || !(nome ?? "").StartsWith("u:")) return false;   // os de fábrica (f:) não se apagam
            var ok = await Mandar($"DELETEPRESET^{tp}^{nome.Replace("^", "_")}");
            if (ok) { await Task.Delay(500); await PedirPresetsMesa(tp); }
            return ok;
        }

        public Task<bool> PedirPendrives() => Mandar("USBMOUNTS");
        public Task<bool> ExportarShow(string pendrive, string show) => Mandar($"EXPORTSHOW^{pendrive}^{show}");
        public Task<bool> ExportarPresets(string pendrive) => Mandar($"EXPORTPRESETS^{pendrive}");

        /// <summary>Muda parâmetros na mesa, em ritmo que a mesa aguenta. Guarda no estado local (a mesa não devolve).</summary>
        public async Task<int> Definir(IEnumerable<KeyValuePair<string, string>> valores, Action<int> progresso = null)
        {
            int n = 0;
            foreach (var kv in valores)
            {
                bool ehTexto = texto.ContainsKey(kv.Key) || !double.TryParse(kv.Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _);
                if (!await Mandar((ehTexto ? "SETS^" : "SETD^") + kv.Key + "^" + kv.Value)) break;
                estado[kv.Key] = kv.Value;
                if (++n % 100 == 0) { progresso?.Invoke(n); await Task.Delay(40); }
            }
            if (n > 0) { Registro.Info($"mesa: {n} parâmetro(s) mandados"); Mudou?.Invoke(); }
            return n;
        }

        /// <summary>chaves que a MESA mudou (alguém no app da mesa, outro celular…), para a tela atualizar só elas</summary>
        public readonly ConcurrentQueue<string> Mudancas = new ConcurrentQueue<string>();

        /// <summary>um parâmetro só (fader arrastado na tela): manda e guarda; não entra na fila de mudanças</summary>
        public Task<bool> Definir(string chave, string valor)
        {
            bool ehTexto = texto.ContainsKey(chave) || chave.EndsWith(".name") || chave.EndsWith(".prname") || !double.TryParse(valor, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _);
            estado[chave] = valor;
            return Mandar((ehTexto ? "SETS^" : "SETD^") + chave + "^" + valor);
        }

        // ---------- medidores (mensagem "VU2^base64"), lidos na Ui24R fw 3.5.8328 em 22/11/2026 ----------
        // cabeçalho de 8 bytes: [entradas, players, subgrupos, fx, aux, masters, line in, 0] = [24,2,6,4,10,2,2,0] na Ui24R.
        // Depois, nessa ordem: entrada 6 bytes [entrada, depois do processamento, depois do fader, …], player 6, subgrupo 7,
        // fx 7, aux 5 [antes do master, depois do master, …], master 5 (como a aux), line in 6 (como a entrada).
        // valor: 0 = nada; senão dBFS = valor/3 − 80 (240 = 0 dBFS)
        public sealed class Medidores
        {
            public sbyte[] EntradaBruta = new sbyte[0], Entrada = new sbyte[0], EntradaPre = new sbyte[0], Player = new sbyte[0], Sub = new sbyte[0], Fx = new sbyte[0], Aux = new sbyte[0], Master = new sbyte[0], Line = new sbyte[0], LinePre = new sbyte[0];
            // (0.0.3) 6º byte de entrada/player/line in: bit 7 = gate fechado; (bits 0–6)<<1 = nível depois do compressor
            // na mesma escala (240 = sem redução) → redução em dB = (240 − x)/3, como o app da mesa (deconvertVU_comp)
            public int[] DinEntrada = new int[0], DinPlayer = new int[0], DinLine = new int[0];
            public DateTime Em;
        }
        public Medidores Vu { get; private set; } = new Medidores();

        // ---------- (0.0.9) RTA (analisador): "RTA^base64", ~30 por segundo, 122 bytes = faixas de 20,6 Hz a 22,35 kHz em
        // escala log; valor × 0,0041675 = altura 0–1 (app da mesa: parseRTAdata/drawRTA). É do canal em "var.rta" (ex.: "a.9",
        // "m", "i.0"), UM só para a mesa inteira: trocar muda também o RTA do app da mesa nos outros aparelhos.
        public string Rta { get; private set; } = "";
        public DateTime RtaEm { get; private set; } = DateTime.MinValue;
        static sbyte Db(byte v) => v == 0 ? (sbyte)-128 : (sbyte)Math.Max(-127, Math.Round(v / 3.0 - 80));
        void LerVu(string b64)
        {
            try
            {
                var b = Convert.FromBase64String(b64.Trim());
                if (b.Length < 8) return;
                int nIn = b[0], nPl = b[1], nSg = b[2], nFx = b[3], nAux = b[4], nMa = b[5], nLi = b[6];
                int o = 8;
                sbyte[] Bloco(int n, int tam, int byteIdx) { var r = new sbyte[n]; for (int i = 0; i < n; i++) { int k = o + i * tam + byteIdx; r[i] = k < b.Length ? Db(b[k]) : (sbyte)-128; } return r; }
                var m = new Medidores { Em = DateTime.Now };
                int[] Din(int n) { var r = new int[n]; for (int i = 0; i < n; i++) { int k = o + i * 6 + 5; r[i] = k < b.Length ? b[k] : 127; } return r; }
                // (0.0.11) byte 0 = o que chega depois do pré-amp, antes de tudo
                // (0.0.14) o comentário acima estava na mesma linha e "comia" o DinEntrada e o avanço do o: gate/compressor das
                // entradas vinham vazios e players, subgrupos, FX, aux, master e line liam o bloco das entradas
                m.EntradaBruta = Bloco(nIn, 6, 0); m.EntradaPre = Bloco(nIn, 6, 1); m.Entrada = Bloco(nIn, 6, 2);
                m.DinEntrada = Din(nIn); o += nIn * 6;
                m.Player = Bloco(nPl, 6, 2); m.DinPlayer = Din(nPl); o += nPl * 6;
                m.Sub = Bloco(nSg, 7, 1); o += nSg * 7;
                m.Fx = Bloco(nFx, 7, 1); o += nFx * 7;
                m.Aux = Bloco(nAux, 5, 1); o += nAux * 5;
                m.Master = Bloco(nMa, 5, 1); o += nMa * 5;
                m.LinePre = Bloco(nLi, 6, 1); m.Line = Bloco(nLi, 6, 2); m.DinLine = Din(nLi);
                Vu = m;
            }
            catch { }
        }

        public void Dispose() => Desconectar();
    }

    /// <summary>Curva do fader da Ui: a mesma fórmula do app da própria mesa (VtoLIN); 1,0 = +10 dB; 0 dB ≈ 0,7637.</summary>
    public static class FaderUi
    {
        public static double Linear(double a) => 2.676529517952372E-4 * Math.Exp(a * (23.90844819639692 + a * (-26.23877598214595 + (12.195249692570245 - .4878099877028098 * a) * a))) * (a < .055 ? Math.Sin(28.559933214452666 * a) : 1);
        public static double ParaDb(double f)
        {
            if (f < 0.001) return double.NegativeInfinity;
            double l = Linear(f);
            return l < 1e-10 ? double.NegativeInfinity : 20 * Math.Log10(l);
        }
    }
}
