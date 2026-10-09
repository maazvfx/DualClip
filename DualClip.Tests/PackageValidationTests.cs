using DualClip;

namespace DualClip.Tests;

public class PackageValidationTests
{
    [Theory]
    [InlineData("backup.dualclip", true)]
    [InlineData("backup.zip", true)]
    [InlineData("BACKUP.DUALCLIP", true)]
    [InlineData("BACKUP.ZIP", true)]
    [InlineData("archive.tar.gz", false)]
    [InlineData("notes.txt", false)]
    [InlineData("photo.png", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsSupportedArchiveExtension_ValidatesCorrectly(string? path, bool expected)
    {
        bool result = MainForm.IsSupportedArchiveExtension(path ?? "");
        Assert.Equal(expected, result);
    }

    [Fact]
    public void ValidateArchiveMagic_StandardZipHeader_ReturnsTrue()
    {
        byte[] standardZipMagic = new byte[] { 0x50, 0x4B, 0x03, 0x04 };
        Assert.True(MainForm.ValidateArchiveMagic(standardZipMagic));
    }

    [Fact]
    public void ValidateArchiveMagic_EmptyZipHeader_ReturnsTrue()
    {
        byte[] emptyZipMagic = new byte[] { 0x50, 0x4B, 0x05, 0x06 };
        Assert.True(MainForm.ValidateArchiveMagic(emptyZipMagic));
    }

    [Theory]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47 })] // PNG
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 })] // JPEG
    [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38 })] // GIF
    [InlineData(new byte[] { 0x50, 0x4B, 0x01, 0x02 })] // Central directory
    [InlineData(new byte[] { 0x00, 0x00, 0x00, 0x00 })] // Zeroes
    public void ValidateArchiveMagic_NonZipHeader_ReturnsFalse(byte[] magic)
    {
        Assert.False(MainForm.ValidateArchiveMagic(magic));
    }

    [Fact]
    public void ValidateArchiveMagic_NullOrShortArray_ReturnsFalse()
    {
        Assert.False(MainForm.ValidateArchiveMagic(null!));
        Assert.False(MainForm.ValidateArchiveMagic(Array.Empty<byte>()));
        Assert.False(MainForm.ValidateArchiveMagic(new byte[] { 0x50, 0x4B, 0x03 }));
    }

    [Fact]
    public void DecodePackageBase64_ValidBase64_DecodesSuccessfully()
    {
        byte[] original = new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00 };
        string b64 = Convert.ToBase64String(original);
        byte[]? decoded = MainForm.DecodePackageBase64(b64);

        Assert.NotNull(decoded);
        Assert.Equal(original, decoded);
    }

    [Fact]
    public void DecodePackageBase64_InvalidOrEmpty_ReturnsNull()
    {
        Assert.Null(MainForm.DecodePackageBase64(""));
        Assert.Null(MainForm.DecodePackageBase64("   "));
        Assert.Null(MainForm.DecodePackageBase64(null!));
        Assert.Null(MainForm.DecodePackageBase64("not_valid_base64!@#$"));
    }

    [Fact]
    public void DecodePackageBase64_ExceedsMaxBytes_ReturnsNull()
    {
        byte[] data = new byte[1024];
        string b64 = Convert.ToBase64String(data);
        Assert.Null(MainForm.DecodePackageBase64(b64, maxBytes: 500));
    }

    [Fact]
    public void ReadBoundedEntryStream_EnforcesMaxBytes()
    {
        using var ms = new MemoryStream();
        using (var archive = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Create, true))
        {
            var entry = archive.CreateEntry("test.txt");
            using var writer = new StreamWriter(entry.Open());
            writer.Write(new string('a', 1000));
        }
        ms.Position = 0;
        using var readArchive = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Read);
        var readEntry = readArchive.GetEntry("test.txt")!;

        var okBytes = MainForm.ReadBoundedEntryStream(readEntry, 2000);
        Assert.NotNull(okBytes);
        Assert.Equal(1000, okBytes.Length);

        var tooSmallBytes = MainForm.ReadBoundedEntryStream(readEntry, 500);
        Assert.Null(tooSmallBytes);
    }
}
