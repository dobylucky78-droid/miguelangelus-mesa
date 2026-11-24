using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace MiguelAngelusMesa
{
    static class Program
    {
        public static readonly string Pasta = AppDomain.CurrentDomain.BaseDirectory;
        // dados deste computador (biblioteca de shows/snapshots, ajustes, registro): fora da pasta do programa
        public static readonly string PastaDados = Environment.GetEnvironmentVariable("MESA_DADOS") is string d && d != "" ? d   // só para testes
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiguelAngelusMesa");
        public static readonly string Versao = typeof(Program).Assembly.GetName().Version.ToString(3);
        public static bool AbertoPeloWindows;   // "--inicio": aberto junto com o Windows (começa minimizado)

        [STAThread]
        static int Main(string[] args)
        {
            AbertoPeloWindows = Array.Exists(args, a => a == "--inicio");
            // um só por computador (cópias de teste, com MESA_DADOS, podem abrir junto)
            // (o GetHashCode do .NET 8 muda a cada execução: o nome usa um resumo fixo da pasta de dados)
            string chave = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(PastaDados.ToLowerInvariant())));
            using var unico = new Mutex(true, "MiguelAngelusMesa_" + chave, out bool primeiro);
            if (!primeiro) return 0;
            Directory.CreateDirectory(PastaDados);
            Registro.Iniciar();
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Registro.Erro("não tratado", e.ExceptionObject as Exception);
            Application.ThreadException += (s, e) => Registro.Erro("tela", e.Exception);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Principal());
            return 0;
        }
    }

    static class Registro
    {
        static readonly object trava = new object();
        static string arquivo;
        public static void Iniciar()
        {
            var pasta = Path.Combine(Program.PastaDados, "registro");
            Directory.CreateDirectory(pasta);
            arquivo = Path.Combine(pasta, DateTime.Now.ToString("yyyy-MM-dd") + ".txt");
            Info("MiguelAngelus Mesa " + Program.Versao + " abriu" + (Program.AbertoPeloWindows ? " (junto com o Windows)" : ""));
        }
        public static void Info(string t)
        {
            try { lock (trava) File.AppendAllText(arquivo, DateTime.Now.ToString("HH:mm:ss.fff ") + t + Environment.NewLine); } catch { }
        }
        public static void Erro(string onde, Exception e) => Info("ERRO (" + onde + "): " + e);
    }
}
