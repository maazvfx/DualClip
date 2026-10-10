using DualClip.Services;

namespace DualClip.Tests;

public class FileDropCaptureTests
{
    [Fact]
    public void FormatFilePreview_SingleFile_ReturnsFileName()
    {
        var paths = new List<string> { @"C:\Users\Name\Documents\Report.xlsx" };
        var preview = ClipboardListener.FormatFilePreview(paths);
        Assert.Equal("Report.xlsx", preview);
    }

    [Fact]
    public void FormatFilePreview_MultipleFiles_ReturnsFirstNamePlusCount()
    {
        var paths = new List<string>
        {
            @"C:\Users\Name\Documents\Doc1.pdf",
            @"C:\Users\Name\Documents\Doc2.pdf",
            @"C:\Users\Name\Documents\Doc3.pdf"
        };
        var preview = ClipboardListener.FormatFilePreview(paths);
        Assert.Equal("Doc1.pdf +2 more", preview);
    }

    [Fact]
    public void FormatFilePreview_DirectoryPath_ReturnsDirectoryName()
    {
        var paths = new List<string> { @"C:\Users\Name\Projects\DualClip" };
        var preview = ClipboardListener.FormatFilePreview(paths);
        Assert.Equal("DualClip", preview);
    }

    [Fact]
    public void FormatFilePreview_EmptyOrNull_ReturnsFallback()
    {
        Assert.Equal("[File]", ClipboardListener.FormatFilePreview(null!));
        Assert.Equal("[File]", ClipboardListener.FormatFilePreview(new List<string>()));
    }

    [Fact]
    public void FileDropClip_IsStoredAndSearchableByFileName()
    {
        using var db = new TestDb();
        var paths = new List<string>
        {
            @"C:\Users\Name\Photos\Vacation_Sunset_2026.jpg",
            @"C:\Users\Name\Photos\Beach.jpg"
        };
        string fullText = string.Join("\n", paths);
        string preview = ClipboardListener.FormatFilePreview(paths);

        var (id, isNew) = db.Service.AddOrBump(fullText, "file", "explorer.exe", "Photos", "all", preview);
        Assert.True(isNew);
        Assert.True(id > 0);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.Equal("file", clip!.Track);
        Assert.Equal("Vacation_Sunset_2026.jpg +1 more", clip.Preview);

        // Search by file name
        var searchResults = db.Search("Vacation_Sunset");
        Assert.Single(searchResults);
        Assert.Equal(id, searchResults[0].Id);
    }

    [Fact]
    public void FileDropClip_ReCopyingSameFiles_DedupesAndBumps()
    {
        using var db = new TestDb();
        var paths = new List<string> { @"C:\Config\appsettings.json" };
        string fullText = string.Join("\n", paths);
        string preview = ClipboardListener.FormatFilePreview(paths);

        var (id1, isNew1) = db.Service.AddOrBump(fullText, "file", "explorer.exe", "Config", "all", preview);
        Assert.True(isNew1);

        var (id2, isNew2) = db.Service.AddOrBump(fullText, "file", "explorer.exe", "Config", "all", preview);
        Assert.False(isNew2);
        Assert.Equal(id1, id2);
    }
}
