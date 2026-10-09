namespace DualClip.Models;

public class CollectionDef
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool Pinned { get; set; }
    public int SortOrder { get; set; }
    public string? ParentId { get; set; }
}

public class CollectionCountsData
{
    public System.Collections.Generic.Dictionary<string, int> Collections { get; set; } = new(System.StringComparer.OrdinalIgnoreCase);
    public int AllTotal { get; set; }
    public int AllUnorganized { get; set; }
    public int Pins { get; set; }
    public int MostUsed { get; set; }
}
