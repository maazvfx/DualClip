namespace DualClip.Tests;

/// <summary>
/// Search must tolerate the characters developers actually paste: C++, wildcards, boolean
/// words, paths and punctuation. FTS5 uses the porter unicode61 tokenizer, so these lock in
/// that special characters neither crash the query nor silently drop the match, and that the
/// LIKE fallback path used when FTS5 is unavailable behaves the same way.
/// </summary>
public class SearchTokenizationTests
{
    [Theory]
    [InlineData("std::vector<int>")]
    [InlineData("git commit -m \"fix bug\"")]
    [InlineData("C:\\Users\\name\\file.txt")]
    [InlineData("SELECT * FROM clips WHERE id = 1")]
    [InlineData("100% done")]
    [InlineData("emoji ✅ test")]
    public void SearchingForPastedCodeReturnsTheClip(string text)
    {
        using var db = new TestDb();
        db.AddText(text);

        // The distinctive token must be findable even though the surrounding string is
        // full of FTS-significant punctuation.
        var token = text.Split(new[] { ' ', '\\', '"', ':', '*' }, StringSplitOptions.RemoveEmptyEntries)
                        .FirstOrDefault(t => t.Length >= 3);

        Assert.False(string.IsNullOrEmpty(token));
        Assert.NotEmpty(db.Search(token!));
    }

    [Fact]
    public void ProgrammingLanguageTokenWithPlusSignsIsSearchable()
    {
        using var db = new TestDb();
        db.AddText("c++ and c# are different languages");

        Assert.NotEmpty(db.Search("c++"));
    }

    [Fact]
    public void BooleanWordsAreNotTreatedAsOperators()
    {
        using var db = new TestDb();
        db.AddText("cats AND dogs living together");
        db.AddText("cats or dogs running away");

        // "AND" here is ordinary text, not an FTS operator.
        Assert.NotEmpty(db.Search("AND"));
    }

    [Fact]
    public void ShortBooleanOperatorClipsAreSearchableWithoutCrashing()
    {
        using var db = new TestDb();
        db.AddText("a && b || c");

        // Every token here is shorter than three characters, so only the no-throw
        // guarantee is meaningful.
        Assert.Null(Record.Exception(() => db.Search("&&")));
        Assert.Null(Record.Exception(() => db.Search("||")));
    }

    [Fact]
    public void BareAsteriskDoesNotThrow()
    {
        using var db = new TestDb();
        db.AddText("some clip");

        var ex = Record.Exception(() => db.Search("*"));
        Assert.Null(ex);
    }

    [Fact]
    public void UnbalancedQuotesDoNotThrow()
    {
        using var db = new TestDb();
        db.AddText("a quoted clip");

        var ex = Record.Exception(() => db.Search("\"unterminated"));
        Assert.Null(ex);
    }

    [Fact]
    public void SearchSurvivesEmptyAndWhitespaceQueries()
    {
        using var db = new TestDb();
        db.AddText("only clip");

        Assert.Single(db.Search(""));
        Assert.Single(db.Search("   "));
    }

    [Fact]
    public void PlainTermsAreSearchableWhileFtsIsStillWarmingUp()
    {
        using var db = new TestDb();
        // Deliberately do NOT wait for FTS. A freshly constructed DatabaseService creates
        // the fts_clips table and its triggers on a background task, so a clip inserted
        // immediately may exist before that task finishes. Search must still return the
        // clip: recall is served by the LIKE collectors, which do not depend on FTS.
        db.AddText("fallback parity check token");

        Assert.NotEmpty(db.Search("parity"));
    }

    [Fact]
    public void FtsAndNonFtsPathsAgreeOnPlainTermCounts()
    {
        using var db = new TestDb();
        db.AddText("shared token appears in both paths");
        db.AddText("shared token again");

        var viaGetClips = db.Search("shared");
        var viaLegacy = db.Service.GetClipsLegacy(
            track: "all", search: "shared", limit: 150, offset: 0,
            collection: "all", filterType: "all", filterApp: "all",
            filterTime: "any", sort: "default", fuzzyEnabled: false);

        // The optimized engine is recall-first; it must never return FEWER rows than the
        // legacy path it replaced.
        Assert.Equal(2, viaLegacy.Count);
        Assert.True(viaGetClips.Count >= viaLegacy.Count);
    }

    [Fact]
    public void CaseInsensitiveMatchingForOrdinaryText()
    {
        using var db = new TestDb();
        db.AddText("MixedCase Identifier");

        Assert.NotEmpty(db.Search("mixedcase"));
        Assert.NotEmpty(db.Search("MIXEDCASE"));
    }

    [Fact]
    public void SearchIsScopedToTheRequestedCollection()
    {
        using var db = new TestDb();
        db.AddText("sharedword in default", collection: "all");
        db.AddText("sharedword in work", collection: "col_work");

        var workHits = db.Search("sharedword", collection: "col_work");

        Assert.Single(workHits);
        Assert.Equal("col_work", workHits[0].Collection);
    }
}