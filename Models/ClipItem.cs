using System;

namespace DualClip.Models;

public class ClipItem
{
    public long Id { get; set; }
    public string Text { get; set; } = string.Empty;
    public string Preview { get; set; } = string.Empty;
    public string Track { get; set; } = "manual"; // "manual" or "voice"
    public string Process { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastUsedAt { get; set; } = DateTime.UtcNow;
    public bool Pinned { get; set; }
    public bool Favorite { get; set; }
    public string Collection { get; set; } = "all";
    public int UseCount { get; set; }
    public long SortRank { get; set; }
    public bool IsImage { get; set; }
    public string ImagePath { get; set; } = string.Empty;
    public string ThumbnailData { get; set; } = string.Empty;
    public string ImgDims { get; set; } = string.Empty;
    public string ImgSize { get; set; } = string.Empty;
    public string Nickname { get; set; } = string.Empty;
    public string? CustomTitle { get; set; }
    public string? RichText { get; set; }
    public System.Collections.Generic.List<string> Tags { get; set; } = new();

    public bool IsVoice => string.Equals(Track, "voice", StringComparison.OrdinalIgnoreCase);
}

