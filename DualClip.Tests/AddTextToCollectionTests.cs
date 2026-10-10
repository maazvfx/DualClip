using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class AddTextToCollectionTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBumpToCollection_NewText_FilesIntoTargetCollection()
    {
        using var db = new TestDb();
        var (id, isNew) = db.Service.AddOrBumpToCollection("Hello Work", "work", false);

        Assert.True(isNew);
        Assert.True(id > 0);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal("work", clip!.Collection);
        Assert.False(clip.Favorite);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBumpToCollection_WithFavorite_SetsFavoriteTrue()
    {
        using var db = new TestDb();
        var (id, isNew) = db.Service.AddOrBumpToCollection("Starred Item", "all", true);

        Assert.True(isNew);
        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.True(clip!.Favorite);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBumpToCollection_ExistingAllClip_PromotesToCustomCollection()
    {
        using var db = new TestDb();
        var (id1, isNew1) = db.Service.AddOrBump("Generic Clip", "manual", "notepad.exe", "Note", "all");
        Assert.True(isNew1);

        var (id2, isNew2) = db.Service.AddOrBumpToCollection("Generic Clip", "work", false);
        Assert.False(isNew2);
        Assert.Equal(id1, id2);

        var clip = db.Service.GetClipById(id1);
        Assert.NotNull(clip);
        Assert.Equal("work", clip!.Collection);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void AddOrBumpToCollection_ExistingCustomClip_DoesNotMoveToAnotherCustomCollection()
    {
        using var db = new TestDb();
        var (id1, isNew1) = db.Service.AddOrBumpToCollection("Confidential", "private", false);
        Assert.True(isNew1);

        // Attempt to drop into 'work'
        var (id2, isNew2) = db.Service.AddOrBumpToCollection("Confidential", "work", false);
        Assert.False(isNew2);
        Assert.Equal(id1, id2);

        // Preserves original 'private' collection (SQL guard prevents cross-custom hijacking)
        var clip = db.Service.GetClipById(id1);
        Assert.NotNull(clip);
        Assert.Equal("private", clip!.Collection);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void SetFavorite_IsIdempotent_NeverFlipsBackToZero()
    {
        using var db = new TestDb();
        var (id, _) = db.Service.AddOrBump("Favorite Clip", "manual", "notepad.exe", "Note", "all");

        bool ok1 = db.Service.SetFavorite(id, true);
        Assert.True(ok1);
        Assert.True(db.Service.GetClipById(id)!.Favorite);

        // Setting favorite again keeps it true
        bool ok2 = db.Service.SetFavorite(id, true);
        Assert.True(ok2);
        Assert.True(db.Service.GetClipById(id)!.Favorite);
    }
}
