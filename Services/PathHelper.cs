using System;
using System.IO;

namespace DualClip.Services;

public static class PathHelper
{
    private static bool? _isPortable;

    public static bool IsPortableMode
    {
        get
        {
            if (!_isPortable.HasValue)
            {
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                _isPortable = File.Exists(Path.Combine(baseDir, "portable.dat"));
            }
            return _isPortable.Value;
        }
    }

    public static string GetRootFolder()
    {
        if (IsPortableMode)
        {
            var dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "portable_data");
            Directory.CreateDirectory(dir);
            return dir;
        }
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var standardDir = Path.Combine(appdata, "DualClip");
        Directory.CreateDirectory(standardDir);
        return standardDir;
    }

    public static string GetDatabasePath()
    {
        if (IsPortableMode)
        {
            var dir = Path.Combine(GetRootFolder(), "data");
            Directory.CreateDirectory(dir);
            var targetDb = Path.Combine(dir, "clips.db");
            var expDb = Path.Combine(dir, "clips_experiment.db");
            if (!File.Exists(targetDb) && File.Exists(expDb))
            {
                try { File.Copy(expDb, targetDb, true); } catch { }
            }
            return targetDb;
        }

        var customPath = Environment.GetEnvironmentVariable("DUALCLIP_DB_PATH");
        if (!string.IsNullOrWhiteSpace(customPath))
        {
            var customDir = Path.GetDirectoryName(customPath);
            if (!string.IsNullOrWhiteSpace(customDir)) Directory.CreateDirectory(customDir);
            return customPath;
        }

        var localAppdata = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var standardDir = Path.Combine(localAppdata, "DualClip", "data");
        Directory.CreateDirectory(standardDir);
        var standardTarget = Path.Combine(standardDir, "clips.db");
        var standardExp = Path.Combine(standardDir, "clips_experiment.db");
        if (!File.Exists(standardTarget) && File.Exists(standardExp))
        {
            try { File.Copy(standardExp, standardTarget, true); } catch { }
        }
        return standardTarget;
    }

    public static string GetSettingsPath()
    {
        return Path.Combine(GetRootFolder(), "settings.json");
    }

    public static string GetImagesFolder()
    {
        var dir = Path.Combine(GetRootFolder(), "images");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static string GetWebView2UserDataFolder()
    {
        if (IsPortableMode)
        {
            var dir = Path.Combine(GetRootFolder(), "webview2_profile");
            Directory.CreateDirectory(dir);
            return dir;
        }
        var localAppdata = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var standardDir = Path.Combine(localAppdata, "DualClip", "webview2_profile");
        Directory.CreateDirectory(standardDir);
        return standardDir;
    }

    public static string GetDragTempFolder()
    {
        if (IsPortableMode)
        {
            var dir = Path.Combine(GetRootFolder(), "temp_drag");
            Directory.CreateDirectory(dir);
            return dir;
        }
        var standardDir = Path.Combine(Path.GetTempPath(), "DualClip", "drag");
        Directory.CreateDirectory(standardDir);
        return standardDir;
    }

    public static string GetIconCacheFolder()
    {
        if (IsPortableMode)
        {
            var dir = Path.Combine(GetRootFolder(), "icon_cache");
            Directory.CreateDirectory(dir);
            return dir;
        }
        var localAppdata = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var standardDir = Path.Combine(localAppdata, "DualClip", "icon_cache");
        Directory.CreateDirectory(standardDir);
        return standardDir;
    }

    public static string GetTempFolder()
    {
        var dir = Path.Combine(GetRootFolder(), "temp");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static void CleanupTempFolders()
    {
        try
        {
            var tempDir = Path.Combine(GetRootFolder(), "temp");
            if (Directory.Exists(tempDir))
            {
                foreach (var dir in Directory.GetDirectories(tempDir, "import_*"))
                {
                    try { Directory.Delete(dir, true); } catch { }
                }
            }
        }
        catch { }
    }
}
