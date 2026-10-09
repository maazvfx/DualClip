using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using DualClip.Services;

namespace DualClip;

internal static class Program
{
    private const string MutexName = @"Local\DualClip_SingleInstance_Mutex";
    private const int HWND_BROADCAST = 0xFFFF;

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern uint RegisterWindowMessage(string lpString);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern IntPtr FindWindow(string? lpClassName, string lpWindowName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int dwProcessId);
    private const int ATTACH_PARENT_PROCESS = -1;

    // Portable mode: hide every sibling file/folder next to the exe (except the
    // exe itself) so an extracted portable folder shows only DualClip.exe.
    // ZIP archives do not preserve file attributes, so this runs on every
    // launch; it is idempotent and best-effort (read-only media is ignored).
    private static void ConcealPortableSiblings()
    {
        try
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var exeName = Path.GetFileName(Environment.ProcessPath) ?? "DualClip.exe";
            foreach (var path in Directory.EnumerateFileSystemEntries(baseDir))
            {
                try
                {
                    if (string.Equals(Path.GetFileName(path), exeName, StringComparison.OrdinalIgnoreCase)) continue;
                    var attrs = File.GetAttributes(path);
                    if ((attrs & FileAttributes.Hidden) == 0)
                    {
                        File.SetAttributes(path, attrs | FileAttributes.Hidden);
                    }
                }
                catch { }
            }
        }
        catch { }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (args != null && args.Length > 0)
        {
            if (args.Any(a => a.Equals("--seed-demo", StringComparison.OrdinalIgnoreCase)))
            {
                AttachConsole(ATTACH_PARENT_PROCESS);
                DemoDataSeeder.SeedDemoData();
                return;
            }
            if (args.Any(a => a.Equals("--purge-demo", StringComparison.OrdinalIgnoreCase)))
            {
                AttachConsole(ATTACH_PARENT_PROCESS);
                DemoDataSeeder.PurgeDemoData();
                return;
            }
            if (args.Any(a => a.Equals("--rollback-demo", StringComparison.OrdinalIgnoreCase)))
            {
                AttachConsole(ATTACH_PARENT_PROCESS);
                DemoDataSeeder.RollbackDemoData();
                return;
            }
        }

        bool hasHandle = false;
        using var mutex = new Mutex(false, MutexName);
        try
        {
            try
            {
                hasHandle = mutex.WaitOne(0, false);
            }
            catch (AbandonedMutexException)
            {
                // Previous instance was terminated unexpectedly; acquire ownership safely
                hasHandle = true;
            }

            if (!hasHandle)
            {
                // Another instance is already running; signal it to show if not launched hidden.
                bool isHidden = args != null && args.Any(a => a.Equals("--hidden", StringComparison.OrdinalIgnoreCase) || a.Equals("-hidden", StringComparison.OrdinalIgnoreCase));
                if (!isHidden)
                {
                    uint msg = RegisterWindowMessage("DualClip_ShowInstance");
                    if (msg != 0)
                    {
                        // 1. Target direct window handle if present
                        IntPtr hwnd = FindWindow(null, "DualClip");
                        if (hwnd != IntPtr.Zero)
                        {
                            PostMessage(hwnd, msg, IntPtr.Zero, IntPtr.Zero);
                        }

                        // 2. Broadcast fallback across top-level windows
                        PostMessage((IntPtr)HWND_BROADCAST, msg, IntPtr.Zero, IntPtr.Zero);
                    }
                }
                return;
            }

            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            ApplicationConfiguration.Initialize();

            // High-Performance Tuning (like Ditto / PowerToys):
            // Elevate process and UI thread priority so hotkey activation and popup rendering
            // never lag or drop frames even under 100% CPU system stress.
            try
            {
                Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.AboveNormal;
                Thread.CurrentThread.Priority = ThreadPriority.AboveNormal;
                GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency;
            }
            catch { }

            if (PathHelper.IsPortableMode)
            {
                ConcealPortableSiblings();
            }
            bool startHidden = args != null && args.Any(a => a.Equals("--hidden", StringComparison.OrdinalIgnoreCase) || a.Equals("-hidden", StringComparison.OrdinalIgnoreCase));
            if (!startHidden)
            {
                var settings = AppSettings.Load();
                startHidden = settings.StartHidden;
            }
            Application.Run(new MainForm(startHidden));
        }
        finally
        {
            if (hasHandle)
            {
                try { mutex.ReleaseMutex(); } catch { }
            }
        }
    }
}
