using System;
using System.IO;

namespace DualClip.Services;

/// <summary>
/// Lightweight diagnostic logger for pinpoint performance and lifecycle debugging.
/// Features a master switch (Enabled) and writes to debug.log in the DualClip data directory.
/// </summary>
public static class DebugLogger
{
    // Master switch: Set to false to disable all debug logging instantly
    public static bool Enabled { get; set; } = true;

    private static readonly object _lock = new();
    private static string? _logFilePath;

    public static string LogFilePath
    {
        get
        {
            if (_logFilePath == null)
            {
                try
                {
                    string folder = PathHelper.GetRootFolder();
                    _logFilePath = Path.Combine(folder, "debug.log");
                }
                catch
                {
                    _logFilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "debug.log");
                }
            }
            return _logFilePath;
        }
    }

    public static void Log(string tag, string message)
    {
        if (!Enabled) return;

        try
        {
            string line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [{tag}] {message}{Environment.NewLine}";
            lock (_lock)
            {
                File.AppendAllText(LogFilePath, line);
            }
        }
        catch
        {
            // Fail silently to never disrupt application execution
        }
    }

    public static void Clear()
    {
        try
        {
            lock (_lock)
            {
                if (File.Exists(LogFilePath))
                {
                    File.Delete(LogFilePath);
                }
            }
        }
        catch { }
    }
}
