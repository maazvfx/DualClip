using DualClip.Tests;

namespace DualClip.Tests;

/// <summary>
/// The <c>tag:</c> and <c>nick:</c> query prefixes must resolve against the real tag
/// tables and the nickname column, not fall through to a generic text match. These tests
/// pin that behaviour so a refactor cannot silently turn a tag query into a full-text scan.
/// </summary>
public class TagAndNicknameQueryTests
{
    [Fact]
    public void NickQueryMatchesNickname()
    {
        using var db = new TestDb();
        db.AddText("first", nickname: "invoice");
        db.AddText("second", nickname: "receipt");
        db.AddText("third");

        var hits = db.Search("nick:invoice");

        Assert.Single(hits);
        Assert.Equal("invoice", hits[0].Nickname);
    }

    [Fact]
    public void NickQueryIsCaseInsensitive()
    {
        using var db = new TestDb();
        db.AddText("first", nickname: "Invoice");

        Assert.Single(db.Search("nick:invoice"));
        Assert.Single(db.Search("nick:INVOICE"));
    }

    [Fact]
    public void NickQueryReturnsNothingForUnknownNickname()
    {
        using var db = new TestDb();
        db.AddText("first", nickname: "invoice");

        Assert.Empty(db.Search("nick:does-not-exist"));
    }

    [Fact]
    public void NicknamePrefixAliasAlsoWorks()
    {
        using var db = new TestDb();
        db.AddText("first", nickname: "invoice");

        Assert.Single(db.Search("nickname:invoice"));
    }

    [Fact]
    public void TagQueryMatchesTaggedClip()
    {
        using var db = new TestDb();
        var tagged = db.AddText("tagged clip");
        var untagged = db.AddText("untagged clip");
        db.Service.SetTagsForClip(tagged, new[] { "work" });

        var hits = db.Search("tag:work");

        Assert.Single(hits);
        Assert.Equal(tagged, hits[0].Id);
        Assert.DoesNotContain(untagged, hits.Select(h => h.Id));
    }

    [Fact]
    public void TagQueryResolvesAgainstNormalizedTagTable()
    {
        using var db = new TestDb();
        var tagged = db.AddText("clip one");
        db.Service.SetTagsForClip(tagged, new[] { "Deep Work" });

        // Tag names are stored normalized, so a differently-cased query still resolves.
        Assert.Single(db.Search("tag:deep work"));
    }

    [Fact]
    public void TagQueryDoesNotMatchClipBodyText()
    {
        using var db = new TestDb();
        // The literal word appears in the clip text but the clip carries no such tag.
        db.AddText("this mentions work in passing");

        Assert.Empty(db.Search("tag:work"));
    }

    [Fact]
    public void TagsAliasAlsoWorks()
    {
        using var db = new TestDb();
        var tagged = db.AddText("tagged clip");
        db.Service.SetTagsForClip(tagged, new[] { "work" });

        Assert.Single(db.Search("tags:work"));
    }

    [Fact]
    public void ClipWithSeveralTagsMatchesAnyOfThem()
    {
        using var db = new TestDb();
        var tagged = db.AddText("multi tagged");
        db.Service.SetTagsForClip(tagged, new[] { "work", "urgent" });

        Assert.Single(db.Search("tag:work"));
        Assert.Single(db.Search("tag:urgent"));
    }
}