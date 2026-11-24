// Biblioteca: shows, snapshots e presets guardados NO COMPUTADOR, para não depender da memória da mesa
// (a mesa da igreja já perdeu as gravações duas vezes por defeito).
//
// Os arquivos ficam no MESMO formato da mesa (o que ela grava no pendrive em Exports\): dá para devolvê-los à mesa
// pelo pendrive (Importar show, no app da mesa) ou pelo programa, parâmetro por parâmetro, em tempo real.
//   .uisnapshot  texto: linhas "#" de comentário e depois "chave=valor" (as mesmas chaves do SETD/SETS da rede)
//   .uishow      texto, mesmo formato: o que vale para o show inteiro (safes, mute groups, grupos de visualização)
//   .uipreset    JSON (presets de canal: EQ, dinâmica…)
// O que a mesa NÃO guarda nos snapshots (anti-microfonia AFS, ajustes gerais) vai para global\ com data e hora.
//
// Pastas (em PastaDados\biblioteca):
//   shows\<show>\*.uisnapshot, .uishow, info.json (de onde veio cada um e quando)
//   presets\<tipo>\*.uipreset
//   global\aaaa-mm-dd_hhmmss.json
//   historico\aaaa-mm-dd_hhmmss\...  (a versão anterior, sempre que um arquivo é substituído por outro diferente)
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace MiguelAngelusMesa.Motor
{
    public sealed class Biblioteca
    {
        public static string Raiz => Path.Combine(Program.PastaDados, "biblioteca");
        static string PastaShows => Path.Combine(Raiz, "shows");
        static string PastaPresets => Path.Combine(Raiz, "presets");
        static string PastaGlobal => Path.Combine(Raiz, "global");
        static string PastaHistorico => Path.Combine(Raiz, "historico");
        static readonly UTF8Encoding Utf8SemBom = new UTF8Encoding(false);

        public sealed class Info { public string Origem { get; set; } = ""; public DateTime Quando { get; set; } }

        // ---------- nomes: a mesa grava "MISSA 7%3A00 - SOL.uisnapshot" (o nome com %XX) ----------
        public static string NomeDoArquivo(string nome) => Uri.EscapeDataString(nome).Replace("%20", " ");
        public static string NomeLegivel(string arquivo)
        {
            var n = Path.GetFileNameWithoutExtension(arquivo);
            try { return Uri.UnescapeDataString(n); } catch { return n; }
        }

        // ---------- leitura ----------
        public static Dictionary<string, string> LerArquivo(string caminho)
        {
            var d = new Dictionary<string, string>();
            foreach (var linha in File.ReadAllLines(caminho, Encoding.UTF8))
            {
                if (linha.Length == 0 || linha[0] == '#') continue;
                int i = linha.IndexOf('=');
                if (i <= 0) continue;
                d[linha.Substring(0, i)] = linha.Substring(i + 1);
            }
            return d;
        }

        // acha pelo nome legível (o jeito de escrever os %XX pode variar entre a mesa e o programa)
        static string DirShow(string show)
        {
            if (!Directory.Exists(PastaShows)) return null;
            return Directory.GetDirectories(PastaShows).FirstOrDefault(d => NomeLegivel(d + ".x") == show);
        }
        static string ArqSnapshot(string show, string snapshot)
        {
            var d = DirShow(show);
            return d == null ? null : Directory.GetFiles(d, "*.uisnapshot").FirstOrDefault(f => NomeLegivel(f) == snapshot);
        }

        public Dictionary<string, string> LerSnapshot(string show, string snapshot)
        {
            var f = ArqSnapshot(show, snapshot) ?? throw new FileNotFoundException($"O snapshot \"{snapshot}\" do show \"{show}\" não está na biblioteca.");
            return LerArquivo(f);
        }

        public bool TemSnapshot(string show, string snapshot) => ArqSnapshot(show, snapshot) != null;

        /// <summary>Tudo o que está guardado, para a tela.</summary>
        public object Listar()
        {
            var shows = new List<object>();
            if (Directory.Exists(PastaShows))
                foreach (var dir in Directory.GetDirectories(PastaShows).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                {
                    var info = LerInfo(dir);
                    var snaps = Directory.GetFiles(dir, "*.uisnapshot").Select(f =>
                    {
                        var nome = NomeLegivel(f);
                        info.TryGetValue(Path.GetFileName(f), out var i);
                        return new { nome, origem = i?.Origem ?? "", quando = (i?.Quando ?? File.GetLastWriteTime(f)).ToString("dd/MM/yyyy HH:mm"), tamanho = new FileInfo(f).Length };
                    }).OrderBy(s => s.nome, StringComparer.OrdinalIgnoreCase).ToList();
                    var cues = Directory.GetFiles(dir, "*.uicue").Select(NomeLegivel).OrderBy(x => x).ToList();
                    shows.Add(new { nome = NomeLegivel(dir + ".x"), snapshots = snaps, cues, temShow = File.Exists(Path.Combine(dir, ".uishow")) });
                }
            var presets = new List<object>();
            if (Directory.Exists(PastaPresets))
                foreach (var dir in Directory.GetDirectories(PastaPresets))
                    presets.Add(new { tipo = Path.GetFileName(dir), nomes = Directory.GetFiles(dir, "*.uipreset").Select(NomeLegivel).OrderBy(x => x).ToList() });
            var globais = Directory.Exists(PastaGlobal) ? Directory.GetFiles(PastaGlobal, "*.json").OrderByDescending(x => x).ToList() : new List<string>();
            var presetsMesa = new List<object>();
            if (Directory.Exists(PastaPresetsMesa))
                foreach (var dir in Directory.GetDirectories(PastaPresetsMesa))
                    presetsMesa.Add(new { tipo = Path.GetFileName(dir), nomes = Directory.GetFiles(dir, "*.json").Select(NomeLegivel).OrderBy(x => x).ToList() });
            return new { shows, presets, presetsMesa, global = globais.Count == 0 ? null : Path.GetFileNameWithoutExtension(globais[0]), pasta = Raiz };
        }

        static Dictionary<string, Info> LerInfo(string dirShow)
        {
            try { var f = Path.Combine(dirShow, "info.json"); if (File.Exists(f)) return JsonSerializer.Deserialize<Dictionary<string, Info>>(File.ReadAllText(f)) ?? new(); } catch { }
            return new Dictionary<string, Info>();
        }
        static void GravarInfo(string dirShow, Dictionary<string, Info> info)
            => File.WriteAllText(Path.Combine(dirShow, "info.json"), JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true }));

        // ---------- guardar sem perder nada: o anterior vai para o histórico ----------
        string historicoDaVez;
        // ---------- (0.0.3) presets de canal: mesmo formato da mesa (JSON {".eq.b1.gain":0.5,...}) ----------
        static readonly System.Text.RegularExpressions.Regex TipoOk = new(@"^[a-z]{1,12}$");
        static string ArqPreset(string tipo, string nome)
        {
            if (!TipoOk.IsMatch(tipo ?? "")) throw new ArgumentException("Tipo de preset inválido.");
            var dir = Path.Combine(PastaPresets, tipo);
            return Directory.Exists(dir) ? Directory.GetFiles(dir, "*.uipreset").FirstOrDefault(f => NomeLegivel(f) == nome) : null;
        }
        /// <summary>Todos os presets de um tipo com os valores (são pequenos).</summary>
        public static List<object> LerPresets(string tipo)
        {
            var l = new List<object>();
            if (!TipoOk.IsMatch(tipo ?? "")) return l;
            var dir = Path.Combine(PastaPresets, tipo);
            if (!Directory.Exists(dir)) return l;
            foreach (var f in Directory.GetFiles(dir, "*.uipreset").OrderBy(NomeLegivel, StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(f, Encoding.UTF8));
                    var v = new Dictionary<string, string>();
                    foreach (var p in doc.RootElement.EnumerateObject())
                        if (p.Name.StartsWith('.') && p.Value.ValueKind == JsonValueKind.Number) v[p.Name] = p.Value.GetDouble().ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                    l.Add(new { nome = NomeLegivel(f), quando = File.GetLastWriteTime(f).ToString("dd/MM/yyyy HH:mm"), v });
                }
                catch { /* arquivo estragado: fica de fora */ }
            }
            return l;
        }
        public void GuardarPreset(string tipo, string nome, Dictionary<string, double> valores)
        {
            nome = (nome ?? "").Trim();
            if (nome.Length == 0 || nome.Length > 40) throw new ArgumentException("Dê um nome de até 40 letras.");
            if (!TipoOk.IsMatch(tipo ?? "")) throw new ArgumentException("Tipo de preset inválido.");
            var destino = ArqPreset(tipo, nome) ?? Path.Combine(PastaPresets, tipo, NomeDoArquivo(nome) + ".uipreset");
            var json = JsonSerializer.Serialize(valores.Where(kv => kv.Key.StartsWith('.')).ToDictionary(kv => kv.Key, kv => kv.Value));
            historicoDaVez = null;
            Guardar(destino, Utf8SemBom.GetBytes(json));
        }
        public void ApagarPreset(string tipo, string nome)
        {
            var f = ArqPreset(tipo, nome); if (f == null) return;
            var h = Path.Combine(PastaHistorico, DateTime.Now.ToString("yyyy-MM-dd_HHmmss"), Path.GetRelativePath(Raiz, f));
            Directory.CreateDirectory(Path.GetDirectoryName(h));
            File.Move(f, h, true);   // não some: vai para o histórico
        }

        void Guardar(string destino, byte[] conteudo)
        {
            if (File.Exists(destino))
            {
                var antes = File.ReadAllBytes(destino);
                if (antes.AsSpan().SequenceEqual(conteudo)) return;
                historicoDaVez ??= Path.Combine(PastaHistorico, DateTime.Now.ToString("yyyy-MM-dd_HHmmss"));
                var rel = Path.GetRelativePath(Raiz, destino);
                var h = Path.Combine(historicoDaVez, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(h));
                File.Copy(destino, h, true);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destino));
            File.WriteAllBytes(destino, conteudo);
        }

        // ---------- importar do pendrive (pasta Exports que a mesa grava) ----------
        /// <summary>Pendrives (ou pastas) ligados agora que têm um Exports\shows ou Exports\presets da mesa.</summary>
        public static List<string> ProcurarExports()
        {
            var achados = new List<string>();
            foreach (var d in DriveInfo.GetDrives())
            {
                try
                {
                    if (!d.IsReady || d.DriveType != DriveType.Removable) continue;
                    var e = Path.Combine(d.RootDirectory.FullName, "Exports");
                    if (Directory.Exists(Path.Combine(e, "shows")) || Directory.Exists(Path.Combine(e, "presets"))) achados.Add(e);
                }
                catch { }
            }
            return achados;
        }

        public (int novos, int iguais, int trocados, List<string> shows) Importar(string pastaExports)
        {
            if (Path.GetFileName(pastaExports.TrimEnd('\\', '/')).Equals("shows", StringComparison.OrdinalIgnoreCase)) pastaExports = Path.GetDirectoryName(pastaExports.TrimEnd('\\', '/'));
            historicoDaVez = null;
            int novos = 0, iguais = 0, trocados = 0; var shows = new List<string>();
            void Um(string origem, string destino, string dirShow)
            {
                var c = File.ReadAllBytes(origem);
                bool existia = File.Exists(destino);
                bool igual = existia && File.ReadAllBytes(destino).AsSpan().SequenceEqual(c);
                if (igual) { iguais++; return; }
                Guardar(destino, c);
                if (existia) trocados++; else novos++;
                if (dirShow != null && !destino.EndsWith(".uishow"))
                {
                    var info = LerInfo(dirShow);
                    info[Path.GetFileName(destino)] = new Info { Origem = "pendrive", Quando = File.GetLastWriteTime(origem) };
                    GravarInfo(dirShow, info);
                }
            }
            var ps = Path.Combine(pastaExports, "shows");
            if (Directory.Exists(ps))
                foreach (var dir in Directory.GetDirectories(ps))
                {
                    var dest = Path.Combine(PastaShows, Path.GetFileName(dir));
                    Directory.CreateDirectory(dest);
                    shows.Add(NomeLegivel(dir + ".x"));
                    foreach (var f in Directory.GetFiles(dir))
                    {
                        var ext = Path.GetExtension(f).ToLowerInvariant();
                        if (ext is ".uisnapshot" or ".uicue" || Path.GetFileName(f) == ".uishow") Um(f, Path.Combine(dest, Path.GetFileName(f)), dest);
                    }
                }
            var pp = Path.Combine(pastaExports, "presets");
            if (Directory.Exists(pp))
                foreach (var f in Directory.GetFiles(pp, "*.uipreset", SearchOption.AllDirectories))
                    Um(f, Path.Combine(PastaPresets, Path.GetRelativePath(pp, f)), null);
            Registro.Info($"biblioteca: importado de {pastaExports}: {novos} novo(s), {trocados} trocado(s), {iguais} igual(is)");
            return (novos, iguais, trocados, shows);
        }

        // ---------- guardar o que está na mesa agora ----------
        /// <summary>chaves que não entram num snapshot (a mesa também não grava): estado do momento, ajustes gerais, AFS, show</summary>
        public static bool ForaDoSnapshot(string k) =>
            k.StartsWith("var.") || k.StartsWith("settings.") || k.Contains(".afs.") || k.StartsWith("afs") || k.EndsWith(".iosyscmd");
        /// <summary>chaves que o show manda (o .uishow): não contam na comparação do snapshot</summary>
        public static bool DoShow(string k) => k.EndsWith(".safe") || k.EndsWith(".mgmask") || k == "mgmask" || k.StartsWith("vg.") || k.StartsWith("iso.");
        /// <summary>só leitura, nunca se manda para a mesa</summary>
        public static bool SoLeitura(string k) => k is "model" or "firmware" or "flavour" or "schema" or "type";

        public string GuardarDaMesa(MesaUi mesa, string show, string snapshot, string origem = "mesa")
        {
            historicoDaVez = null;
            var est = mesa.Estado();
            var sb = new StringBuilder();
            sb.Append("# \n# Guardado pelo MiguelAngelus Mesa ").Append(Program.Versao).Append(" em ").Append(DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"))
              .Append("\n# direto da mesa (").Append(mesa.Modelo).Append(" ").Append(mesa.Firmware).Append("), show \"").Append(show).Append("\"\n# \n");
            foreach (var kv in est.Where(kv => !ForaDoSnapshot(kv.Key)).OrderBy(kv => kv.Key, StringComparer.Ordinal))
                sb.Append(kv.Key).Append('=').Append(kv.Value).Append('\n');
            var dirShow = DirShow(show) ?? Path.Combine(PastaShows, NomeDoArquivo(show));
            var arq = ArqSnapshot(show, snapshot) ?? Path.Combine(dirShow, NomeDoArquivo(snapshot) + ".uisnapshot");
            Guardar(arq, Utf8SemBom.GetBytes(sb.ToString()));
            var info = LerInfo(dirShow);
            info[Path.GetFileName(arq)] = new Info { Origem = origem, Quando = DateTime.Now };
            GravarInfo(dirShow, info);
            GuardarGlobal(mesa);
            Registro.Info($"biblioteca: guardado da mesa \"{show} / {snapshot}\"");
            return arq;
        }

        // (0.0.4) recriar um show na mesa: copia o show guardado para <pendrive>\Exports\shows\<show>, no mesmo jeito que a
        // própria mesa grava; depois o pendrive vai para a mesa e ela importa (IMPORTSHOW). Só ACRESCENTA a pasta Exports.
        // (0.0.12) trazer e atualizar: "novo" (não estava guardado), "mudou" (estava, e a mesa tem outra versão: a anterior
        // vai para o histórico) ou "igual" (nada a fazer). A comparação é a mesma do "O que mudou desde o guardado?".
        public string GuardarOuAtualizar(MesaUi mesa, string show, string snapshot, string origem)
        {
            if (!TemSnapshot(show, snapshot)) { GuardarDaMesa(mesa, show, snapshot, origem); return "novo"; }
            // chave que a mesa não manda pela rede (ex.: i.N.mtx.*, que só aparece no arquivo exportado) não conta como mudança:
            // assim o arquivo original, mais completo, continua guardado
            if (Comparar(LerSnapshot(show, snapshot), mesa).All(d => d.naMesa == "—")) return "igual";
            GuardarDaMesa(mesa, show, snapshot, origem); return "mudou";
        }

        // (0.0.12) presets do USUÁRIO gravados na memória da mesa (READPRESET), guardados do jeito que vieram (JSON)
        static string PastaPresetsMesa => Path.Combine(Raiz, "presets-da-mesa");
        /// <summary>null = não deu; senão "novo" / "mudou" / "igual"</summary>
        public string GuardarPresetDaMesa(string tipo, string nome, string json)
        {
            if (!TipoOk.IsMatch(tipo ?? "") || string.IsNullOrWhiteSpace(nome)) return null;
            try { using var _ = JsonDocument.Parse(json); } catch { return null; }
            var dir = Path.Combine(PastaPresetsMesa, tipo);
            Directory.CreateDirectory(dir);
            var arq = Path.Combine(dir, NomeDoArquivo(nome) + ".json");
            var bytes = Utf8SemBom.GetBytes(json);
            var r = !File.Exists(arq) ? "novo" : File.ReadAllBytes(arq).AsSpan().SequenceEqual(bytes) ? "igual" : "mudou";
            historicoDaVez = null;
            Guardar(arq, bytes);
            return r;
        }

        public static List<object> PendrivesNoComputador() => DriveInfo.GetDrives()
            .Where(d => { try { return d.DriveType == DriveType.Removable && d.IsReady; } catch { return false; } })
            .Select(d => (object)new { raiz = d.RootDirectory.FullName, nome = string.IsNullOrWhiteSpace(d.VolumeLabel) ? "Pendrive" : d.VolumeLabel, livreMb = d.AvailableFreeSpace / 1048576 }).ToList();
        public int CopiarShowParaPendrive(string show, string raiz)
        {
            var origem = DirShow(show) ?? throw new FileNotFoundException($"O show \"{show}\" não está na biblioteca.");
            var drive = DriveInfo.GetDrives().FirstOrDefault(d => string.Equals(d.RootDirectory.FullName, raiz, StringComparison.OrdinalIgnoreCase));
            if (drive == null || drive.DriveType != DriveType.Removable || !drive.IsReady) throw new IOException("Esse pendrive não está mais ligado.");
            var destino = Path.Combine(raiz, "Exports", "shows", Path.GetFileName(origem));
            Directory.CreateDirectory(destino);
            int n = 0;
            foreach (var f in Directory.GetFiles(origem).Where(f => f.EndsWith(".uisnapshot") || f.EndsWith(".uicue") || f.EndsWith(".uishow")))
            { File.Copy(f, Path.Combine(destino, Path.GetFileName(f)), true); n++; }
            Registro.Info($"biblioteca: show \"{show}\" copiado para o pendrive ({n} arquivos) em {destino}");
            return n;
        }

        // (0.0.4) antes de carregar algo na mesa, o estado do momento vai para um show especial da biblioteca: dá para
        // "desfazer" mandando-o de volta pela própria Biblioteca. Ficam os 30 mais novos; os outros vão para o histórico.
        public const string ShowAntes = "⟲ Antes de carregar";
        public string GuardarAntes(MesaUi mesa, string oQue)
        {
            var nome = DateTime.Now.ToString("yyyy-MM-dd HH'h'mm'm'ss") + " — antes de " + oQue;
            if (nome.Length > 90) nome = nome.Substring(0, 90);
            var arq = GuardarDaMesa(mesa, ShowAntes, nome);
            try
            {
                var dir = Path.GetDirectoryName(arq);
                var velhos = Directory.GetFiles(dir, "*.uisnapshot").OrderByDescending(NomeLegivel, StringComparer.Ordinal).Skip(30).ToList();
                if (velhos.Count > 0)
                {
                    var h = Path.Combine(PastaHistorico, DateTime.Now.ToString("yyyy-MM-dd_HHmmss"), Path.GetRelativePath(Raiz, dir));
                    Directory.CreateDirectory(h);
                    foreach (var f in velhos) File.Move(f, Path.Combine(h, Path.GetFileName(f)), true);
                }
            }
            catch (Exception e) { Registro.Erro("biblioteca: limpar 'antes de carregar'", e); }
            return nome;
        }

        /// <summary>o que a mesa não guarda nos snapshots (AFS, ajustes gerais), com data e hora</summary>
        public void GuardarGlobal(MesaUi mesa)
        {
            var g = mesa.Estado().Where(kv => kv.Key.StartsWith("settings.") || kv.Key.Contains(".afs.") || kv.Key.StartsWith("afs"))
                         .OrderBy(kv => kv.Key, StringComparer.Ordinal).ToDictionary(kv => kv.Key, kv => kv.Value);
            if (g.Count == 0) return;
            Directory.CreateDirectory(PastaGlobal);
            var ultimo = Directory.GetFiles(PastaGlobal, "*.json").OrderByDescending(x => x).FirstOrDefault();
            var json = JsonSerializer.Serialize(new { mesa = mesa.Modelo, firmware = mesa.Firmware, quando = DateTime.Now, valores = g }, new JsonSerializerOptions { WriteIndented = true });
            if (ultimo != null)
            {
                try { var antes = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(ultimo)).GetProperty("valores").Deserialize<Dictionary<string, string>>(); if (antes != null && antes.Count == g.Count && antes.All(kv => g.TryGetValue(kv.Key, out var v) && v == kv.Value)) return; } catch { }
            }
            File.WriteAllText(Path.Combine(PastaGlobal, DateTime.Now.ToString("yyyy-MM-dd_HHmmss") + ".json"), json);
        }

        // ---------- comparar com a mesa ----------
        public sealed class Diferenca { public string chave, grupo, rotulo, noArquivo, naMesa, arquivoBruto; public bool protegido; }

        static bool Igual(string a, string b)
        {
            if (a == b) return true;
            if (double.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && double.TryParse(b, NumberStyles.Float, CultureInfo.InvariantCulture, out var y)) return Math.Abs(x - y) < 1e-6;
            return false;
        }

        /// <summary>o que o snapshot guardado tem de diferente da mesa agora. "protegido" = canal marcado como safe na mesa (não se manda).</summary>
        public static List<Diferenca> Comparar(Dictionary<string, string> snap, MesaUi mesa)
        {
            var est = mesa.Estado();
            // nomes dos canais/aux: os do snapshot guardado (é o que a mesa vai ter depois); o resto, os da mesa
            var nomes = new Dictionary<string, string>(est);
            foreach (var kv in snap) if (kv.Key.EndsWith(".name") || kv.Key.EndsWith(".safe")) nomes[kv.Key] = kv.Value;
            foreach (var kv in est) if (kv.Key.EndsWith(".safe")) nomes[kv.Key] = kv.Value;   // "safe" vale o da mesa agora
            var lista = new List<Diferenca>();
            foreach (var kv in snap)
            {
                if (ForaDoSnapshot(kv.Key) || DoShow(kv.Key) || SoLeitura(kv.Key)) continue;
                est.TryGetValue(kv.Key, out var vivo);
                if (vivo != null && Igual(vivo, kv.Value)) continue;
                if (vivo == null && kv.Value == "") continue;
                var (grupo, rotulo) = Rotulos.Nome(kv.Key, nomes);
                lista.Add(new Diferenca
                {
                    chave = kv.Key, grupo = grupo, rotulo = rotulo, arquivoBruto = kv.Value,
                    noArquivo = Rotulos.Valor(kv.Key, kv.Value), naMesa = vivo == null ? "—" : Rotulos.Valor(kv.Key, vivo),
                    protegido = Rotulos.Protegido(kv.Key, est)
                });
            }
            return lista.OrderBy(d => Rotulos.Ordem(d.chave)).ThenBy(d => d.chave, StringComparer.Ordinal).ToList();
        }
    }
}
