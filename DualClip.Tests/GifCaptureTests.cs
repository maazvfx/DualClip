using System;
using System.IO;
using System.Text;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class GifCaptureTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void IsGifHeader_DetectsValidGifHeaders()
    {
        byte[] gif89a = Encoding.ASCII.GetBytes("GIF89a...");
        Assert.True(ClipboardListener.IsGifHeader(gif89a));

        byte[] gif87a = Encoding.ASCII.GetBytes("GIF87a...");
        Assert.True(ClipboardListener.IsGifHeader(gif87a));

        byte[] pngHeader = new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A };
        Assert.False(ClipboardListener.IsGifHeader(pngHeader));

        Assert.False(ClipboardListener.IsGifHeader(null));
        Assert.False(ClipboardListener.IsGifHeader(new byte[] { 1, 2 }));
    }

    [Fact]
    public void DatabaseService_AddOrBumpImage_StoresGifMetadata()
    {
        using var db = new TestDb();
        string hash = "A1B2C3D4E5F60123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123";
        string path = @"C:\Users\test\AppData\Roaming\DualClip\images\" + hash + ".gif";
        string thumb = "data:image/jpeg;base64,samplethumbnaildata";
        string dims = "320 × 240";
        string size = "150 KB GIF";

        var (id, isNew) = db.Service.AddOrBumpImage(hash, path, thumb, dims, size, "manual", "browser.exe", "Web Page", "all");
        Assert.True(isNew);
        Assert.True(id > 0);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.True(clip!.IsImage);
        Assert.Equal(path, clip.ImagePath);
        Assert.Equal(thumb, clip.ThumbnailData);
        Assert.Equal(dims, clip.ImgDims);
        Assert.Equal(size, clip.ImgSize);
    }

    /// <summary>
    /// The Animated GIF preference was retired by design: list rows always render the static
    /// first frame for cheap virtualized scrolling, while the side preview panel and the
    /// fullscreen lightbox play the animation when a clip is actually inspected.
    /// </summary>
    [Fact]
    [Trait("Category", "Core")]
    public void ListRows_UseStaticThumbnailForSmoothScrolling()
    {
        string renderJs = UiFile(Path.Combine("js", "list", "render.js"));
        // List rows must strictly use thumbnail_data to keep virtualized scrolling lightweight and freeze GIF frames until preview
        Assert.Contains("const rawThumb = clip.thumbnail_data || '';", renderJs);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void DefaultWindowHeight_IsUnifiedTo730()
    {
        // One number for the default preset, so the window never opens at three different heights.
        Assert.Equal(730, new AppSettingsData().WindowHeight);

        string mainForm = ReadMainFormSurface();
        Assert.Contains("private const int DEFAULT_WINDOW_HEIGHT = 730;", mainForm);
        Assert.Contains("WindowSizePolicy.ResetSizeFor", mainForm);

        // Remember-OFF show-time default now lives in the pure policy (ShowWindow replays
        // the frontend's last applied preset size via the LastWindow* mirror; the hard
        // 970x730 reset lives on as the policy fallback + layout-aware reset_window_size).
        string policy = SourceFile(Path.Combine("Services", "WindowSizePolicy.cs"));
        Assert.Contains("DefaultWidth = 970;", policy);
        Assert.Contains("DefaultHeight = 730;", policy);

        string appearance = UiFile(Path.Combine("js", "settings", "settings-appearance.js"));
        Assert.Contains("let w = 970, h = 730;", appearance);
        Assert.Contains("else if (canonicalVal === 'default') { w = 970; h = 730; }", appearance);
    }

    private static string UiFile(string relativePath)
    {
        string path = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "ui", relativePath));
        Assert.True(File.Exists(path), $"Missing ui file: {path}");
        return File.ReadAllText(path);
    }

    private static string ReadMainFormSurface()
    {
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));
        var parts = Directory.GetFiles(root, "MainForm*.cs")
                             .OrderBy(p => p, StringComparer.Ordinal)
                             .Select(File.ReadAllText);
        string joined = string.Join("\n", parts);
        Assert.True(joined.Length > 0, "no MainForm*.cs partials found in repo root");
        return joined;
    }

    private static string SourceFile(string relativePath)
    {
        string path = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", relativePath));
        Assert.True(File.Exists(path), $"Missing source file: {path}");
        return File.ReadAllText(path);
    }
}
