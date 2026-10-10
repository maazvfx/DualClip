using System;
using System.Linq;
using DualClip.Models;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class RichTextCaptureTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBump_WithRichText_PersistsAndRetrieves()
    {
        using var db = new TestDb();
        string plainText = "Bold and Italic Header";
        string richRtf = @"rtf:{\rtf1\ansi\b Bold\b0  and \i Italic\i0  Header}";

        var (id, isNew) = db.Service.AddOrBump(plainText, "manual", "winword.exe", "Word Document", "all", previewOverride: null, richText: richRtf);
        Assert.True(isNew);
        Assert.True(id > 0);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal(plainText, clip!.Text);
        Assert.Equal(richRtf, clip.RichText);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBump_BumpExisting_UpdatesRichText()
    {
        using var db = new TestDb();
        string plainText = "Repeated Heading";
        string initialRtf = @"rtf:{\rtf1\ansi\b Initial}";
        string updatedRtf = @"rtf:{\rtf1\ansi\b Updated\b0  Heading}";

        var (id1, isNew1) = db.Service.AddOrBump(plainText, "manual", "notepad.exe", "Notes", "all", richText: initialRtf);
        Assert.True(isNew1);

        var (id2, isNew2) = db.Service.AddOrBump(plainText, "manual", "notepad.exe", "Notes", "all", richText: updatedRtf);
        Assert.False(isNew2);
        Assert.Equal(id1, id2);

        var clip = db.Service.GetClipById(id1);
        Assert.NotNull(clip);
        Assert.Equal(updatedRtf, clip!.RichText);
    }

    [Fact]
    public void TryParseRichPayload_DetectsRtfFormats()
    {
        string taggedRtf = @"rtf:{\rtf1\ansi Test RTF}";
        bool ok1 = ClipboardListener.TryParseRichPayload(taggedRtf, out string? type1, out string? body1);
        Assert.True(ok1);
        Assert.Equal("rtf", type1);
        Assert.Equal(@"{\rtf1\ansi Test RTF}", body1);

        string rawRtf = @"{\rtf1\ansi\deff0 Test raw}";
        bool ok2 = ClipboardListener.TryParseRichPayload(rawRtf, out string? type2, out string? body2);
        Assert.True(ok2);
        Assert.Equal("rtf", type2);
        Assert.Equal(rawRtf, body2);
    }

    [Fact]
    public void TryParseRichPayload_DetectsHtmlFormats()
    {
        string taggedHtml = "html:Version:1.0\r\nStartHTML:000000\r\n<!--StartFragment--><b>Hello</b><!--EndFragment-->";
        bool ok1 = ClipboardListener.TryParseRichPayload(taggedHtml, out string? type1, out string? body1);
        Assert.True(ok1);
        Assert.Equal("html", type1);
        Assert.StartsWith("Version:1.0", body1);

        string rawFragment = "<div><!--StartFragment--><i>Styled text</i><!--EndFragment--></div>";
        bool ok2 = ClipboardListener.TryParseRichPayload(rawFragment, out string? type2, out string? body2);
        Assert.True(ok2);
        Assert.Equal("html", type2);
        Assert.Equal(rawFragment, body2);
    }

    [Fact]
    public void TryParseRichPayload_RejectsPlainTextAndNull()
    {
        Assert.False(ClipboardListener.TryParseRichPayload(null, out _, out _));
        Assert.False(ClipboardListener.TryParseRichPayload("", out _, out _));
        Assert.False(ClipboardListener.TryParseRichPayload("   ", out _, out _));
        Assert.False(ClipboardListener.TryParseRichPayload("Just normal plain text string", out _, out _));
    }

    [Fact]
    public void RestoreClip_PreservesRichText()
    {
        using var db = new TestDb();
        string rtfPayload = @"rtf:{\rtf1\ansi\b Secret Formatted Note}";
        var (id, _) = db.Service.AddOrBump("Secret Formatted Note", "manual", "word.exe", "Word", "all", richText: rtfPayload);

        var original = db.Service.GetClipById(id);
        Assert.NotNull(original);
        Assert.Equal(rtfPayload, original!.RichText);

        db.Service.DeleteClip(id);
        Assert.Null(db.Service.GetClipById(id));

        long restoredId = db.Service.RestoreClip(original);
        Assert.Equal(id, restoredId);

        var restored = db.Service.GetClipById(id);
        Assert.NotNull(restored);
        Assert.Equal(rtfPayload, restored!.RichText);
    }

    [Fact]
    public void SearchOptimized_HydratesRichText()
    {
        using var db = new TestDb();
        string htmlPayload = "html:Version:1.0\r\n<!--StartFragment--><span>Searchable Rich Text</span><!--EndFragment-->";
        var (id, _) = db.Service.AddOrBump("Searchable Rich Text", "manual", "chrome.exe", "Browser", "all", richText: htmlPayload);

        var results = db.Service.GetClipsOptimized(search: "Searchable");
        Assert.NotEmpty(results);

        var found = results.FirstOrDefault(r => r.Id == id);
        Assert.NotNull(found);
        Assert.Equal(htmlPayload, found!.RichText);
    }

    /// <summary>
    /// Regression guard for the stale-rich-text blocker: UpdateText is the only writer behind
    /// the update_clip RPC, so editing a clip's text must drop the original RTF/HTML payload
    /// instead of pasting the edited words with obsolete formatting.
    /// </summary>
    [Fact]
    [Trait("Category", "Core")]
    public void UpdateText_ClearsStaleRichText()
    {
        using var db = new TestDb();
        string rtfPayload = @"rtf:{\rtf1\ansi\b Bold Original}";
        var (id, _) = db.Service.AddOrBump("Bold Original", "manual", "word.exe", "Word", "all", richText: rtfPayload);
        Assert.Equal(rtfPayload, db.Service.GetClipById(id)!.RichText);

        bool ok = db.Service.UpdateText(id, "Edited plain text");
        Assert.True(ok);

        var after = db.Service.GetClipById(id);
        Assert.NotNull(after);
        Assert.Equal("Edited plain text", after!.Text);
        Assert.Null(after.RichText);
    }
}
