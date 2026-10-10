using System;
using System.Diagnostics;
using System.IO;
using Xunit;

namespace DualClip.Tests;

// Adversarial handoff tests for sidebar nested collections (commit 6a121db).
// Verifier role: these tests EXECUTE logic and assert runtime state.
// They must never be converted to source-text greps.
// A failing test here is a documented finding, not a broken suite:
// log it in docs/reviews/sidebar-nested-collections.md and do not touch
// implementation code to make it pass.
public class SidebarNestedAdversarialTests
{
    private static string RepoFile(params string[] parts)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string candidate = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", Path.Combine(parts)));
        if (File.Exists(candidate)) return candidate;
        return Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), Path.Combine(parts)));
    }

    private static string RunNode(string script, int timeoutMs = 15000)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"-e \"{script.Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ")}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var proc = Process.Start(psi);
        Assert.NotNull(proc);
        string output = proc.StandardOutput.ReadToEnd();
        string error = proc.StandardError.ReadToEnd();
        bool exited = proc.WaitForExit(timeoutMs);
        if (!exited)
        {
            try { proc.Kill(entireProcessTree: true); } catch { }
            Assert.Fail("RENDERER HANG: node harness did not terminate within " + timeoutMs + "ms. stderr: " + error);
        }
        Assert.Equal(0, proc.ExitCode);
        return output.Trim();
    }

    private const string SidebarJsPrologue = @"
const fs = require('fs');
let code = fs.readFileSync('{JS}', 'utf8');
function makeEl(id) { return { id: id, innerHTML: '', textContent: '0',
  classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } }; }
let els = {};
global.document = {
  getElementById: (id) => { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  addEventListener: () => {},
  querySelectorAll: () => []
};
global.window = {};
global.escapeHtml = (s) => s;
global.getSetting = () => 'sidebar';
";

    private static string WithJs(string body)
    {
        string jsPath = RepoFile("ui", "js", "list", "sidebar-layout.js");
        Assert.True(File.Exists(jsPath));
        string normalized = Path.GetFullPath(jsPath).Replace("\\", "/");
        return SidebarJsPrologue.Replace("{JS}", normalized) + body;
    }

    // ---------- RISK 1: Cascade & orphan integrity ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk1_DeleteParent_ReparentsChildrenToTopLevel()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("p1", "Parent", false, 0);
        db.Service.SaveCollection("c1", "Child", false, 1);
        db.Service.SaveCollection("g1", "Grandchild", false, 2);
        Assert.True(db.Service.SetCollectionParent("c1", "p1"));
        Assert.True(db.Service.SetCollectionParent("g1", "c1"));
        long clipId = db.AddText("parent clip", "p1");

        Assert.True(db.Service.DeleteCollectionDef("p1"));

        var defs = db.Service.GetCollections();
        var child = defs.Find(d => d.Id == "c1");
        var grandchild = defs.Find(d => d.Id == "g1");
        Assert.NotNull(child);
        Assert.NotNull(grandchild);
        Assert.Null(child.ParentId);
        Assert.Equal("c1", grandchild.ParentId);
        Assert.Null(defs.Find(d => d.Id == "p1"));
        var clip = db.Service.GetClipById(clipId);
        Assert.NotNull(clip);
        Assert.Equal("all", clip.Collection);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk1_DeleteCollectionWithClips_KeepsSubtreeRootsAlive()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("p2", "Parent", false, 0);
        db.Service.SaveCollection("c2", "Child", false, 1);
        Assert.True(db.Service.SetCollectionParent("c2", "p2"));
        long clipId = db.AddText("doomed clip", "p2");

        Assert.True(db.Service.DeleteCollectionWithClips("p2"));

        var defs = db.Service.GetCollections();
        var child = defs.Find(d => d.Id == "c2");
        Assert.NotNull(child);
        Assert.Null(child.ParentId);
        Assert.Null(db.Service.GetClipById(clipId));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk1_DeleteNonexistentParent_LeavesTreeUntouched()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("p3", "Parent", false, 0);
        db.Service.SaveCollection("c3", "Child", false, 1);
        Assert.True(db.Service.SetCollectionParent("c3", "p3"));

        Assert.False(db.Service.DeleteCollectionDef("ghost"));

        var child = db.Service.GetCollections().Find(d => d.Id == "c3");
        Assert.NotNull(child);
        Assert.Equal("p3", child.ParentId);
    }

    // ---------- S2 regression: re-saving a nested collection must not un-nest it ----------
    // The rename flow re-saves the definition; the parent must ride along or the
    // folder silently returns to the top level on the next hydrate.

    [Fact]
    [Trait("Category", "Core")]
    public void S2_ResaveNestedCollectionWithParent_PreservesNesting()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("sa", "A", false, 0);
        db.Service.SaveCollection("sb", "B", false, 1);
        Assert.True(db.Service.SetCollectionParent("sb", "sa"));

        Assert.True(db.Service.SaveCollection("sb", "B renamed", false, 1, "sa"));

        var child = db.Service.GetCollections().Find(d => d.Id == "sb");
        Assert.NotNull(child);
        Assert.Equal("B renamed", child.Name);
        Assert.Equal("sa", child.ParentId);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void S2_RenameCollection_PreservesNesting()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("ra", "A", false, 0);
        db.Service.SaveCollection("rb", "B", false, 1);
        Assert.True(db.Service.SetCollectionParent("rb", "ra"));

        Assert.True(db.Service.RenameCollection("rb", "B renamed"));

        var child = db.Service.GetCollections().Find(d => d.Id == "rb");
        Assert.NotNull(child);
        Assert.Equal("B renamed", child.Name);
        Assert.Equal("ra", child.ParentId);
    }

    // ---------- RISK 2: cycles must be impossible, renderer must terminate ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk2_SaveCollectionDirectCyclePaths_Rejected()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("a", "A", false, 0);
        db.Service.SaveCollection("b", "B", false, 1);

        Assert.False(db.Service.SaveCollection("a", "A", false, 0, "a"));
        Assert.True(db.Service.SetCollectionParent("b", "a"));
        Assert.False(db.Service.SaveCollection("a", "A", false, 0, "b"));
        Assert.False(db.Service.SetCollectionParent("a", "b"));

        db.Service.SaveCollection("c", "C", false, 2);
        db.Service.SaveCollection("d", "D", false, 3);
        Assert.True(db.Service.SetCollectionParent("c", "b"));
        Assert.True(db.Service.SetCollectionParent("d", "c"));
        Assert.False(db.Service.SetCollectionParent("a", "d"));

        Assert.True(db.Service.IsDescendantOf("d", "a"));
        Assert.False(db.Service.IsDescendantOf("a", "d"));
        Assert.False(db.Service.IsDescendantOf("nope", "a"));
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk2_RendererTerminatesOnCyclicData()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 0;
global.customCollections = [
  { id: 'x', name: 'X', parentId: 'y' },
  { id: 'y', name: 'Y', parentId: 'x' },
  { id: 's', name: 'Self', parentId: 's' },
  { id: 'ok', name: 'Ok', parentId: null }
];
eval(code);
renderSidebarNav();
let html = els['sidebarNav'] ? els['sidebarNav'].innerHTML : '';
process.stdout.write('TERMINATED,len=' + html.length);
"));
        Assert.StartsWith("TERMINATED,", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void F2_CyclicFoldersRenderInsteadOfVanishing()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 0;
global.customCollections = [
  { id: 'x', name: 'X', parentId: 'y' },
  { id: 'y', name: 'Y', parentId: 'x' },
  { id: 's', name: 'Self', parentId: 's' },
  { id: 'ok', name: 'Ok', parentId: null }
];
eval(code);
renderSidebarNav();
let html = els['sidebarNav'] ? els['sidebarNav'].innerHTML : '';
let missing = ['x','y','s','ok'].filter(id => !html.includes('side_col_' + id));
process.stdout.write('missing=' + missing.join(','));
"));
        Assert.Equal("missing=", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk2_RollupTerminatesOnCyclicData()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = (id) => id === 'x' ? 2 : 1;
global.customCollections = [
  { id: 'x', name: 'X', parentId: 'y' },
  { id: 'y', name: 'Y', parentId: 'x' }
];
eval(code);
let n = getCollectionRollupCount('x');
process.stdout.write('sum=' + n);
"));
        Assert.Equal("sum=3", output);
    }

    [Fact]
    [Trait("Category", "Core")]public void Risk2_DepthBeyondCap_FlattensDeepFoldersInsteadOfHidingThem()
        {
            // Every folder in the chain must still be reachable in the DOM. The previous version of
            // this test only asserted that no 'sidebar-depth-5/6/7' class existed, which the renderer's
            // Math.min(depth, 4) made unconditionally true, so it passed while depth 6+ was dropped.
            // NOTE: never put comments inside these node scripts - RunNode flattens newlines to
            // spaces, so a line comment would swallow the rest of the script and yield empty output.
            string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 1;
global.customCollections = [
  { id: 'd0', name: 'D0', parentId: null },
  { id: 'd1', name: 'D1', parentId: 'd0' },
  { id: 'd2', name: 'D2', parentId: 'd1' },
  { id: 'd3', name: 'D3', parentId: 'd2' },
  { id: 'd4', name: 'D4', parentId: 'd3' },
  { id: 'd5', name: 'D5', parentId: 'd4' },
  { id: 'd6', name: 'D6', parentId: 'd5' },
  { id: 'd7', name: 'D7', parentId: 'd6' }
];
eval(code);
renderSidebarNav();
let html = els['sidebarNav'] ? els['sidebarNav'].innerHTML : '';
let ids = ['d0','d1','d2','d3','d4','d5','d6','d7'];
let missing = ids.filter(id => !html.includes('side_col_' + id));
let overIndented = html.includes('sidebar-depth-5') || html.includes('sidebar-depth-6') || html.includes('sidebar-depth-7');
process.stdout.write('missing=' + missing.length + ',overIndented=' + overIndented);
"));
        Assert.Equal("missing=0,overIndented=false", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk6_BackendRejection_RollsBackOptimisticFolderMove()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 1;
global.customCollections = [
  { id: 'w8', name: 'Work', parentId: null },
  { id: 'w9', name: 'Archive', parentId: null }
];
global.window.pywebview = { api: { set_collection_parent: () => Promise.resolve({ ok: false }) } };
eval(code);
renderSidebarNav = () => {};
moveCollectionToParent('w8', 'w9');
Promise.resolve().then(() => {}).then(() => {
  let p = customCollections.find(c => c.id === 'w8').parentId || 'null';
  process.stdout.write('parent=' + p);
});
"));
        // The database refused the move, so the optimistic in-memory parent must be undone
        // instead of surviving until the next reload silently reverts it.
        Assert.Equal("parent=null", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk6_BackendAcceptance_KeepsOptimisticFolderMove()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 1;
global.customCollections = [
  { id: 'w8', name: 'Work', parentId: null },
  { id: 'w9', name: 'Archive', parentId: null }
];
global.window.pywebview = { api: { set_collection_parent: () => Promise.resolve({ ok: true }) } };
eval(code);
renderSidebarNav = () => {};
moveCollectionToParent('w8', 'w9');
Promise.resolve().then(() => {}).then(() => {
  let p = customCollections.find(c => c.id === 'w8').parentId || 'null';
  process.stdout.write('parent=' + p);
});
"));
        Assert.Equal("parent=w9", output);
    }

    // ---------- RISK 3: drop must not select ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk3_DropDoesNotSelectTarget_ClickSuppressedThenRestored()
    {
        string output = RunNode(WithJs(@"
let selected = [];
global.selectCollection = (id) => { selected.push(id); };
global.customCollections = [
  { id: 'aa', name: 'AA', parentId: null },
  { id: 'bb', name: 'BB', parentId: null }
];
eval(code);
renderSidebarNav = () => {};
let fakeEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: '', setData: () => {}, getData: () => '', dropEffect: '' } };
handleSidebarColDragStart(fakeEvent, 'aa');
handleSidebarColDrop(fakeEvent, 'bb');
let suppressed = (window._sidebarInternalDragOccurred === true);
if (window._sidebarInternalDragOccurred) { } else { selectCollection('bb'); }
let selectedAtDrop = selected.length;
handleSidebarColDragEnd(fakeEvent);
setTimeout(() => {
  let restored = (window._sidebarInternalDragOccurred === false);
  process.stdout.write('suppressed=' + suppressed + ',selectedAtDrop=' + selectedAtDrop + ',restored=' + restored);
}, 250);
"), timeoutMs: 15000);
        Assert.Equal("suppressed=true,selectedAtDrop=0,restored=true", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk3_DropOntoDescendant_BlockedWithoutMovingOrSelecting()
    {
        string output = RunNode(WithJs(@"
let selected = [];
let toasts = [];
global.selectCollection = (id) => { selected.push(id); };
global.showToast = (m) => { toasts.push(m); };
global.customCollections = [
  { id: 'pp', name: 'PP', parentId: null },
  { id: 'cc', name: 'CC', parentId: 'pp' }
];
eval(code);
renderSidebarNav = () => {};
let fakeEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: '', setData: () => {}, getData: () => '', dropEffect: '' } };
handleSidebarColDragStart(fakeEvent, 'pp');
handleSidebarColDrop(fakeEvent, 'cc');
let stayed = customCollections.find(c => c.id === 'pp').parentId || 'null';
process.stdout.write('parent=' + stayed + ',selected=' + selected.length + ',warned=' + (toasts.length > 0));
"));
        Assert.Equal("parent=null,selected=0,warned=true", output);
    }

    // ---------- RISK 4: badge rollup integrity ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk4_ParentBadge_SumsDescendantsExactlyOnce()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = (id) => {
  if (id === 'gp') return 0;
  if (id === 'mid') return 2;
  if (id === 'leaf') return 1;
  return 0;
};
global.customCollections = [
  { id: 'gp', name: 'GP', parentId: null },
  { id: 'mid', name: 'MID', parentId: 'gp' },
  { id: 'leaf', name: 'LEAF', parentId: 'mid' }
];
eval(code);
process.stdout.write(
  getCollectionRollupCount('gp') + ',' +
  getCollectionRollupCount('mid') + ',' +
  getCollectionRollupCount('leaf'));
"));
        Assert.Equal("3,3,1", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk4_BackendTotals_AgreeWithDirectCounts()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("rp", "RP", false, 0);
        db.Service.SaveCollection("rc", "RC", false, 1);
        Assert.True(db.Service.SetCollectionParent("rc", "rp"));
        db.AddText("one", "rp");
        db.AddText("two", "rc");
        db.AddText("three", "rc");
        db.AddText("lone", "all");

        var counts = db.Service.GetCollectionsWithCounts();
        int named = 0;
        foreach (var kv in counts)
        {
            if (kv.Key == "all_total" || kv.Key == "all_unorganized" || kv.Key == "pins" || kv.Key == "most_used")
                continue;
            named += kv.Value;
        }
        Assert.Equal(counts["all_total"], named + counts["all_unorganized"]);
    }

    // ---------- RISK 5: system bucket isolation ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk5_BackendRejectsSystemBucketAsParent()
    {
        using var db = new TestDb();
        db.Service.SaveCollection("w5", "Work", false, 0);

        Assert.False(db.Service.SetCollectionParent("w5", "pins"));
        Assert.False(db.Service.SetCollectionParent("w5", "all_total"));
        Assert.False(db.Service.SaveCollection("w5", "Work", false, 0, "most_used"));

        var def = db.Service.GetCollections().Find(d => d.Id == "w5");
        Assert.NotNull(def);
        Assert.Null(def.ParentId);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk5_FrontendNeverNestsUnderLeakedSystemNode()
    {
        string output = RunNode(WithJs(@"
global.customCollections = [
  { id: 'w6', name: 'Work', parentId: null },
  { id: 'ALL_TOTAL', name: 'all_total', parentId: null }
];
eval(code);
renderSidebarNav = () => {};
moveCollectionToParent('w6', 'ALL_TOTAL');
let p = customCollections.find(c => c.id === 'w6').parentId || 'null';
process.stdout.write('parent=' + p);
"));
        Assert.Equal("parent=null", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk5_RenderExcludesSystemBucketsCaseInsensitively()
    {
        string output = RunNode(WithJs(@"
global.getCollectionClipCount = () => 0;
global.customCollections = [
  { id: 'w7', name: 'Work', parentId: null },
  { id: 'ALL', name: 'ALL', parentId: null },
  { id: 'Pins', name: 'Pins', parentId: null },
  { id: 'FAVORITES', name: 'FAVORITES', parentId: 'w7' },
  { id: 'All_Total', name: 'All_Total', parentId: null },
  { id: 'ALL_UNORGANIZED', name: 'ALL_UNORGANIZED', parentId: null }
];
eval(code);
renderSidebarNav();
let html = els['sidebarNav'].innerHTML;
let leaked = ['side_col_ALL', 'side_col_Pins', 'side_col_FAVORITES', 'side_col_All_Total', 'side_col_ALL_UNORGANIZED']
  .some(k => html.includes(k));
let kept = html.includes('side_col_w7');
process.stdout.write('leaked=' + leaked + ',kept=' + kept);
"));
        Assert.Equal("leaked=false,kept=true", output);
    }

    // ---------- RISK 7: Clip & text drag onto sidebar collection folders ----------

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_TextDropOntoNestedCollection_DoesNotMoveOrUnnestFolder()
    {
        string output = RunNode(WithJs(@"
let rpcCalls = [];
global.window.pywebview = { api: {} };
global.window.chrome = {
  webview: {
    postMessage: (msg) => { rpcCalls.push(msg); }
  }
};
global.customCollections = [
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
eval(code);
renderSidebarNav = () => {};
let fakeTextEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    types: ['text/plain'],
    getData: (format) => format === 'text/plain' ? 'Sample dropped text' : ''
  }
};
handleSidebarColDrop(fakeTextEvent, 'child_col');
let childParentAfter = customCollections.find(c => c.id === 'child_col').parentId;
let addedRpc = rpcCalls.find(call => call.method === 'add_text_to_collection');
let targetCol = addedRpc ? addedRpc.args[1] : 'none';
let droppedText = addedRpc ? addedRpc.args[0] : '';
process.stdout.write('parentStayed=' + (childParentAfter === 'parent_col') + ',targetCol=' + targetCol + ',hasText=' + (droppedText === 'Sample dropped text'));
"));
        Assert.Equal("parentStayed=true,targetCol=child_col,hasText=true", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_ClipDropOntoNestedCollection_RoutesToHandleCollectionPillDropWithoutMovingFolder()
    {
        string output = RunNode(WithJs(@"
let routedPillDrops = [];
global.handleCollectionPillDrop = (targetColId, colName, e) => {
  routedPillDrops.push({ targetColId, colName });
};
global.customCollections = [
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
eval(code);
renderSidebarNav = () => {};
let fakeClipEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    types: ['application/x-dualclip-clip-id'],
    getData: (format) => format === 'application/x-dualclip-clip-id' ? '42' : ''
  }
};
handleSidebarColDrop(fakeClipEvent, 'child_col');
let childParentAfter = customCollections.find(c => c.id === 'child_col').parentId;
let routedTarget = routedPillDrops.length > 0 ? routedPillDrops[0].targetColId : 'none';
let routedName = routedPillDrops.length > 0 ? routedPillDrops[0].colName : 'none';
process.stdout.write('parentStayed=' + (childParentAfter === 'parent_col') + ',routedTarget=' + routedTarget + ',routedName=' + routedName);
"));
        Assert.Equal("parentStayed=true,routedTarget=child_col,routedName=Child", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_HtmlTextDropOntoNestedCollection_ExtractsTextAndPreservesFolderHierarchy()
    {
        string output = RunNode(WithJs(@"
let rpcCalls = [];
global.window.pywebview = { api: {} };
global.window.chrome = {
  webview: {
    postMessage: (msg) => { rpcCalls.push(msg); }
  }
};
global.document.createElement = (tag) => {
  let inner = '';
  return {
    set innerHTML(val) { inner = val; },
    get innerHTML() { return inner; },
    get textContent() { return inner.replace(/<[^>]*>/g, ''); },
    get innerText() { return inner.replace(/<[^>]*>/g, ''); }
  };
};
global.customCollections = [
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
eval(code);
renderSidebarNav = () => {};
let fakeHtmlEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    types: ['text/html'],
    getData: (format) => format === 'text/html' ? '<b>Rich</b> text content' : ''
  }
};
handleSidebarColDrop(fakeHtmlEvent, 'child_col');
let childParentAfter = customCollections.find(c => c.id === 'child_col').parentId;
let addedRpc = rpcCalls.find(call => call.method === 'add_text_to_collection');
let targetCol = addedRpc ? addedRpc.args[1] : 'none';
let droppedText = addedRpc ? addedRpc.args[0] : '';
process.stdout.write('parentStayed=' + (childParentAfter === 'parent_col') + ',targetCol=' + targetCol + ',hasText=' + (droppedText === 'Rich text content'));
"));
        Assert.Equal("parentStayed=true,targetCol=child_col,hasText=true", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_BatchClipsDropOntoNestedCollection_ParsesAndRoutesBatchIds()
    {
        string output = RunNode(WithJs(@"
let routedPillDrops = [];
global.handleCollectionPillDrop = (targetColId, colName, e, parsedIds) => {
  routedPillDrops.push({ targetColId, colName, ids: parsedIds });
};
global.customCollections = [
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
eval(code);
renderSidebarNav = () => {};
let fakeBatchEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    types: ['application/x-dualclip-ids'],
    getData: (format) => format === 'application/x-dualclip-ids' ? JSON.stringify([101, 102, 'bad', 103]) : ''
  }
};
handleSidebarColDrop(fakeBatchEvent, 'child_col');
let childParentAfter = customCollections.find(c => c.id === 'child_col').parentId;
let routedTarget = routedPillDrops.length > 0 ? routedPillDrops[0].targetColId : 'none';
let validIds = routedPillDrops.length > 0 ? routedPillDrops[0].ids : [];
let containsBad = validIds.includes('bad');
process.stdout.write('parentStayed=' + (childParentAfter === 'parent_col') + ',routedTarget=' + routedTarget + ',validCount=' + validIds.length + ',containsBad=' + containsBad);
"));
        Assert.Equal("parentStayed=true,routedTarget=child_col,validCount=3,containsBad=false", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_InMemoryTrackedClipDrag_DropsOntoDeepNestedCollection_PreservesHierarchy()
    {
        string output = RunNode(WithJs(@"
let routedPillDrops = [];
global.handleCollectionPillDrop = (targetColId, colName, e, parsedIds) => {
  routedPillDrops.push({ targetColId, colName, ids: parsedIds });
};
global.customCollections = [
  { id: 'root_col', name: 'Root', parentId: null },
  { id: 'sub_col', name: 'Sub', parentId: 'root_col' },
  { id: 'deep_sub_col', name: 'Deep Sub', parentId: 'sub_col' }
];
global.window._draggedClipIds = [42, 99];
eval(code);
renderSidebarNav = () => {};
let fakeEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: null
};
handleSidebarColDrop(fakeEvent, 'deep_sub_col');
let deepParentAfter = customCollections.find(c => c.id === 'deep_sub_col').parentId;
let subParentAfter = customCollections.find(c => c.id === 'sub_col').parentId;
let routedTarget = routedPillDrops.length > 0 ? routedPillDrops[0].targetColId : 'none';
let routedIdsCount = routedPillDrops.length > 0 ? routedPillDrops[0].ids.length : 0;
let clearedGlobal = window._draggedClipIds === null;
process.stdout.write('deepParent=' + deepParentAfter + ',subParent=' + subParentAfter + ',target=' + routedTarget + ',count=' + routedIdsCount + ',cleared=' + clearedGlobal);
"));
        Assert.Equal("deepParent=sub_col,subParent=root_col,target=deep_sub_col,count=2,cleared=true", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_BadgeCountCapping_CapsAt99Plus()
    {
        string output = RunNode(WithJs(@"
eval(code);
let test0 = formatSidebarBadgeCount(0);
let test42 = formatSidebarBadgeCount(42);
let test99 = formatSidebarBadgeCount(99);
let test100 = formatSidebarBadgeCount(100);
let test500 = formatSidebarBadgeCount(500);
let testInvalid = formatSidebarBadgeCount('abc');
let testNegative = formatSidebarBadgeCount(-10);
process.stdout.write(test0 + '|' + test42 + '|' + test99 + '|' + test100 + '|' + test500 + '|' + testInvalid + '|' + testNegative);
"));
        Assert.Equal("0|42|99|99+|99+|0|0", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_StaleDragFlag_ClipDropTakesPrecedenceOverCollectionReorder()
    {
        string output = RunNode(WithJs(@"
let routedPillDrops = [];
global.handleCollectionPillDrop = (targetColId, colName, e, parsedIds) => {
  routedPillDrops.push({ targetColId, colName, ids: parsedIds });
};
global.customCollections = [
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
global.window._draggedClipIds = [123];
eval(code);
renderSidebarNav = () => {};
/* Simulate leftover collection drag flag with clip drag active */
let fakeEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
  dataTransfer: {
    types: ['application/x-dualclip-ids'],
    getData: (format) => format === 'application/x-dualclip-ids' ? JSON.stringify([123]) : ''
  }
};
handleSidebarColDrop(fakeEvent, 'child_col');
let childParentAfter = customCollections.find(c => c.id === 'child_col').parentId;
let routedTarget = routedPillDrops.length > 0 ? routedPillDrops[0].targetColId : 'none';
process.stdout.write('parentStayed=' + (childParentAfter === 'parent_col') + ',target=' + routedTarget);
"));
        Assert.Equal("parentStayed=true,target=child_col", output);
    }

    [Fact]
    [Trait("Category", "Core")]
    public void Risk7_StaleCollectionDragFlag_TextDropStillAddsTextWithoutMovingFolders()
    {
        string output = RunNode(WithJs(@"
let rpcCalls = [];
global.window.pywebview = { api: {} };
global.window.chrome = { webview: { postMessage: (msg) => { rpcCalls.push(msg); } } };
global.customCollections = [
  { id: 'sibling_col', name: 'Sibling', parentId: null },
  { id: 'parent_col', name: 'Parent', parentId: null },
  { id: 'child_col', name: 'Child', parentId: 'parent_col' }
];
eval(code);
renderSidebarNav = () => {};
let latchEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: '', setData: () => {}, getData: () => '', dropEffect: '' } };
handleSidebarColDragStart(latchEvent, 'sibling_col');
let fakeTextEvent = { preventDefault: () => {}, stopPropagation: () => {}, dataTransfer: { types: ['text/plain'], getData: (format) => format === 'text/plain' ? 'Latched-drag text drop' : '' } };
handleSidebarColDrop(fakeTextEvent, 'child_col');
let siblingParent = customCollections.find(c => c.id === 'sibling_col').parentId || 'null';
let childParent = customCollections.find(c => c.id === 'child_col').parentId;
let addedRpc = rpcCalls.find(call => call.method === 'add_text_to_collection');
let targetCol = addedRpc ? addedRpc.args[1] : 'none';
let droppedText = addedRpc ? addedRpc.args[0] : '';
process.stdout.write('sibling=' + siblingParent + ',child=' + childParent + ',targetCol=' + targetCol + ',hasText=' + (droppedText === 'Latched-drag text drop'));
"));
        Assert.Equal("sibling=null,child=parent_col,targetCol=child_col,hasText=true", output);
    }
}
