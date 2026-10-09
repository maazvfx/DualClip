using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class SvgVectorCaptureTests
{
    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_ValidSvgWithWidthAndHeight_ParsesDimensions()
    {
        string svg = @"<svg width=""64px"" height=""32px"" xmlns=""http://www.w3.org/2000/svg""><rect width=""64"" height=""32"" fill=""red""/></svg>";
        bool result = ClipboardListener.TryParseSvg(svg, out string dims, out string? sanitized);

        Assert.True(result);
        Assert.Equal("64 × 32", dims);
        Assert.NotNull(sanitized);
        Assert.Contains("<rect", sanitized);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_ValidSvgWithViewBox_ParsesViewBoxDimensions()
    {
        string svg = @"<svg viewBox=""0 0 24 24"" xmlns=""http://www.w3.org/2000/svg""><path d=""M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z""/></svg>";
        bool result = ClipboardListener.TryParseSvg(svg, out string dims, out string? sanitized);

        Assert.True(result);
        Assert.Equal("24 × 24", dims);
        Assert.NotNull(sanitized);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_SelfClosingSvg_ParsesSuccessfully()
    {
        string svg = @"<svg width=""100"" height=""50"" />";
        bool result = ClipboardListener.TryParseSvg(svg, out string dims, out string? sanitized);

        Assert.True(result);
        Assert.Equal("100 × 50", dims);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_NonSvgXml_ReturnsFalse()
    {
        string html = @"<html><body><div>Not an SVG</div></body></html>";
        bool result = ClipboardListener.TryParseSvg(html, out _, out _);

        Assert.False(result);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_MaliciousScriptElements_AreStripped()
    {
        string xssSvg = @"<svg viewBox=""0 0 100 100"" xmlns=""http://www.w3.org/2000/svg"">
            <script>alert('xss')</script>
            <circle cx=""50"" cy=""50"" r=""40"" onload=""alert('inline')"" />
        </svg>";

        bool result = ClipboardListener.TryParseSvg(xssSvg, out string dims, out string? sanitized);

        Assert.True(result);
        Assert.Equal("100 × 100", dims);
        Assert.NotNull(sanitized);
        Assert.DoesNotContain("<script", sanitized, System.StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("onload", sanitized, System.StringComparison.OrdinalIgnoreCase);
        Assert.Contains("<circle", sanitized);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void TryParseSvg_XXEPayload_IsRejectedByProhibitDtd()
    {
        string xxeSvg = @"<?xml version=""1.0""?>
        <!DOCTYPE svg [
          <!ENTITY xxe SYSTEM ""file:///C:/windows/win.ini"">
        ]>
        <svg>&xxe;</svg>";

        bool result = ClipboardListener.TryParseSvg(xxeSvg, out _, out _);

        Assert.False(result);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void DatabaseService_AddOrBumpSvg_PersistsVectorMetadata()
    {
        using var db = new TestDb();
        string svgCode = @"<svg width=""16"" height=""16""><circle cx=""8"" cy=""8"" r=""6""/></svg>";
        string hash = "abc123svg";

        var (id, isNew) = db.Service.AddOrBumpSvg(
            contentHash: hash,
            svgText: svgCode,
            imagePath: @"C:\Images\abc123svg.svg",
            thumbnailData: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
            imgDims: "16 × 16",
            imgSize: "1.2 KB SVG",
            track: "manual",
            process: "Figma.exe",
            title: "Icon Canvas",
            collection: "icons"
        );

        Assert.True(isNew);
        Assert.True(id > 0);

        var clip = db.Service.GetClipById(id);
        Assert.NotNull(clip);
        Assert.True(clip!.IsImage);
        Assert.Equal("16 × 16", clip.ImgDims);
        Assert.Equal("1.2 KB SVG", clip.ImgSize);
        Assert.Equal("icons", clip.Collection);
        Assert.Equal(svgCode, clip.Text);
    }
}
