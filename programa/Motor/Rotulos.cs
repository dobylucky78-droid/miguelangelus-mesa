// Nomes em português para as chaves da mesa Ui ("i.3.aux.5.value" → "Entrada 4 · VIOLÃO" / "Envio para a aux 6 · LIVE")
// e valores legíveis (o fader vai de 0 a 1 na mesa; aqui aparece em dB).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace MiguelAngelusMesa.Motor
{
    public static class Rotulos
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        static readonly Regex Chave = new Regex(@"^(?<g>[a-z]+)\.(?<n>\d+)\.(?<r>.+)$|^(?<g>m)\.(?<r>.+)$", RegexOptions.Compiled);

        static string Nome(IReadOnlyDictionary<string, string> est, string k) => est.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v : "";
        static string ComNome(string baseTxt, string nome) => nome == "" ? baseTxt : baseTxt + " · " + nome;

        /// <summary>(grupo, rótulo) de uma chave. O grupo junta tudo de um mesmo canal/saída.</summary>
        public static (string grupo, string rotulo) Nome(string chave, IReadOnlyDictionary<string, string> est)
        {
            var m = Chave.Match(chave);
            if (!m.Success) return ("Outros", chave);
            string g = m.Groups["g"].Value, r = m.Groups["r"].Value;
            int n = m.Groups["n"].Success ? int.Parse(m.Groups["n"].Value) : 0;
            string grupo = g switch
            {
                "i" => ComNome($"Entrada {n + 1}", Nome(est, $"i.{n}.name")),
                "l" => ComNome($"Line in {(n == 0 ? "L" : "R")}", Nome(est, $"l.{n}.name")),
                "p" => ComNome($"Player {(n == 0 ? "L" : "R")}", Nome(est, $"p.{n}.name")),
                "f" => ComNome($"Retorno FX {n + 1}", Nome(est, $"f.{n}.name")),
                "s" => ComNome($"Subgrupo {n + 1}", Nome(est, $"s.{n}.name")),
                "a" => ComNome($"Aux {n + 1}", Nome(est, $"a.{n}.name")),
                "v" => ComNome($"VCA {n + 1}", Nome(est, $"v.{n}.name")),
                "m" => "Master (LR)",
                "hw" => ComNome($"Entrada {n + 1}", Nome(est, $"i.{n}.name")),   // o pré-amp aparece junto do canal
                "usbdaw" => "Saídas USB (gravação)",
                "hwoutaux" or "hwouthp" or "casc" or "mtk" => "Roteamento",
                _ => "Outros"
            };
            return (grupo, g == "hw" ? "Pré-amp — " + Parametro(r, est) : Parametro(r, est));
        }

        static string Parametro(string r, IReadOnlyDictionary<string, string> est)
        {
            var aux = Regex.Match(r, @"^aux\.(\d+)\.(value|mute|pan|post|postproc)$");
            if (aux.Success)
            {
                int a = int.Parse(aux.Groups[1].Value);
                string alvo = ComNome($"aux {a + 1}", Nome(est, $"a.{a}.name"));
                return aux.Groups[2].Value switch { "value" => "Envio para a " + alvo, "mute" => "Envio para a " + alvo + " (mudo)", "pan" => "Pan do envio para a " + alvo, "post" => "Envio para a " + alvo + " depois do fader", _ => "Envio para a " + alvo + " depois do processamento" };
            }
            var fx = Regex.Match(r, @"^fx\.(\d+)\.(value|mute|post)$");
            if (fx.Success) { int f = int.Parse(fx.Groups[1].Value) + 1; return fx.Groups[2].Value switch { "value" => $"Envio para o FX {f}", "mute" => $"Envio para o FX {f} (mudo)", _ => $"Envio para o FX {f} depois do fader" }; }
            var mtx = Regex.Match(r, @"^mtx\.(\d+)\.(value|mute|pan|postproc)$");
            if (mtx.Success)
            {
                int a = int.Parse(mtx.Groups[1].Value);
                string alvo = ComNome($"matriz {a + 1}", Nome(est, $"a.{a}.name"));
                return mtx.Groups[2].Value switch { "value" => "Envio para a " + alvo, "mute" => "Envio para a " + alvo + " (mudo)", "pan" => "Pan para a " + alvo, _ => "Envio para a " + alvo + " depois do processamento" };
            }
            var eq = Regex.Match(r, @"^eq\.b(\d)\.(freq|gain|q)$");
            if (eq.Success) return $"EQ banda {eq.Groups[1].Value} — " + eq.Groups[2].Value switch { "freq" => "frequência", "gain" => "ganho", _ => "largura (Q)" };
            var geq = Regex.Match(r, @"^eq\.peak\.(?:(l|r)\.)?(\d+)$");
            if (geq.Success) return $"EQ gráfico banda {int.Parse(geq.Groups[2].Value) + 1}" + (geq.Groups[1].Success ? $" ({geq.Groups[1].Value.ToUpper()})" : "");
            if (r.StartsWith("dyn.")) return "Compressor — " + Dyn(r.Substring(4));
            if (r.StartsWith("gate.")) return "Gate — " + Dyn(r.Substring(5));
            if (r.StartsWith("deesser.")) return "De-esser — " + Dyn(r.Substring(8));
            if (r.StartsWith("digitech.")) return "Simulador de amplificador — " + r.Substring(9);
            var par = Regex.Match(r, @"^par(\d)$");
            if (par.Success) return "Efeito — parâmetro " + par.Groups[1].Value;
            return r switch
            {
                "mix" => "Volume (fader)", "mute" => "Mudo", "solo" => "Solo", "pan" => "Pan", "name" => "Nome", "color" => "Cor",
                "gain" => "Ganho", "phantom" => "Phantom 48 V", "hiz" => "Hi-Z (instrumento)", "invert" => "Inverter fase", "delay" => "Atraso",
                "delayL" => "Atraso L", "delayR" => "Atraso R", "src" => "Fonte da entrada", "vca" => "VCA", "subgroup" => "Subgrupo",
                "eq.hpf.freq" => "Passa-altas — frequência", "eq.hpf.slope" => "Passa-altas — inclinação", "eq.lpf.freq" => "Passa-baixas — frequência",
                "eq.lpf.slope" => "Passa-baixas — inclinação", "eq.bypass" => "EQ desligada", "eq.easy" => "EQ fácil", "eq.hpf" => "Passa-altas",
                "eq.lpf" => "Passa-baixas", "matrix" => "É matriz", "fxtype" => "Tipo de efeito", "bpm" => "Andamento (BPM)", "amix" => "Automix",
                "amixgroup" => "Grupo do automix", "instrument" => "Instrumento", "stereoIndex" => "Par estéreo", "forceunmute" => "Forçar som",
                "disablegain" => "Ganho travado", "link2master" => "Ligada ao master", "dim" => "Dim", "ducker" => "Ducker",
                _ => r
            };
        }

        static string Dyn(string p) => p switch
        {
            "threshold" or "thresh" => "limiar", "ratio" => "razão", "attack" => "ataque", "release" => "soltura", "gain" => "ganho",
            "outgain" => "ganho de saída", "bypass" => "desligado", "enabled" => "ligado", "depth" => "profundidade", "hold" => "retenção",
            "softknee" => "joelho suave", "freq" => "frequência", "prname" => "preset", "prmod" => "preset modificado", "autogain" => "ganho automático",
            _ => p
        };

        /// <summary>valor legível: volumes em dB, liga/desliga em Sim/Não, o resto com 2 casas</summary>
        public static string Valor(string chave, string v)
        {
            if (v == null) return "—";
            if (!double.TryParse(v, NumberStyles.Float, Inv, out var x)) return v == "" ? "(vazio)" : v;
            if (chave.EndsWith(".mix") || chave == "m.mix" || Regex.IsMatch(chave, @"\.(aux|fx|mtx)\.\d+\.value$"))
            {
                double db = FaderUi.ParaDb(x);
                return double.IsNegativeInfinity(db) ? "−∞ dB" : (db > 0 ? "+" : "") + db.ToString("0.0", CultureInfo.GetCultureInfo("pt-BR")).Replace("-", "−") + " dB";
            }
            if (Regex.IsMatch(chave, @"\.(mute|solo|phantom|hiz|invert|bypass|enabled|matrix|post|postproc|easy|amix|forceunmute|disablegain|link2master|dim)$"))
                return x >= 0.5 ? "Sim" : "Não";
            return x.ToString("0.###", CultureInfo.GetCultureInfo("pt-BR"));
        }

        /// <summary>canal marcado como "safe" na mesa: um snapshot não mexe nele (a mesa faz igual)</summary>
        public static bool Protegido(string chave, IReadOnlyDictionary<string, string> est)
        {
            var m = Regex.Match(chave, @"^([a-z]+)\.(\d+)\.");
            string k = m.Success ? $"{m.Groups[1].Value}.{m.Groups[2].Value}.safe" : chave.StartsWith("m.") ? "m.safe" : null;
            if (m.Success && m.Groups[1].Value == "hw") k = $"i.{m.Groups[2].Value}.safe";
            return k != null && est.TryGetValue(k, out var s) && s == "1";
        }

        /// <summary>ordem na tela: master, aux, entradas, … (cada grupo pelo número)</summary>
        public static string Ordem(string chave)
        {
            var m = Regex.Match(chave, @"^([a-z]+)\.(\d+)");
            string g = m.Success ? m.Groups[1].Value : chave.Split('.')[0];
            int n = m.Success ? int.Parse(m.Groups[2].Value) : 0;
            string p = g switch { "m" => "0", "a" => "1", "i" => "2", "hw" => "2", "l" => "3", "p" => "4", "f" => "5", "s" => "6", "v" => "7", _ => "9" };
            int gi = g == "hw" ? n : n;   // pré-amp junto da entrada do mesmo número
            return p + gi.ToString("000") + (g == "hw" ? "b" : "a");
        }
    }
}
