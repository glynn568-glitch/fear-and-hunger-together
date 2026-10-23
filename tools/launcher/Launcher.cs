// Fear & Hunger Together.exe: the one thing a player double-clicks.
//
// Starts the co-op server with no console window, opens the game in its own
// app window (Edge or Chrome, with a profile of its own), and stops
// everything when that window closes. Registers fhtogether:// links, so a
// friend's link clicked in a chat opens here; if the game is already running
// the link is handed to it and its Together panel offers to join.
//
// Built by tools/build-launcher.js with the C# compiler every Windows has
// (C# 5: no string interpolation, no ?. operator).
//   "Fear & Hunger Together.exe"                    start, or bring the window forward
//   "Fear & Hunger Together.exe" fhtogether://join?link=...   start and offer that link
//   "Fear & Hunger Together.exe" --check <file>     write what it found to <file>, start nothing
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Launcher
{
    const int Port = 8420;
    const string Title = "Fear & Hunger Together";
    static string Root, App, Node, LogFile;

    [STAThread]
    static int Main(string[] args)
    {
        Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        // The zip keeps the mod in app\ beside this exe; a source checkout has it right here.
        App = File.Exists(Path.Combine(Root, "app", "server.js")) ? Path.Combine(Root, "app") : Root;
        try { Directory.CreateDirectory(Path.Combine(App, "data")); }
        catch (Exception)
        {
            // Run from inside the zip, or from a folder Windows protects.
            MessageBox.Show("Fear & Hunger Together can't save anything in this folder.\n\nUnzip it first, somewhere like your Desktop or Documents, and start it from there.", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        LogFile = Path.Combine(App, "data", "launcher.log");

        string link = null, checkOut = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--check" && i + 1 < args.Length) { checkOut = args[++i]; continue; }
            string l = ParseLink(args[i]);
            if (l != null) link = l;
        }
        Node = FindNode();
        string browser = FindBrowser();
        if (checkOut != null)
        {
            File.WriteAllText(checkOut, "app=" + App + "\nnode=" + (Node ?? "") + "\nbrowser=" + (browser ?? "") + "\nlink=" + (link ?? "") + "\nrunning=" + Running() + "\n");
            return 0;
        }
        try { RegisterProtocol(); } catch (Exception e) { Note("could not register fhtogether:// links: " + e.Message); }

        bool first;
        using (var only = new Mutex(true, "Local\\FearAndHungerTogether", out first))
        {
            if (!first)
            {
                // Already running: hand over the link, bring the window forward,
                // or open it again if it is gone (the default browser's tab was closed).
                for (int i = 0; i < 40 && !Running(); i++) Thread.Sleep(500);
                if (link != null) Post("/coop/app/offer", "{\"link\":" + Json(link) + "}");
                if (WindowCount() == 0) OpenWindow(browser);
                else Activate();
                return 0;
            }
            if (Running())
            {
                // A server left behind with no launcher (this one was ended from the
                // Task Manager, say): use it, and stop it when its window closes.
                if (link != null) Post("/coop/app/offer", "{\"link\":" + Json(link) + "}");
                if (WindowCount() > 0) { Activate(); WaitForWindowClosed(Running); }
                else { OpenWindow(browser); if (browser == null) return 0; WaitForWindowClosed(Running); }
                Post("/coop/app/quit", "{}");
                return 0;
            }
            return Run(link, browser);
        }
    }

    static int Run(string link, string browser)
    {
        if (Node == null)
        {
            MessageBox.Show("Node.js is missing from this copy (app\\tools\\node\\node.exe). Download Fear & Hunger Together again.", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Process server = null;
        string said = "";
        for (int attempt = 0; attempt < 3; attempt++)
        {
            server = StartServer();
            if (WaitUp(server, 40000)) break;
            // All of what it said is in the log before it is read.
            if (server.HasExited) server.WaitForExit();
            said = Tail();
            if (server.HasExited && said.Contains("was not found"))
            {
                // Not in Steam or the itch app: asked once, remembered in settings.json.
                // First say what is missing, so someone without the game is not handed a bare folder picker.
                if (attempt == 0 && MessageBox.Show(
                        "Fear & Hunger wasn't found on this PC.\n\n"
                        + "Fear & Hunger Together needs your own copy of the game (Fear & Hunger on Steam or itch.io). It looked in Steam and the itch app.\n\n"
                        + "If the game is installed somewhere else, click OK and pick its folder (the one with Game.exe in it). Otherwise click Cancel, get the game, and start this again.",
                        Title, MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return 1;
                using (var pick = new FolderBrowserDialog())
                {
                    pick.Description = attempt == 0 ? "Where is Fear & Hunger? Pick its folder (the one with Game.exe in it)."
                        : "Fear & Hunger wasn't in that folder. Pick the folder with Game.exe in it.";
                    if (pick.ShowDialog() != DialogResult.OK) return 1;
                    // A trailing backslash (a drive's root) would escape the closing quote.
                    string picked = pick.SelectedPath.EndsWith("\\") ? pick.SelectedPath + "\\" : pick.SelectedPath;
                    RunNode("tools\\find-game.js --set \"" + picked + "\"");
                }
                continue;
            }
            break;
        }
        if (server == null || server.HasExited || !Running())
        {
            if (server != null && !server.HasExited) try { server.Kill(); } catch (Exception) { }
            if (said.Contains("was not found")) said = "Fear & Hunger was not found in the folders you picked.";
            // Port 8420 held by some other program: our server says "already running", but nothing of ours answers.
            else if (said.Contains("already running")) said = "Another program on this PC is using port " + Port + ". Close it, or restart the PC, and try again.";
            // A crash: its error line, and where the rest is for a bug report.
            else
            {
                string error = null;
                try { error = File.ReadAllLines(LogFile).LastOrDefault(l => System.Text.RegularExpressions.Regex.IsMatch(l, @"^\w*Error\b")); } catch (Exception) { }
                if (error != null) said = error + "\n\nThe whole of what it said is in " + LogFile;
            }
            MessageBox.Show("The game could not start.\n\n" + said, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        // Ended with this launcher, however it ends (even from the Task Manager): the server, its tunnel and partners.
        KeepWithMe(server);
        if (link != null) Post("/coop/app/offer", "{\"link\":" + Json(link) + "}");

        if (browser == null)
        {
            // No Edge or Chrome: the default browser, and the server runs until this PC's user ends it.
            OpenWindow(null);
            server.WaitForExit();
            return 0;
        }
        OpenWindow(browser);
        WaitForWindowClosed(() => !server.HasExited);
        if (!server.HasExited)
        {
            Post("/coop/app/quit", "{}");
            if (!server.WaitForExit(6000)) try { server.Kill(); } catch (Exception) { }
        }
        return 0;
    }

    // --- the server -----------------------------------------------------------

    static Process StartServer()
    {
        var info = new ProcessStartInfo(Node, "server.js")
        {
            WorkingDirectory = App, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            // Node writes UTF-8; read in the system's code page (866 on a Russian PC), a Cyrillic folder name in a message is garbage.
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        info.EnvironmentVariables["PORT"] = Port.ToString();
        info.EnvironmentVariables["FH_APP"] = "1";
        File.WriteAllText(LogFile, DateTime.Now + " starting\n");
        var p = new Process { StartInfo = info };
        p.OutputDataReceived += (s, e) => { if (e.Data != null) Note(e.Data); };
        p.ErrorDataReceived += (s, e) => { if (e.Data != null) Note(e.Data); };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        return p;
    }

    static void RunNode(string arguments)
    {
        var info = new ProcessStartInfo(Node, arguments) { WorkingDirectory = App, UseShellExecute = false, CreateNoWindow = true };
        using (var p = Process.Start(info)) p.WaitForExit(20000);
    }

    static bool WaitUp(Process server, int ms)
    {
        var until = DateTime.Now.AddMilliseconds(ms);
        while (DateTime.Now < until)
        {
            if (Running()) return true;
            if (server.HasExited) return false;
            Thread.Sleep(250);
        }
        return false;
    }

    // Is a Fear & Hunger Together server answering on this PC?
    static bool Running()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://localhost:" + Port + "/coop/hello");
            req.Timeout = 1500;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream()))
                return r.ReadToEnd().Contains("\"together\"");
        }
        catch (Exception) { return false; }
    }

    static void Post(string path, string json)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://localhost:" + Port + path);
            req.Method = "POST";
            req.Timeout = 15000;
            req.ContentType = "application/json";
            req.Headers["x-fh-app"] = "1";
            byte[] body = Encoding.UTF8.GetBytes(json);
            using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
            using (req.GetResponse()) { }
        }
        catch (Exception e) { Note("post " + path + ": " + e.Message); }
    }

    // --- the window -------------------------------------------------------------

    static string Profile { get { return Path.Combine(App, "data", "window"); } }

    static void OpenWindow(string browser)
    {
        string url = "http://localhost:" + Port + "/";
        if (browser == null) { Process.Start(url); return; }
        // A new profile is not signed in to the player's Microsoft or Google account:
        // Edge would otherwise sign it in on its own and announce that it is syncing.
        string prefs = Path.Combine(Profile, "Default", "Preferences");
        if (!File.Exists(prefs))
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(prefs));
                File.WriteAllText(prefs, "{\"signin\":{\"allowed\":false,\"allowed_on_next_startup\":false},\"sync\":{\"requested\":false}}");
            }
            catch (Exception e) { Note("could not set up the window profile: " + e.Message); }
        }
        Process.Start(browser, "--app=" + url + " --user-data-dir=\"" + Profile + "\" --window-size=1280,1000"
            + " --no-first-run --no-default-browser-check --disable-features=Translate --autoplay-policy=no-user-gesture-required"
            // No extensions: some are copied into every new profile and open windows of their own,
            // which would also keep this launcher waiting after the game window closed.
            + " --disable-extensions"
            // Nothing of this window is synced to the player's account.
            + " --disable-sync"
            // Covered by another window, or in the background, the game keeps its full pace:
            // a fight it runs goes on for the other players (client/fixes.js keeps a minimised one going).
            + " --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling");
    }

    // The browser may hand the window to a process of its own and exit at once,
    // so the window is followed through its profile folder, not one process.
    static int WindowCount()
    {
        // LIKE's own characters ([ _ %) are escaped in brackets, WQL's (\ ') with a backslash.
        string like = Profile.Replace("[", "[[]").Replace("_", "[_]").Replace("%", "[%]").Replace("\\", "\\\\").Replace("'", "\\'");
        string query = "SELECT ProcessId FROM Win32_Process WHERE CommandLine LIKE '%" + like + "%'";
        try { using (var q = new ManagementObjectSearcher(query)) using (var found = q.Get()) return found.Count; }
        catch (Exception) { return 1; }
    }

    static void WaitForWindowClosed(Func<bool> serverUp)
    {
        Thread.Sleep(3000);
        int gone = 0;
        while (gone < 2)
        {
            if (!serverUp()) return;
            gone = WindowCount() == 0 ? gone + 1 : 0;
            Thread.Sleep(1000);
        }
    }

    // A job object that ends the server, and whatever it started, when this
    // launcher ends: a launcher killed from the Task Manager leaves nothing behind.
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    static IntPtr job; // held open for this launcher's life; Windows closes it when the launcher ends

    static void KeepWithMe(Process p)
    {
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            var limits = new ExtendedLimits();
            limits.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))) || !AssignProcessToJobObject(job, p.Handle))
                Note("could not tie the server to the launcher (" + Marshal.GetLastWin32Error() + ")");
        }
        catch (Exception e) { Note("could not tie the server to the launcher: " + e.Message); }
    }

    static void Activate()
    {
        try { Microsoft.VisualBasic.Interaction.AppActivate("Fear & Hunger"); } catch (Exception) { }
    }

    static string FindBrowser()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var p in new[] {
            Path.Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"), Path.Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
            Path.Combine(pf, "Google\\Chrome\\Application\\chrome.exe"), Path.Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"),
            Path.Combine(local, "Google\\Chrome\\Application\\chrome.exe") })
            if (File.Exists(p)) return p;
        return null;
    }

    static string FindNode()
    {
        string own = Path.Combine(App, "tools\\node\\node.exe");
        if (File.Exists(own)) return own;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { string p = Path.Combine(dir.Trim(), "node.exe"); if (File.Exists(p)) return p; } catch (Exception) { }
        }
        return null;
    }

    // --- links ------------------------------------------------------------------

    // fhtogether://join?link=<the host's link>, or the host's link itself.
    static string ParseLink(string arg)
    {
        if (string.IsNullOrEmpty(arg)) return null;
        if (arg.StartsWith("fhtogether:", StringComparison.OrdinalIgnoreCase))
        {
            int at = arg.IndexOf("link=", StringComparison.OrdinalIgnoreCase);
            if (at < 0) return null;
            arg = Uri.UnescapeDataString(arg.Substring(at + 5).Split('&')[0]);
        }
        return arg.StartsWith("https://") || arg.StartsWith("http://") ? arg : null;
    }

    static void RegisterProtocol()
    {
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        using (var key = Registry.CurrentUser.CreateSubKey("Software\\Classes\\fhtogether"))
        {
            key.SetValue("", "URL:Fear & Hunger Together");
            key.SetValue("URL Protocol", "");
            using (var cmd = key.CreateSubKey("shell\\open\\command")) cmd.SetValue("", "\"" + exe + "\" \"%1\"");
        }
    }

    // --- small things -----------------------------------------------------------

    static string Json(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    static readonly object noteLock = new object();
    static void Note(string line)
    {
        lock (noteLock) { try { File.AppendAllText(LogFile, line + "\n"); } catch (Exception) { } }
    }

    static string Tail()
    {
        try
        {
            // A crash's stack frames and Node's version footer would push its error line off the message.
            string[] lines = File.ReadAllLines(LogFile).Where(l => l.Trim() != "" && l.Trim() != "^"
                && !l.TrimStart().StartsWith("at ") && !l.StartsWith("Node.js v")).ToArray();
            int from = Math.Max(0, lines.Length - 8);
            return string.Join("\n", lines, from, lines.Length - from);
        }
        catch (Exception) { return ""; }
    }
}
