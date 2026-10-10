using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using DualClip.Models;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class ClipRenameTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void SetCustomTitle_RoundTrip_PersistsAndRetrieves()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("sk_live_1234567890abcdef", "manual", "code.exe", "VS Code", "all");

        bool ok = db.Service.SetCustomTitle(id, "Stripe Live Key");
        Assert.True(ok);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal("Stripe Live Key", clip!.CustomTitle);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SetCustomTitle_CapsAt120Chars()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("some data", "manual", "code.exe", "VS Code", "all");

        string longTitle = new string('A', 150);
        bool ok = db.Service.SetCustomTitle(id, longTitle);
        Assert.True(ok);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal(120, clip!.CustomTitle!.Length);
        Assert.Equal(new string('A', 120), clip.CustomTitle);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SetCustomTitle_EmptyOrWhitespace_ClearsToNull()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("some data", "manual", "code.exe", "VS Code", "all");

        db.Service.SetCustomTitle(id, "Temporary Title");
        var clip1 = db.Service.GetClipById(id);
        Assert.Equal("Temporary Title", clip1!.CustomTitle);

        db.Service.SetCustomTitle(id, "   ");
        var clip2 = db.Service.GetClipById(id);
        Assert.Null(clip2!.CustomTitle);
    }

    [Fact]
    public void Search_MatchesCustomTitle_RanksAtHighTier()
    {
        using var db = new TestDb();
        // Item 1: contains "Invoice" only deep in the text body
        var (id1, _) = db.Service.AddOrBump("random text with Invoice details inside", "manual", "notepad.exe", "Notes", "all");
        // Item 2: has custom title exact match "Invoice"
        var (id2, _) = db.Service.AddOrBump("totally unrelated content xyz 987", "manual", "notepad.exe", "Notes", "all");
        db.Service.SetCustomTitle(id2, "Invoice");

        // Optimized search for "Invoice"
        var results = db.Service.GetClipsOptimized(search: "Invoice");
        Assert.NotEmpty(results);

        // id2 (custom title exact match, score 92) should rank before id1 (text substring, score 25/35)
        var matched = results.Where(r => r.Id == id2).FirstOrDefault();
        Assert.NotNull(matched);
        Assert.Equal("Invoice", matched!.CustomTitle);
        Assert.Equal(id2, results[0].Id);
    }

    [Fact]
    public void SetTagsForClip_PreservesCustomTitle()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("DATABASE_URL=postgres://...", "manual", "code.exe", "VS Code", "all");

        // Set custom title
        db.Service.SetCustomTitle(id, "Production DB Password");

        // Now modify tags for the clip (which rewrites nickname in legacy/sync paths)
        db.Service.SetTagsForClip(id, new[] { "work", "database", "secrets" });

        // Verify tags updated
        var clipAfterTags = db.Service.GetClipById(id);
        Assert.NotNull(clipAfterTags);
        Assert.Contains("work", clipAfterTags!.Tags);
        Assert.Contains("secrets", clipAfterTags.Tags);

        // Crucial regression check: custom_title MUST remain untouched
        Assert.Equal("Production DB Password", clipAfterTags.CustomTitle);
    }

    [Fact]
    public void RestoreClip_PreservesCustomTitle()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("ssh-rsa AAAAB3NzaC1yc2E...", "manual", "terminal.exe", "Terminal", "all");
        db.Service.SetCustomTitle(id, "AWS Jumpbox SSH Key");

        var original = db.Service.GetClipById(id);
        Assert.NotNull(original);
        Assert.Equal("AWS Jumpbox SSH Key", original!.CustomTitle);

        // Delete clip
        db.Service.DeleteClip(id);
        Assert.Null(db.Service.GetClipById(id));

        // Restore clip via snapshot (undo operation)
        long restoredId = db.Service.RestoreClip(original);
        Assert.Equal(id, restoredId);

        var restored = db.Service.GetClipById(id);
        Assert.NotNull(restored);
        Assert.Equal("AWS Jumpbox SSH Key", restored!.CustomTitle);
    }

    /// <summary>
    /// Regression guard for the rename-lost-on-reload blocker: the payload the UI receives
    /// on load is built by FormatClipForJs, so a clip renamed in the DB must still carry its
    /// custom_title through that projection.
    /// </summary>
    [Fact]
    [Trait("Category", "Core")]
    public void FormatClipForJs_EmitsCustomTitle_SurvivesReload()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("ssh-rsa AAAAB3NzaC1yc2E...", "manual", "terminal.exe", "Terminal", "all");
        db.Service.SetCustomTitle(id, "Prod Deploy Key");

        // Reload path: the clip is re-read from the DB and pushed to the UI as-is.
        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal("Prod Deploy Key", clip!.CustomTitle);

        using var doc = JsonDocument.Parse(SerializeFormatClipForJs(clip));
        Assert.True(doc.RootElement.TryGetProperty("custom_title", out var customTitle),
            "FormatClipForJs must emit custom_title or renames are lost on reload");
        Assert.Equal("Prod Deploy Key", customTitle.GetString());
    }

    [Fact]
    [Trait("Category", "Core")]
    public void FormatClipForJs_WhenNoCustomTitle_EmitsEmptyStringNotNull()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("plain clip", "manual", "notepad.exe", "Notes", "all");

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Null(clip!.CustomTitle);

        using var doc = JsonDocument.Parse(SerializeFormatClipForJs(clip));
        Assert.True(doc.RootElement.TryGetProperty("custom_title", out var customTitle));
        Assert.Equal(string.Empty, customTitle.GetString());
    }

    /// <summary>
    /// Invokes MainForm's private static FormatClipForJs and returns its JSON.
    /// Reflection on a static method never instantiates the form, so no window is created.
    /// </summary>
    private static string SerializeFormatClipForJs(ClipItem clip)
    {
        var method = typeof(MainForm).GetMethod("FormatClipForJs", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        object? formatted = method!.Invoke(null, new object?[] { clip, false });
        Assert.NotNull(formatted);
        return JsonSerializer.Serialize(formatted);
    }
}
