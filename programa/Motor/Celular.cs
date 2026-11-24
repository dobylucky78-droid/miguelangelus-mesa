// (0.0.10) Mesa pelo celular e pelo tablet: um servidor pequeno na rede local, com pareamento próprio (o mesmo modelo
// do Cast 0.1.20). Cada aparelho pareia com um PERFIL escolhido no computador antes de gerar o código:
//   "operador" → faders e mudos do mix principal, das aux (retornos), dos subgrupos, VCA e FX, e os envios para as aux
//   "aux:N"    → só o retorno da aux N (o músico mexe no próprio fone/caixa de retorno): os envios para ela e o volume dela
// Ganho, phantom, EQ, dinâmica, snapshots e shows ficam SÓ no computador.
//  GET  /                       página (web\celular.html)
//  POST /api/parear             {codigo, nome} → {token, perfil}
//  GET  /api/estado?t=&c=       valores da camada c ("lr" ou "a.N") + nomes, cores e medidores
//  POST /api/definir?t=         {v:{chave:valor,…}} → só as chaves que o perfil deixa
// Vem DESLIGADO. Os pareamentos ficam em celular.json (na pasta de dados; fora de qualquer nuvem).
// 5 códigos errados: código novo e 1 minuto sem aceitar pareamento. Cada código serve para um aparelho só.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace MiguelAngelusMesa.Motor
{
    public static class Celular
    {
        public const int PortaPadrao = 8942;   // o Cast usa a 8941
        static string Arquivo => Path.Combine(Program.PastaDados, "celular.json");

        public sealed class Aparelho { public string Token { get; set; } = ""; public string Nome { get; set; } = "Celular"; public string Perfil { get; set; } = "operador"; public long Desde { get; set; } public long Visto { get; set; } }
        sealed class Cfg { public bool Ligado { get; set; } public int Porta { get; set; } = PortaPadrao; public List<Aparelho> Aparelhos { get; set; } = new List<Aparelho>(); }

        static Cfg cfg = new Cfg();
        static readonly object trava = new object();
        static TcpListener ouvinte;
        static int erros;
        static DateTime travadoAte = DateTime.MinValue;

        public static bool Ligado => cfg.Ligado;
        public static int Porta { get; private set; }
        public static string Codigo { get; private set; } = "";
        public static string PerfilDoCodigo { get; private set; } = "operador";
        public static string Erro { get; private set; } = "";
        public static event Action Mudou;

        /// <summary>(aparelho, camada) → objeto do estado; roda fora da tela (só lê o estado da mesa)</summary>
        public static Func<Aparelho, string, object> Estado;
        /// <summary>(aparelho, valores já filtrados pelo perfil) → quantos foram</summary>
        public static Func<Aparelho, Dictionary<string, string>, int> Definir;

        // ---------- (0.0.13) programa completo no tablet do operador ----------
        public sealed class Remota
        {
            public string Id = "", Token = "", Nome = "";
            public readonly System.Collections.Concurrent.ConcurrentQueue<string> Fila = new System.Collections.Concurrent.ConcurrentQueue<string>();
            public readonly SemaphoreSlim Sinal = new SemaphoreSlim(0);
            public string Vu, Rta;            // só o último medidor interessa
            public DateTime Visto = DateTime.UtcNow;
            public volatile bool Mixer;       // o mixer está à vista nesta tela (medidores e valores só então)
            public bool Viva => (DateTime.UtcNow - Visto).TotalSeconds < 40;
        }
        static readonly Dictionary<string, Remota> remotas = new Dictionary<string, Remota>();
        /// <summary>(tela remota, mensagem JSON) → o programa trata como se viesse da própria tela (com as exceções do computador)</summary>
        public static Action<Remota, string> Mensagem;
        static Remota Sessao(Aparelho ap, string id)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 40 || !Regex.IsMatch(id, "^[a-z0-9]+$")) return null;
            lock (remotas)
            {
                foreach (var k in remotas.Where(kv => !kv.Value.Viva).Select(kv => kv.Key).ToList()) remotas.Remove(k);
                if (remotas.TryGetValue(id, out var r)) return r.Token == ap.Token ? r : null;
                if (remotas.Count >= 8) return null;
                r = new Remota { Id = id, Token = ap.Token, Nome = ap.Nome };
                remotas[id] = r;
                return r;
            }
        }
        static Remota[] Vivas()
        {
            lock (remotas)
            {
                if (remotas.Count == 0) return Array.Empty<Remota>();
                lock (trava) return remotas.Values.Where(r => r.Viva && cfg.Aparelhos.Any(a => a.Token == r.Token)).ToArray();
            }
        }
        public static bool HaRemotas { get { lock (remotas) return remotas.Count > 0; } }
        public static bool MixerRemoto => Vivas().Any(r => r.Mixer);
        /// <summary>manda a mesma mensagem que foi para a tela do computador às telas remotas</summary>
        public static void Difundir(string json, bool soMixer = false)
        {
            if (!HaRemotas) return;
            foreach (var r in Vivas()) { if (soMixer && !r.Mixer) continue; Para(r, json); }
        }
        public static void Para(Remota r, string json)
        {
            if (json.StartsWith("{\"tipo\":\"vu\"")) r.Vu = json;
            else if (json.StartsWith("{\"tipo\":\"rta\"")) r.Rta = json;
            else { r.Fila.Enqueue(json); while (r.Fila.Count > 3000 && r.Fila.TryDequeue(out _)) { } }
            if (r.Sinal.CurrentCount == 0) r.Sinal.Release();
        }

        public static bool PerfilOk(string p) => p == "operador" || Regex.IsMatch(p ?? "", @"^aux:\d{1,2}$");

        // o que cada perfil pode mudar
        static readonly Regex Operador = new Regex(@"^(?:[ilpfsav]\.\d{1,2}\.(?:mix|mute)|[ilpfs]\.\d{1,2}\.(?:aux|fx)\.\d{1,2}\.(?:value|mute)|m\.(?:mix|mute))$", RegexOptions.Compiled);
        public static bool Pode(string perfil, string chave)
        {
            if (perfil == "operador") return Operador.IsMatch(chave);
            var m = Regex.Match(perfil ?? "", @"^aux:(\d{1,2})$"); if (!m.Success) return false;
            var n = m.Groups[1].Value;
            return Regex.IsMatch(chave, $@"^(?:[ilpf]\.\d{{1,2}}\.aux\.{n}\.(?:value|mute)|a\.{n}\.mix)$");
        }

        public static void Iniciar()
        {
            try { if (File.Exists(Arquivo)) cfg = JsonSerializer.Deserialize<Cfg>(File.ReadAllText(Arquivo)) ?? new Cfg(); } catch { cfg = new Cfg(); }
            cfg.Aparelhos ??= new List<Aparelho>();
            if (cfg.Ligado) Abrir();
        }
        static void Salvar()
        {
            try { lock (trava) File.WriteAllText(Arquivo, JsonSerializer.Serialize(cfg)); }
            catch (Exception e) { Registro.Erro("celular.json", e); }
        }

        public static void Ligar(bool sim)
        {
            cfg.Ligado = sim; Salvar();
            if (sim) Abrir(); else Fechar();
            Mudou?.Invoke();
        }
        static void Abrir()
        {
            if (ouvinte != null) return;
            Erro = "";
            NovoCodigo(PerfilDoCodigo);
            // testes numa cópia (MESA_CELULAR_LOCAL=1): só no próprio computador, sem o aviso do Firewall
            var ip = Environment.GetEnvironmentVariable("MESA_CELULAR_LOCAL") == "1" ? IPAddress.Loopback : IPAddress.Any;
            for (int p = cfg.Porta; p < cfg.Porta + 10; p++)
            {
                try { ouvinte = new TcpListener(ip, p); ouvinte.Start(); Porta = p; break; }
                catch (SocketException) { ouvinte = null; }
            }
            if (ouvinte == null) { Erro = "porta " + cfg.Porta + " ocupada"; Registro.Info("celular: " + Erro); return; }
            if (cfg.Porta != Porta) { cfg.Porta = Porta; Salvar(); }
            Registro.Info("mesa pelo celular ligada na porta " + Porta);
            var o = ouvinte;
            new Thread(() => Laco(o)) { IsBackground = true, Name = "celular" }.Start();
        }
        static void Fechar()
        {
            try { ouvinte?.Stop(); } catch { }
            ouvinte = null; Porta = 0; Codigo = "";
            Registro.Info("mesa pelo celular desligada");
        }
        public static void Parar() { try { ouvinte?.Stop(); } catch { } }

        static void NovoCodigo(string perfil) { Codigo = RandomNumberGenerator.GetInt32(0, 10000).ToString("0000"); PerfilDoCodigo = PerfilOk(perfil) ? perfil : "operador"; Interlocked.Exchange(ref erros, 0); }
        /// <summary>o operador escolheu no computador para quem é o próximo código</summary>
        public static void CodigoPara(string perfil) { if (ouvinte == null) return; NovoCodigo(perfil); Mudou?.Invoke(); }

        public static List<object> Aparelhos() { lock (trava) return cfg.Aparelhos.Select(a => (object)new { id = a.Token.Substring(0, 8), nome = a.Nome, perfil = a.Perfil, desde = a.Desde, visto = a.Visto }).ToList(); }
        public static void Tirar(string inicio)
        {
            if (string.IsNullOrEmpty(inicio)) return;
            lock (trava) cfg.Aparelhos.RemoveAll(a => a.Token.StartsWith(inicio, StringComparison.Ordinal));
            lock (remotas) foreach (var k in remotas.Where(kv => kv.Value.Token.StartsWith(inicio, StringComparison.Ordinal)).Select(kv => kv.Key).ToList()) { remotas[k].Sinal.Release(); remotas.Remove(k); }
            Salvar(); Mudou?.Invoke();
        }

        public static List<string> Enderecos()
        {
            var l = new List<string>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    var d = ni.Description.ToLowerInvariant();
                    if (d.Contains("virtual") || d.Contains("vmware") || d.Contains("hyper-v") || d.Contains("vpn") || d.Contains("tap-")) continue;
                    foreach (var u in ni.GetIPProperties().UnicastAddresses)
                        if (u.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(u.Address) && !u.Address.ToString().StartsWith("169.254."))
                            l.Add(u.Address.ToString());
                }
            }
            catch { }
            if (Environment.GetEnvironmentVariable("MESA_CELULAR_LOCAL") == "1") return new List<string> { "127.0.0.1" };
            return l.Distinct().OrderBy(a => a.StartsWith("192.168.") ? 0 : a.StartsWith("10.") ? 1 : 2).ToList();
        }

        static void Laco(TcpListener o)
        {
            while (ouvinte == o)
            {
                TcpClient cli;
                try { cli = o.AcceptTcpClient(); } catch { return; }
                _ = Task.Run(() => Atender(cli));
            }
        }

        static void Atender(TcpClient cli)
        {
            using (cli)
            {
                try
                {
                    cli.ReceiveTimeout = 5000; cli.SendTimeout = 5000;
                    var s = cli.GetStream();
                    var (metodo, alvo, corpo) = Ler(s);
                    if (metodo == null) return;
                    int iq = alvo.IndexOf('?');
                    var caminho = Uri.UnescapeDataString(iq < 0 ? alvo : alvo.Substring(0, iq));
                    var q = new Dictionary<string, string>();
                    if (iq >= 0) foreach (var par in alvo.Substring(iq + 1).Split('&')) { int ig = par.IndexOf('='); if (ig > 0) q[par.Substring(0, ig)] = Uri.UnescapeDataString(par.Substring(ig + 1)); }

                    if (metodo == "GET" && (caminho == "/" || caminho == "/index.html"))
                    {
                        var p = Path.Combine(Program.Pasta, "web", "celular.html");
                        Responder(s, 200, "text/html; charset=utf-8", File.Exists(p) ? File.ReadAllBytes(p) : Encoding.UTF8.GetBytes("Página do celular não encontrada."));
                        return;
                    }
                    if (metodo == "GET" && caminho == "/antigo.html")   // (0.0.13) aparelhos antigos (iPad 2 / iOS 9)
                    {
                        var p = Path.Combine(Program.Pasta, "web", "antigo.html");
                        Responder(s, 200, "text/html; charset=utf-8", File.Exists(p) ? File.ReadAllBytes(p) : Encoding.UTF8.GetBytes("-"));
                        return;
                    }
                    if (metodo == "GET" && caminho == "/icone.svg")
                    {
                        var p = Path.Combine(Program.Pasta, "web", "img", "icone.svg");
                        if (File.Exists(p)) Responder(s, 200, "image/svg+xml", File.ReadAllBytes(p)); else Responder(s, 404, "text/plain", Encoding.UTF8.GetBytes("-"));
                        return;
                    }
                    // (0.0.13) o programa completo no tablet do operador: as mesmas telas do computador (web\), sem dados nelas
                    if (metodo == "GET" && caminho.StartsWith("/app/"))
                    {
                        var rel = caminho.Substring(5);
                        var ext = Path.GetExtension(rel).ToLowerInvariant();
                        var tipo = ext switch { ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8", ".css" => "text/css; charset=utf-8", ".svg" => "image/svg+xml", ".png" => "image/png", ".woff2" => "font/woff2", _ => null };
                        var raiz = Path.GetFullPath(Path.Combine(Program.Pasta, "web")) + Path.DirectorySeparatorChar;
                        var p = rel.Contains("..") || rel.Contains(':') || tipo == null ? null : Path.GetFullPath(Path.Combine(raiz, rel.Replace('/', Path.DirectorySeparatorChar)));
                        if (p == null || !p.StartsWith(raiz, StringComparison.OrdinalIgnoreCase) || !File.Exists(p) || Path.GetFileName(p).Equals("celular.html", StringComparison.OrdinalIgnoreCase))
                        { Responder(s, 404, "text/plain", Encoding.UTF8.GetBytes("-")); return; }
                        Responder(s, 200, tipo, File.ReadAllBytes(p));
                        return;
                    }
                    if (metodo == "GET" && caminho == "/manifest.webmanifest") { Responder(s, 200, "application/manifest+json", Encoding.UTF8.GetBytes(Manifesto)); return; }
                    if (caminho == "/api/parear" && metodo == "POST")
                    {
                        if (DateTime.UtcNow < travadoAte || Codigo == "") { Json(s, 429, new { ok = false, motivo = "espera" }); return; }
                        string cod = "", nome = "";
                        try { using var d = JsonDocument.Parse(corpo); cod = Str(d.RootElement, "codigo").Trim(); nome = Str(d.RootElement, "nome").Trim(); } catch { }
                        if (cod.Length != 4 || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(cod), Encoding.ASCII.GetBytes(Codigo)))
                        {
                            if (Interlocked.Increment(ref erros) >= 5) { NovoCodigo(PerfilDoCodigo); travadoAte = DateTime.UtcNow.AddMinutes(1); Mudou?.Invoke(); }
                            Json(s, 403, new { ok = false }); return;
                        }
                        if (nome.Length > 40) nome = nome.Substring(0, 40);
                        var novo = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
                        var agora = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        var perfil = PerfilDoCodigo;
                        lock (trava) cfg.Aparelhos.Add(new Aparelho { Token = novo, Nome = nome == "" ? "Celular" : nome, Perfil = perfil, Desde = agora, Visto = agora });
                        Salvar();
                        NovoCodigo("operador");   // cada código serve para um aparelho só; o próximo volta a ser de operador
                        Registro.Info($"celular pareado: {(nome == "" ? "Celular" : nome)} ({perfil})");
                        Mudou?.Invoke();
                        Json(s, 200, new { ok = true, token = novo, perfil });
                        return;
                    }
                    Aparelho ap = null;
                    if (q.TryGetValue("t", out var token) && token.Length > 10) lock (trava) ap = cfg.Aparelhos.FirstOrDefault(a => a.Token == token);
                    if (caminho.StartsWith("/api/") && ap == null) { Json(s, 401, new { ok = false, motivo = "pareamento" }); return; }
                    if (ap != null)
                    {
                        var antes = ap.Visto; ap.Visto = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        if (ap.Visto - antes > 60000) Mudou?.Invoke();
                    }
                    if (caminho == "/api/estado" && metodo == "GET")
                    {
                        var cam = q.TryGetValue("c", out var c) ? c : "lr";
                        Json(s, 200, new { ok = true, nome = ap.Nome, perfil = ap.Perfil, mesa = Estado?.Invoke(ap, cam) });
                        return;
                    }
                    // (0.0.13) programa completo (só operador): mensagens da tela → programa, e programa → tela (long-poll)
                    if ((caminho == "/api/msg" || caminho == "/api/ev") && ap.Perfil != "operador") { Json(s, 403, new { ok = false }); return; }
                    if (caminho == "/api/msg" && metodo == "POST")
                    {
                        var se = Sessao(ap, q.TryGetValue("s", out var sid) ? sid : "");
                        if (se == null) { Json(s, 400, new { ok = false }); return; }
                        try
                        {
                            using var d = JsonDocument.Parse(corpo);
                            var lista = d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.EnumerateArray().ToList() : new List<JsonElement> { d.RootElement };
                            foreach (var x in lista) if (x.ValueKind == JsonValueKind.Object) Mensagem?.Invoke(se, x.GetRawText());
                        }
                        catch { Json(s, 400, new { ok = false }); return; }
                        Json(s, 200, new { ok = true });
                        return;
                    }
                    if (caminho == "/api/ev" && metodo == "GET")
                    {
                        var se = Sessao(ap, q.TryGetValue("s", out var sid) ? sid : "");
                        if (se == null) { Json(s, 400, new { ok = false }); return; }
                        se.Visto = DateTime.UtcNow;
                        if (se.Fila.IsEmpty && se.Vu == null) se.Sinal.Wait(15000);
                        Thread.Sleep(30);   // junta o que chega quase junto
                        var sb = new StringBuilder("["); int n = 0;
                        while (n < 400 && se.Fila.TryDequeue(out var j)) { if (n++ > 0) sb.Append(','); sb.Append(j); }
                        var vu = Interlocked.Exchange(ref se.Vu, null); if (vu != null) { if (n++ > 0) sb.Append(','); sb.Append(vu); }
                        var rta = Interlocked.Exchange(ref se.Rta, null); if (rta != null) { if (n++ > 0) sb.Append(','); sb.Append(rta); }
                        sb.Append(']');
                        while (se.Sinal.CurrentCount > 0 && se.Fila.IsEmpty && se.Vu == null) se.Sinal.Wait(0);
                        se.Visto = DateTime.UtcNow;
                        Responder(s, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(sb.ToString()));
                        return;
                    }
                    if (caminho == "/api/definir" && metodo == "POST")
                    {
                        var ok = new Dictionary<string, string>(); int negados = 0;
                        try
                        {
                            using var d = JsonDocument.Parse(corpo);
                            if (d.RootElement.TryGetProperty("v", out var v) && v.ValueKind == JsonValueKind.Object)
                                foreach (var p in v.EnumerateObject())
                                {
                                    if (p.Value.ValueKind != JsonValueKind.String || !double.TryParse(p.Value.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var x) || x < 0 || x > 1) { negados++; continue; }
                                    if (Pode(ap.Perfil, p.Name)) ok[p.Name] = p.Value.GetString(); else negados++;
                                }
                        }
                        catch { Json(s, 400, new { ok = false }); return; }
                        int n = ok.Count > 0 ? (Definir?.Invoke(ap, ok) ?? 0) : 0;
                        Json(s, 200, new { ok = n > 0 || ok.Count == 0, feitos = n, negados });
                        return;
                    }
                    Responder(s, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("-"));
                }
                catch (IOException) { }
                catch (SocketException) { }
                catch (Exception e) { Registro.Erro("celular", e); }
            }
        }

        const string Manifesto = "{\"name\":\"MiguelAngelus Mesa\",\"short_name\":\"Mesa\",\"start_url\":\"/\",\"display\":\"standalone\"," +
            "\"background_color\":\"#0f1420\",\"theme_color\":\"#0f1420\",\"icons\":[{\"src\":\"/icone.svg\",\"sizes\":\"any\",\"type\":\"image/svg+xml\"}]}";

        static string Str(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

        static (string, string, string) Ler(Stream s)
        {
            var buf = new byte[16384]; int n = 0, fim = -1;
            while (fim < 0)
            {
                if (n == buf.Length) return (null, null, null);
                int r = s.Read(buf, n, buf.Length - n); if (r <= 0) return (null, null, null);
                n += r;
                for (int i = Math.Max(0, n - r - 3); i + 3 < n; i++) if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) { fim = i; break; }
            }
            var linhas = Encoding.ASCII.GetString(buf, 0, fim).Split("\r\n");
            var partes = linhas[0].Split(' ');
            if (partes.Length < 2) return (null, null, null);
            int tam = 0;
            foreach (var l in linhas.Skip(1))
                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l.Substring(15).Trim(), out tam);
            if (tam < 0 || tam > 16384) return (null, null, null);
            var corpo = new byte[tam];
            int ja = Math.Min(tam, n - fim - 4);
            Array.Copy(buf, fim + 4, corpo, 0, ja);
            while (ja < tam) { int r = s.Read(corpo, ja, tam - ja); if (r <= 0) break; ja += r; }
            return (partes[0], partes[1], Encoding.UTF8.GetString(corpo, 0, ja));
        }

        static void Json(Stream s, int cod, object o) => Responder(s, cod, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o)));
        static void Responder(Stream s, int cod, string tipo, byte[] b)
        {
            var txt = cod == 200 ? "OK" : cod == 400 ? "Bad Request" : cod == 401 ? "Unauthorized" : cod == 403 ? "Forbidden" : cod == 404 ? "Not Found" : cod == 429 ? "Too Many Requests" : "Error";
            var h = $"HTTP/1.1 {cod} {txt}\r\nContent-Type: {tipo}\r\nContent-Length: {b.Length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
            s.Write(Encoding.ASCII.GetBytes(h)); s.Write(b); s.Flush();
        }
    }
}
