using System;
using System.Collections.Generic;
using DualClip.Services;
using Xunit;

namespace DualClip.Tests;

public class DoubleCopyOverrideTests
{
    [Fact]
    public void DisabledOverride_AlwaysDropsBlocklistedAppCopies()
    {
        using var db = new TestDb();
        using var listener = new ClipboardListener(db.Service);
        listener.EnableBlocklist = true;
        listener.DoubleCopyOverride = false;
        listener.BlocklistedApps.Clear();
        listener.BlocklistedApps.Add("slack.exe");

        int hash = "secret data".GetHashCode(StringComparison.Ordinal);

        // First copy is blocklisted
        Assert.True(listener.IsBlocklisted("slack.exe", hash));
        // Immediate second copy is STILL blocklisted when DoubleCopyOverride is false
        Assert.True(listener.IsBlocklisted("slack.exe", hash));
    }

    [Fact]
    public void EnabledOverride_AllowsRapidSecondCopy()
    {
        using var db = new TestDb();
        using var listener = new ClipboardListener(db.Service);
        listener.EnableBlocklist = true;
        listener.DoubleCopyOverride = true;
        listener.BlocklistedApps.Clear();
        listener.BlocklistedApps.Add("slack.exe");

        int hash = "intentional data".GetHashCode(StringComparison.Ordinal);

        // 1st copy: blocked
        Assert.True(listener.IsBlocklisted("slack.exe", hash));

        // 2nd copy within 1200ms with same process and same hash: overridden! (returns false => not blocklisted)
        Assert.False(listener.IsBlocklisted("slack.exe", hash));

        // 3rd copy immediately after override: treated as a fresh 1st copy (blocked)
        Assert.True(listener.IsBlocklisted("slack.exe", hash));
    }

    [Fact]
    public void EnabledOverride_DifferentHashDoesNotOverride()
    {
        using var db = new TestDb();
        using var listener = new ClipboardListener(db.Service);
        listener.EnableBlocklist = true;
        listener.DoubleCopyOverride = true;
        listener.BlocklistedApps.Clear();
        listener.BlocklistedApps.Add("slack.exe");

        int hash1 = "data 1".GetHashCode(StringComparison.Ordinal);
        int hash2 = "data 2".GetHashCode(StringComparison.Ordinal);

        // 1st copy
        Assert.True(listener.IsBlocklisted("slack.exe", hash1));

        // 2nd copy with different content hash: blocked (resets tracking to data 2)
        Assert.True(listener.IsBlocklisted("slack.exe", hash2));

        // 3rd copy with data 2 hash: now overridden!
        Assert.False(listener.IsBlocklisted("slack.exe", hash2));
    }

    [Fact]
    public void EnabledOverride_DifferentAppDoesNotOverride()
    {
        using var db = new TestDb();
        using var listener = new ClipboardListener(db.Service);
        listener.EnableBlocklist = true;
        listener.DoubleCopyOverride = true;
        listener.BlocklistedApps.Clear();
        listener.BlocklistedApps.Add("slack.exe");
        listener.BlocklistedApps.Add("discord.exe");

        int hash = "shared data".GetHashCode(StringComparison.Ordinal);

        // 1st copy from slack
        Assert.True(listener.IsBlocklisted("slack.exe", hash));

        // 2nd copy from discord: blocked
        Assert.True(listener.IsBlocklisted("discord.exe", hash));
    }
}
