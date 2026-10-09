using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace DualClip.Tests;

/// <summary>
/// Guards the JSON-RPC contract surface defined in <c>ui/js/core/rpc-contracts.js</c>
/// against the C# handler dispatch in <c>MainForm.cs</c>.
///
/// TEST CLASSIFICATION:
///
///   [Fact] RpcContracts_EveryCsharpHandlerIsContracted   STRUCTURAL. Parses both
///       files with no external tooling (no Node dependency) and asserts that every
///       <c>case "method":</c> label in the host dispatch has a matching declared
///       contract. This is the regression guard for RPC drift: an uncontracted method
///       falls back to positional callHost() and silently breaks if the C# parameter
///       order ever changes.
///
///   [Fact] RpcContracts_EveryContractHasCsharpHandler    STRUCTURAL. The inverse
///       direction: a contract with no handler is dead surface and usually signals a
///       handler that was deleted or renamed without updating the contract file.
///
///   [Fact] RpcContracts_CountsMatch                       STRUCTURAL. Cheap
///       canary that both sides stay non-empty and exactly equal in size.
///
///   [Fact] RpcContracts_ArgsAreUniqueIdentifiers          STRUCTURAL. Guards
///       named-argument mapping: duplicates or non-identifier arg names silently
///       mis-order positional payloads.
///
///   [Fact] RpcContracts_DefaultsAndOptionalAreDeclared    STRUCTURAL. A default
///       key that is neither a declared arg nor a declared optional arg is dead
///       configuration, and an optional arg that is also a required arg is
///       ambiguous.
/// </summary>
public class RpcContractInvariantTests
{
    private static string RepoRoot()
        => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    private static string ReadRepoFile(params string[] relativeParts)
    {
        var path = Path.Combine(new[] { RepoRoot() }.Concat(relativeParts).ToArray());
        Assert.True(File.Exists(path), $"expected repo file at {path}");
        return File.ReadAllText(path);
    }

    private sealed record Contract(string Name, List<string> Args, List<string> Optional, List<string> DefaultKeys);

    // ---------------------------------------------------------------------
    // Parsing
    // ---------------------------------------------------------------------

    /// <summary>Strips // and /* */ comments so brace scanning cannot be confused by prose.</summary>
    private static string StripJsComments(string source)
    {
        var sb = new StringBuilder(source.Length);
        bool inLine = false, inBlock = false, inStr = false;
        char quote = '\0';

        for (int i = 0; i < source.Length; i++)
        {
            char c = source[i];
            char next = i + 1 < source.Length ? source[i + 1] : '\0';

            if (inLine)
            {
                if (c == '\n') { inLine = false; sb.Append(c); }
                continue;
            }

            if (inBlock)
            {
                if (c == '*' && next == '/') { inBlock = false; i++; }
                continue;
            }

            if (inStr)
            {
                sb.Append(c);
                if (c == '\\' && next != '\0') { sb.Append(next); i++; continue; }
                if (c == quote) inStr = false;
                continue;
            }

            if (c == '/' && next == '/') { inLine = true; i++; continue; }
            if (c == '/' && next == '*') { inBlock = true; i++; continue; }
            if (c == '\'' || c == '"') { inStr = true; quote = c; sb.Append(c); continue; }

            sb.Append(c);
        }

        return sb.ToString();
    }

    /// <summary>
    /// Returns the method labels dispatched by the host switch. Scoped to the
    /// switch(method) region so unrelated switches in MainForm.cs cannot be
    /// mistaken for RPC surface.
    /// </summary>
    private static HashSet<string> ParseCsharpHandlers(string mainFormSource)
    {
        int switchIdx = mainFormSource.IndexOf("switch (method", StringComparison.Ordinal);
        Assert.True(switchIdx >= 0, "could not locate `switch (method)` dispatch in MainForm.cs");

        var labels = new HashSet<string>(StringComparer.Ordinal);
        var rx = new Regex(@"case\s+""([A-Za-z0-9_]+)""\s*:", RegexOptions.Compiled);
        foreach (Match m in rx.Matches(mainFormSource, switchIdx))
        {
            labels.Add(m.Groups[1].Value);
        }

        return labels;
    }

    /// <summary>
    /// Parses the top-level entries of the RpcContracts object literal. Uses brace
    /// depth rather than a flat regex so nested `defaults: { ... }` objects cannot be
    /// mistaken for contracts of their own.
    /// </summary>
    private static List<Contract> ParseContracts(string jsSource)
    {
        string src = StripJsComments(jsSource);

        int declIdx = src.IndexOf("RpcContracts", StringComparison.Ordinal);
        Assert.True(declIdx >= 0, "could not locate RpcContracts declaration in rpc-contracts.js");

        int bodyStart = src.IndexOf('{', declIdx);
        Assert.True(bodyStart >= 0, "RpcContracts has no object body");

        var contracts = new List<Contract>();
        int depth = 0;
        string? pendingName = null;
        int pendingStart = -1;

        for (int i = bodyStart; i < src.Length; i++)
        {
            char c = src[i];

            if (c == '{')
            {
                depth++;
                if (depth != 2) continue;

                int j = i - 1;
                while (j >= 0 && char.IsWhiteSpace(src[j])) j--;
                if (j >= 0 && src[j] == ':') j--;
                while (j >= 0 && char.IsWhiteSpace(src[j])) j--;

                int nameEnd = j + 1;
                while (j >= 0 && (char.IsLetterOrDigit(src[j]) || src[j] == '_')) j--;
                pendingName = src[(j + 1)..nameEnd];
                pendingStart = i;
                continue;
            }

            if (c != '}') continue;

            if (depth == 2 && pendingName is not null)
            {
                string body = src[(pendingStart + 1)..i];
                contracts.Add(BuildContract(pendingName, body));
                pendingName = null;
                pendingStart = -1;
            }

            depth--;
            if (depth == 0) break;
        }

        return contracts;
    }

    private static Contract BuildContract(string name, string body)
    {
        var args = ReadStringArray(body, "args");
        var optional = ReadStringArray(body, "optional");
        var defaultKeys = ReadObjectKeys(body, "defaults");
        return new Contract(name, args, optional, defaultKeys);
    }

    private static List<string> ReadStringArray(string body, string key)
    {
        var match = Regex.Match(body, $@"\b{key}\s*:\s*\[([^\]]*)\]", RegexOptions.Compiled);
        if (!match.Success) return new List<string>();

        return Regex.Matches(match.Groups[1].Value, @"[""']([A-Za-z0-9_]+)[""']", RegexOptions.Compiled)
                    .Select(m => m.Groups[1].Value)
                    .ToList();
    }

    private static List<string> ReadObjectKeys(string body, string key)
    {
        var match = Regex.Match(body, $@"\b{key}\s*:\s*\{{([^}}]*)\}}", RegexOptions.Compiled);
        if (!match.Success) return new List<string>();

        // Top-level keys only: a default object holds scalars, so split on commas that
        // are not inside a nested array literal such as excludedProcesses: [].
        var keys = new List<string>();
        int depth = 0;
        var current = new StringBuilder();

        foreach (char c in match.Groups[1].Value)
        {
            if (c == '[') depth++;
            if (c == ']') depth--;

            if (c == ',' && depth == 0)
            {
                AddKey(keys, current.ToString());
                current.Clear();
                continue;
            }

            current.Append(c);
        }

        AddKey(keys, current.ToString());
        return keys;
    }

    private static void AddKey(List<string> into, string pair)
    {
        string trimmed = pair.Trim();
        if (trimmed.Length == 0) return;

        int colon = trimmed.IndexOf(':');
        string key = (colon >= 0 ? trimmed[..colon] : trimmed).Trim();
        if (Regex.IsMatch(key, @"^[A-Za-z_][A-Za-z0-9_]*$")) into.Add(key);
    }

    private static readonly Regex IdentifierRx = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

    // ---------------------------------------------------------------------
    // Tests
    // ---------------------------------------------------------------------

    /// <summary>
    /// MainForm is a partial class: the RPC dispatch lives in MainForm.RpcDispatch.cs
    /// and domain handlers are being split out beside it, so every MainForm*.cs partial
    /// is concatenated and scanned as one surface.
    /// </summary>
    private static string ReadMainFormSurface()
    {
        var root = RepoRoot();
        var parts = Directory.GetFiles(root, "MainForm*.cs")
                               .OrderBy(p => p, StringComparer.Ordinal)
                               .Select(File.ReadAllText);
        string joined = string.Join("\n", parts);
        Assert.True(joined.Length > 0, "no MainForm*.cs partials found in repo root");
        return joined;
    }

    private static HashSet<string> Handlers()
        => ParseCsharpHandlers(ReadMainFormSurface());

    private static List<Contract> Contracts()
        => ParseContracts(ReadRepoFile("ui", "js", "core", "rpc-contracts.js"));

    [Fact]
    public void RpcContracts_EveryCsharpHandlerIsContracted()
    {
        var contracts = Contracts();
        var contracted = contracts.Select(c => c.Name).ToHashSet(StringComparer.Ordinal);
        var uncontracted = Handlers().Where(h => !contracted.Contains(h)).OrderBy(h => h, StringComparer.Ordinal).ToList();

        Assert.True(
            uncontracted.Count == 0,
            "RPC methods dispatched by MainForm.cs with no declared contract in "
            + "ui/js/core/rpc-contracts.js (they fall back to unguarded positional callHost): "
            + string.Join(", ", uncontracted));
    }

    [Fact]
    public void RpcContracts_EveryContractHasCsharpHandler()
    {
        var handlers = Handlers();
        var orphaned = Contracts().Select(c => c.Name)
                                 .Where(n => !handlers.Contains(n))
                                 .OrderBy(n => n, StringComparer.Ordinal)
                                 .ToList();

        Assert.True(
            orphaned.Count == 0,
            "Contracts declared in rpc-contracts.js with no handler in MainForm.cs "
            + "(dead RPC surface - handler deleted or renamed?): "
            + string.Join(", ", orphaned));
    }

    [Fact]
    public void RpcContracts_CountsMatch()
    {
        var handlerCount = Handlers().Count;
        var contractCount = Contracts().Count;

        Assert.True(handlerCount > 0, "no RPC handlers parsed from MainForm.cs - parser is broken");
        Assert.True(contractCount > 0, "no RPC contracts parsed from rpc-contracts.js - parser is broken");
        Assert.True(
            handlerCount == contractCount,
            $"RPC surface size mismatch: {handlerCount} handlers in MainForm.cs vs {contractCount} contracts in rpc-contracts.js.");
    }

    [Fact]
    public void RpcContracts_ArgsAreUniqueIdentifiers()
    {
        var problems = new List<string>();

        foreach (var contract in Contracts())
        {
            foreach (string arg in contract.Args)
            {
                if (!IdentifierRx.IsMatch(arg))
                {
                    problems.Add($"{contract.Name}: arg '{arg}' is not a valid identifier");
                }
            }

            var dupes = contract.Args.GroupBy(a => a, StringComparer.Ordinal)
                                     .Where(g => g.Count() > 1)
                                     .Select(g => g.Key);
            foreach (string dupe in dupes) problems.Add($"{contract.Name}: duplicate arg '{dupe}'");
        }

        Assert.True(
            problems.Count == 0,
            "Malformed RPC contract args (named-argument mapping would mis-order payloads): "
            + string.Join("; ", problems));
    }

    [Fact]
    public void RpcContracts_DefaultsAndOptionalAreDeclared()
    {
        var problems = new List<string>();

        foreach (var contract in Contracts())
        {
            var declared = new HashSet<string>(contract.Args, StringComparer.Ordinal);
            var optional = new HashSet<string>(contract.Optional, StringComparer.Ordinal);

            foreach (string opt in contract.Optional)
            {
                if (declared.Contains(opt))
                {
                    problems.Add($"{contract.Name}: '{opt}' is listed as both a required arg and optional");
                }
            }

            foreach (string def in contract.DefaultKeys)
            {
                if (!declared.Contains(def) && !optional.Contains(def))
                {
                    problems.Add($"{contract.Name}: default '{def}' is not a declared arg or optional arg");
                }
            }
        }

        Assert.True(
            problems.Count == 0,
            "RPC contract defaults/optional entries that are not declared arguments (dead configuration): "
            + string.Join("; ", problems));
    }

    [Fact]
    public void RpcContracts_NoHandlerReadsAnUndeclaredArg()
    {
        var contracts = Contracts().ToDictionary(c => c.Name, c => c, StringComparer.Ordinal);
        string csSource = ReadMainFormSurface();
        int switchIdx = csSource.IndexOf("switch (method", StringComparison.Ordinal);
        Assert.True(switchIdx >= 0, "could not locate `switch (method)` dispatch in MainForm.cs");

        var caseRx = new Regex(@"case\s+""([A-Za-z0-9_]+)""\s*:", RegexOptions.Compiled);
        var matches = caseRx.Matches(csSource, switchIdx);
        var problems = new List<string>();

        for (int i = 0; i < matches.Count; i++)
        {
            var match = matches[i];
            string methodName = match.Groups[1].Value;
            if (!contracts.TryGetValue(methodName, out var contract)) continue;

            int caseStart = match.Index;
            int nextCase = (i + 1 < matches.Count) ? matches[i + 1].Index : -1;
            int defaultIdx = csSource.IndexOf("default:", caseStart, StringComparison.Ordinal);
            int caseEnd = (nextCase >= 0) ? nextCase : (defaultIdx > caseStart ? defaultIdx : csSource.Length);
            string caseBlock = csSource.Substring(caseStart, caseEnd - caseStart);

            // Find all args[n] reads in this case block
            var argsAccessRx = new Regex(@"args\[(\d+)\]", RegexOptions.Compiled);
            int maxArgIndexRead = -1;
            foreach (Match am in argsAccessRx.Matches(caseBlock))
            {
                if (int.TryParse(am.Groups[1].Value, out int idx))
                {
                    if (idx > maxArgIndexRead) maxArgIndexRead = idx;
                }
            }

            int allowedArity = contract.Args.Count + contract.Optional.Count;
            if (maxArgIndexRead >= allowedArity)
            {
                problems.Add($"{methodName}: reads args[{maxArgIndexRead}] but contract declares only {allowedArity} total args ({contract.Args.Count} required + {contract.Optional.Count} optional)");
            }
        }

        Assert.True(
            problems.Count == 0,
            "RPC handlers reading past their declared contract arity (causes positional argument drift): "
            + string.Join("; ", problems));
    }
}