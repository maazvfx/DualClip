using DualClip.Tests;

namespace DualClip.Tests;

/// <summary>
/// Deduplication is keyed on <c>content_hash</c>, which is case-SENSITIVE because the
/// column has no COLLATE NOCASE. Capture writes UPPERCASE hex. These tests lock in that
/// the uppercase convention is honoured consistently for both text and image clips, so
/// the duplicate-on-reimport defect cannot silently return.
/// </summary>
public class DeduplicationTests
{
    private static string Hash(string text) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(text)));

    [Fact]
    public void SameTextCapturedTwiceBumpsInsteadOfDuplicating()
    {
        using var db = new TestDb();
        var (firstId, firstIsNew) = db.Service.AddOrBump("hello world", "manual", "app.exe", "App", "all");
        var (secondId, secondIsNew) = db.Service.AddOrBump("hello world", "manual", "app.exe", "App", "all");

        Assert.True(firstIsNew);
        Assert.False(secondIsNew);
        Assert.Equal(firstId, secondId);
        Assert.Single(db.Search(""));
    }

    [Fact]
    public void DifferentTextCreatesSeparateRows()
    {
        using var db = new TestDb();
        db.AddText("alpha");
        db.AddText("beta");

        Assert.Equal(2, db.Search("").Count);
    }

    [Fact]
    public void TextHashIsStoredUppercaseHex()
    {
        using var db = new TestDb();
        db.AddText("case convention check");

        var stored = ScalarString(db.DbPath, "SELECT content_hash FROM clips LIMIT 1");
        Assert.Equal(Hash("case convention check"), stored);
        Assert.Equal(stored, stored.ToUpperInvariant());
    }

    [Fact]
    public void ImageHashIsStoredVerbatimSoLookupMatches()
    {
        using var db = new TestDb();
        const string upper = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";
        db.AddImage(upper);

        var stored = ScalarString(db.DbPath, "SELECT content_hash FROM clips LIMIT 1");
        Assert.Equal(upper, stored);
    }

    [Fact]
    public void ImageClipsDedupeOnRepeatedHash()
    {
        using var db = new TestDb();
        const string upper = "00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF";
        db.AddImage(upper);
        db.AddImage(upper);

        Assert.Single(db.Search(""));
    }

    [Fact]
    public void LowercaseImageHashWouldNotMatchUppercaseLookup()
    {
        // Guards the regression direction: the column is case-sensitive, so a lowercase
        // import hash genuinely misses an uppercase stored hash. This documents why the
        // import path must normalise to uppercase.
        using var db = new TestDb();
        const string upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
        db.AddImage(upper);

        var matchesUpper = ScalarInt(db.DbPath,
            "SELECT COUNT(*) FROM clips WHERE content_hash = $h", "$h", upper);
        var matchesLower = ScalarInt(db.DbPath,
            "SELECT COUNT(*) FROM clips WHERE content_hash = $h", "$h", upper.ToLowerInvariant());

        Assert.Equal(1, matchesUpper);
        Assert.Equal(0, matchesLower);
    }

    // ------------------------------------------------------------------ helpers

    private static string ScalarString(string dbPath, string sql)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToString(cmd.ExecuteScalar()) ?? "";
    }

    private static int ScalarInt(string dbPath, string sql, string param, object value)
    {
        using var conn = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue(param, value);
        return Convert.ToInt32(cmd.ExecuteScalar());
    }
}