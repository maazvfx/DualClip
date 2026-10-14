using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using System.Drawing.Imaging;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using DualClip.Models;
using DualClip.Services;

namespace DualClip;

/// <summary>
/// JSON-RPC request intake and dispatch for the WebView2 host.
///
/// Extracted verbatim from MainForm.cs (M2: 5,000-line god class). This region
/// owns source-origin validation, the method dispatch switch, and the per-method
/// response plumbing. Pure relocation - no logic changes.
///
/// The dispatch contract is enforced by DualClip.Tests/RpcContractInvariantTests:
/// every `case "method"` label here must have a matching declared contract in
/// ui/js/core/rpc-contracts.js, and vice versa.
/// </summary>
public partial class MainForm
{
    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!string.IsNullOrEmpty(e.Source) && !e.Source.StartsWith("https://appassets.example", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        long rpcId = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;

            if (root.TryGetProperty("id", out var idElem) && idElem.ValueKind == JsonValueKind.Number)
            {
                rpcId = idElem.GetInt64();
            }

            string method = root.TryGetProperty("method", out var mElem) ? mElem.GetString() ?? "" : "";
            JsonElement args = root.TryGetProperty("args", out var aElem) ? aElem : default;

            switch (method)
            {
                case "start_drag":
                    ReleaseCapture();
                    SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "start_resize":
                    {
                        string dir = "bottom-right";
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String)
                        {
                            dir = args[0].GetString()?.ToLowerInvariant() ?? "bottom-right";
                        }
                        int ht = dir switch
                        {
                            "left" or "w" => HTLEFT,
                            "right" or "e" => HTRIGHT,
                            "top" or "n" => HTTOP,
                            "bottom" or "s" => HTBOTTOM,
                            "top-left" or "topleft" or "nw" => HTTOPLEFT,
                            "top-right" or "topright" or "ne" => HTTOPRIGHT,
                            "bottom-left" or "bottomleft" or "sw" => HTBOTTOMLEFT,
                            _ => HTBOTTOMRIGHT
                        };
                        ReleaseCapture();
                        SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)ht, IntPtr.Zero);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }

                case "hide_window":
                    HideWindow();
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "open_external_url":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String)
                    {
                        var rawUrl = args[0].GetString();
                        if (!string.IsNullOrWhiteSpace(rawUrl) && Uri.TryCreate(rawUrl, UriKind.Absolute, out var targetUri))
                        {
                            if (targetUri.Scheme == Uri.UriSchemeHttp || targetUri.Scheme == Uri.UriSchemeHttps)
                            {
                                try { Process.Start(new ProcessStartInfo(targetUri.AbsoluteUri) { UseShellExecute = true }); } catch { }
                            }
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "set_pinned":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        _userPinned = args[0].GetBoolean();
                        TopMost = _userPinned || _modalOpen;
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "get_pinned":
                    SendRpcResponse(rpcId, new { ok = true, pinned = _userPinned });
                    break;

                case "set_modal_open":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0
                        && TryGetBool(args[0], out bool modalFlag))
                    {
                        _modalOpen = modalFlag;
                        TopMost = _modalOpen || _userPinned;
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "window_show_ack":
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "get_clips":
                    HandleGetClips(rpcId, args);
                    break;

                case "paste_clip":
                    HandlePasteClip(rpcId, args);
                    break;

                case "paste_text":
                    HandlePasteText(rpcId, args);
                    break;

                case "paste_delete":
                    HandlePasteDelete(rpcId, args);
                    break;

                case "paste_multi":
                    HandlePasteMulti(rpcId, args);
                    break;

                case "copy_clip":
                case "set_clipboard_text":
                    HandleCopyClip(rpcId, args);
                    break;

                case "restore_clip":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        var item = ParseClipFromJsonElement(args[0]);
                        _ = Task.Run(() =>
                        {
                            long restoredId = _db.RestoreClip(item);
                            if (restoredId > 0)
                            {
                                var fullItem = _db.GetClipById(restoredId) ?? item;
                                var jsObj = FormatClipForJs(fullItem);
                                PostEventToJs("onClipAdded", jsObj);
                                SendRpcResponse(rpcId, new { ok = true, clip = jsObj, data = jsObj });
                            }
                            else
                            {
                                SendRpcResponse(rpcId, new { ok = false });
                            }
                        });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "delete_clip":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long deleteId))
                    {
                        _ = Task.Run(() =>
                        {
                            _db.DeleteClip(deleteId);
                            SendRpcResponse(rpcId, new { ok = true });
                        });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "toggle_pin":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long pinId))
                    {
                        _db.TogglePin(pinId);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "toggle_favorite":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long favId))
                    {
                        _db.ToggleFavorite(favId);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "get_paused":
                    SendRpcResponse(rpcId, new { ok = true, paused = _listener.IsPaused });
                    break;

                case "set_paused":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        bool paused = args[0].GetBoolean();
                        _timedPauseTimer?.Dispose();
                        _timedPauseTimer = null;
                        _timedPauseEndTime = null;
                        _listener.IsPaused = paused;
                        BeginInvoke(() => _tray.SetPaused(paused));
                        var cur = AppSettings.Load();
                        cur.IsPaused = paused;
                        if (!paused) cur.PausedUntilUtc = null;
                        AppSettings.Save(cur);
                        PostEventToJs("onPauseChanged", new { paused });
                        PostEventToJs("onCaptureStateChanged", new { paused, is_timed = false, remaining_seconds = 0 });
                    }
                    SendRpcResponse(rpcId, new { ok = true, paused = _listener.IsPaused });
                    break;

                case "set_timed_incognito":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        double minutes = args[0].GetDouble();
                        if (minutes > 0)
                        {
                            _timedPauseTimer?.Dispose();
                            _timedPauseEndTime = DateTime.UtcNow.AddMinutes(minutes);
                            _listener.IsPaused = true;
                            BeginInvoke(() => _tray.SetPaused(true, $"{minutes}m", (int)minutes));
                            var cur = AppSettings.Load();
                            cur.IsPaused = true;
                            cur.PausedUntilUtc = _timedPauseEndTime;
                            AppSettings.Save(cur);
                            _timedPauseTimer = new System.Threading.Timer(_ =>
                            {
                                BeginInvoke(() =>
                                {
                                    _timedPauseTimer?.Dispose();
                                    _timedPauseTimer = null;
                                    _timedPauseEndTime = null;
                                    _listener.IsPaused = false;
                                    _tray.SetPaused(false);
                                    var cur2 = AppSettings.Load();
                                    cur2.IsPaused = false;
                                    cur2.PausedUntilUtc = null;
                                    AppSettings.Save(cur2);
                                    PostEventToJs("onPauseChanged", new { paused = false });
                                    PostEventToJs("onCaptureStateChanged", new { paused = false, is_timed = false, remaining_seconds = 0 });
                                });
                            }, null, TimeSpan.FromMinutes(minutes), Timeout.InfiniteTimeSpan);
                            PostEventToJs("onPauseChanged", new { paused = true });
                            PostEventToJs("onCaptureStateChanged", new { paused = true, is_timed = true, remaining_seconds = minutes * 60 });
                            SendRpcResponse(rpcId, new { ok = true, paused = true, is_timed = true, remaining_seconds = minutes * 60 });
                            break;
                        }
                        else
                        {
                            _timedPauseTimer?.Dispose();
                            _timedPauseTimer = null;
                            _timedPauseEndTime = null;
                            _listener.IsPaused = false;
                            BeginInvoke(() => _tray.SetPaused(false));
                            var cur = AppSettings.Load();
                            cur.IsPaused = false;
                            cur.PausedUntilUtc = null;
                            AppSettings.Save(cur);
                            PostEventToJs("onPauseChanged", new { paused = false });
                            PostEventToJs("onCaptureStateChanged", new { paused = false, is_timed = false, remaining_seconds = 0 });
                            SendRpcResponse(rpcId, new { ok = true, paused = false, is_timed = false, remaining_seconds = 0 });
                            break;
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_incognito_status":
                    bool isCurPaused = _listener.IsPaused;
                    double remainingSecs = 0;
                    bool isTimedIncog = false;
                    if (isCurPaused && _timedPauseEndTime.HasValue)
                    {
                        var diff = (_timedPauseEndTime.Value - DateTime.UtcNow).TotalSeconds;
                        if (diff > 0)
                        {
                            remainingSecs = diff;
                            isTimedIncog = true;
                        }
                        else
                        {
                            _timedPauseTimer?.Dispose();
                            _timedPauseTimer = null;
                            _timedPauseEndTime = null;
                            _listener.IsPaused = false;
                            _tray.SetPaused(false);
                            var cur = AppSettings.Load();
                            cur.IsPaused = false;
                            cur.PausedUntilUtc = null;
                            AppSettings.Save(cur);
                            isCurPaused = false;
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = true, paused = isCurPaused, is_timed = isTimedIncog, remaining_seconds = remainingSecs });
                    break;

                case "get_running_apps":
                    List<RunningAppInfo> running = new();
                    try { running = AppDiscoveryService.ListRunningApps(includeIcons: true); } catch { }
                    List<string> dbApps = new();
                    try { dbApps = _db.GetDistinctApps(); } catch { }
                    var resApps = running.Select(a => new {
                        process = a.Process,
                        name = a.Name,
                        title = a.Title,
                        icon = a.IconDataUrl
                    }).ToList();
                    SendRpcResponse(rpcId, new { ok = true, apps = resApps, db_apps = dbApps, data = resApps });
                    break;

                case "move_to_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2 && TryGetClipId(args[0], out long moveId))
                    {
                        string col = args[1].GetString() ?? "all";
                        _ = Task.Run(() =>
                        {
                            bool moved = _db.SetCollection(moveId, col);
                            SendRpcResponse(rpcId, new { ok = moved });
                        });
                    }
                    else
                    {
                        SendRpcResponse(rpcId, new { ok = false });
                    }
                    break;

                case "set_custom_title":
                    {
                        long id = -1;
                        string title = "";
                        bool parsed = false;

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            var titleIdElem = args[0];
                            if (titleIdElem.ValueKind == JsonValueKind.Number && titleIdElem.TryGetInt64(out id))
                            {
                                parsed = true;
                            }
                            else if (titleIdElem.ValueKind == JsonValueKind.String && long.TryParse(titleIdElem.GetString(), out id))
                            {
                                parsed = true;
                            }
                            title = args[1].ValueKind == JsonValueKind.String ? args[1].GetString() ?? "" : "";
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("id", out var idProp) || args.TryGetProperty("clipId", out idProp))
                            {
                                if (idProp.ValueKind == JsonValueKind.Number && idProp.TryGetInt64(out id))
                                {
                                    parsed = true;
                                }
                                else if (idProp.ValueKind == JsonValueKind.String && long.TryParse(idProp.GetString(), out id))
                                {
                                    parsed = true;
                                }
                            }
                            if (args.TryGetProperty("title", out var titleProp) || args.TryGetProperty("customTitle", out titleProp) || args.TryGetProperty("custom_title", out titleProp))
                            {
                                title = titleProp.ValueKind == JsonValueKind.String ? titleProp.GetString() ?? "" : "";
                            }
                        }

                        if (!parsed || id <= 0)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = "invalid_clip_id" });
                            break;
                        }

                        _ = Task.Run(() =>
                        {
                            bool saved;
                            try
                            {
                                saved = _db.SetCustomTitle(id, title);
                            }
                            catch (Exception titleEx)
                            {
                                SendRpcResponse(rpcId, new { ok = false, error = titleEx.Message });
                                return;
                            }
                            if (!saved)
                            {
                                SendRpcResponse(rpcId, new { ok = false, error = "clip_not_found" });
                                return;
                            }

                            SendRpcResponse(rpcId, new { ok = true });
                        });
                    }
                    break;

                case "set_nickname":
                    {
                        long id = -1;
                        string nick = "";
                        bool parsed = false;

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            var nickIdElem = args[0];
                            if (nickIdElem.ValueKind == JsonValueKind.Number && nickIdElem.TryGetInt64(out id))
                            {
                                parsed = true;
                            }
                            else if (nickIdElem.ValueKind == JsonValueKind.String && long.TryParse(nickIdElem.GetString(), out id))
                            {
                                parsed = true;
                            }
                            nick = args[1].ValueKind == JsonValueKind.String ? args[1].GetString() ?? "" : "";
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("id", out var idProp) || args.TryGetProperty("clipId", out idProp))
                            {
                                if (idProp.ValueKind == JsonValueKind.Number && idProp.TryGetInt64(out id))
                                {
                                    parsed = true;
                                }
                                else if (idProp.ValueKind == JsonValueKind.String && long.TryParse(idProp.GetString(), out id))
                                {
                                    parsed = true;
                                }
                            }
                            if (args.TryGetProperty("nickname", out var nickProp) || args.TryGetProperty("label", out nickProp))
                            {
                                nick = nickProp.ValueKind == JsonValueKind.String ? nickProp.GetString() ?? "" : "";
                            }
                        }

                        if (!parsed || id <= 0)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = "invalid_clip_id" });
                            break;
                        }

                        _ = Task.Run(() =>
                        {
                            bool saved;
                            try
                            {
                                saved = _db.SetNickname(id, nick);
                            }
                            catch (Exception nickEx)
                            {
                                SendRpcResponse(rpcId, new { ok = false, error = nickEx.Message });
                                return;
                            }
                            if (!saved)
                            {
                                SendRpcResponse(rpcId, new { ok = false, error = "clip_not_found" });
                                return;
                            }

                            SendRpcResponse(rpcId, new { ok = true });
                        });
                    }
                    break;

                case "set_tags_for_clip":
                    {
                        long id = -1;
                        var tagsList = new List<string>();

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            var tagClipIdElem = args[0];
                            if (tagClipIdElem.ValueKind == JsonValueKind.Number) tagClipIdElem.TryGetInt64(out id);
                            else if (tagClipIdElem.ValueKind == JsonValueKind.String) long.TryParse(tagClipIdElem.GetString(), out id);

                            var tagsElem = args[1];
                            if (tagsElem.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in tagsElem.EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                            else if (tagsElem.ValueKind == JsonValueKind.String)
                            {
                                tagsList.AddRange((tagsElem.GetString() ?? "").Split(new[] { ',', '，' }, StringSplitOptions.RemoveEmptyEntries));
                            }
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("id", out var idProp) || args.TryGetProperty("clipId", out idProp))
                            {
                                if (idProp.ValueKind == JsonValueKind.Number) idProp.TryGetInt64(out id);
                                else if (idProp.ValueKind == JsonValueKind.String) long.TryParse(idProp.GetString(), out id);
                            }
                            if (args.TryGetProperty("tags", out var tagsProp) && tagsProp.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in tagsProp.EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                        }

                        if (id <= 0)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = "invalid_clip_id" });
                            break;
                        }

                        _ = Task.Run(() =>
                        {
                            bool ok = _db.SetTagsForClip(id, tagsList);
                            SendRpcResponse(rpcId, new { ok });
                        });
                    }
                    break;

                case "batch_add_tags":
                    {
                        var clipIds = new List<long>();
                        var tagsList = new List<string>();

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            if (args[0].ValueKind == JsonValueKind.Array)
                            {
                                foreach (var elem in args[0].EnumerateArray())
                                {
                                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var cid)) clipIds.Add(cid);
                                    else if (elem.ValueKind == JsonValueKind.String && long.TryParse(elem.GetString(), out var cidStr)) clipIds.Add(cidStr);
                                }
                            }
                            if (args[1].ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in args[1].EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("clipIds", out var idsProp) && idsProp.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var elem in idsProp.EnumerateArray())
                                {
                                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var cid)) clipIds.Add(cid);
                                    else if (elem.ValueKind == JsonValueKind.String && long.TryParse(elem.GetString(), out var cidStr)) clipIds.Add(cidStr);
                                }
                            }
                            if (args.TryGetProperty("tags", out var tagsProp) && tagsProp.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in tagsProp.EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                        }

                        int modified = _db.AddTagsToClips(clipIds, tagsList);
                        SendRpcResponse(rpcId, new { ok = true, modifiedCount = modified });
                    }
                    break;

                case "batch_remove_tags":
                    {
                        var clipIds = new List<long>();
                        var tagsList = new List<string>();

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            if (args[0].ValueKind == JsonValueKind.Array)
                            {
                                foreach (var elem in args[0].EnumerateArray())
                                {
                                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var cid)) clipIds.Add(cid);
                                    else if (elem.ValueKind == JsonValueKind.String && long.TryParse(elem.GetString(), out var cidStr)) clipIds.Add(cidStr);
                                }
                            }
                            if (args[1].ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in args[1].EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("clipIds", out var idsProp) && idsProp.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var elem in idsProp.EnumerateArray())
                                {
                                    if (elem.ValueKind == JsonValueKind.Number && elem.TryGetInt64(out var cid)) clipIds.Add(cid);
                                    else if (elem.ValueKind == JsonValueKind.String && long.TryParse(elem.GetString(), out var cidStr)) clipIds.Add(cidStr);
                                }
                            }
                            if (args.TryGetProperty("tags", out var tagsProp) && tagsProp.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var t in tagsProp.EnumerateArray())
                                {
                                    if (t.ValueKind == JsonValueKind.String) tagsList.Add(t.GetString() ?? "");
                                }
                            }
                        }

                        int modified = _db.RemoveTagsFromClips(clipIds, tagsList);
                        SendRpcResponse(rpcId, new { ok = true, modifiedCount = modified });
                    }
                    break;

                case "get_tags_for_clip":
                    {
                        long clipId = -1;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                        {
                            if (args[0].ValueKind == JsonValueKind.Number) args[0].TryGetInt64(out clipId);
                            else if (args[0].ValueKind == JsonValueKind.String) long.TryParse(args[0].GetString(), out clipId);
                        }
                        var tags = clipId > 0 ? _db.GetTagsForClip(clipId) : new List<string>();
                        SendRpcResponse(rpcId, new { ok = true, tags });
                    }
                    break;

                case "get_tag_stats":
                case "get_all_tags_with_stats":
                    {
                        string tagName = "";
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String)
                        {
                            tagName = args[0].GetString() ?? "";
                        }
                        else if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("tagName", out var tnProp))
                        {
                            tagName = tnProp.GetString() ?? "";
                        }

                        if (!string.IsNullOrWhiteSpace(tagName))
                        {
                            var stat = _db.GetTagStats(tagName);
                            SendRpcResponse(rpcId, new { ok = true, stat, stats = stat != null ? new List<TagInfo> { stat } : new List<TagInfo>() });
                        }
                        else
                        {
                            var stats = _db.GetAllTagsWithStats();
                            SendRpcResponse(rpcId, new { ok = true, stats });
                        }
                    }
                    break;

                case "get_suggested_tags":
                    {
                        int limit = 10;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.Number)
                        {
                            limit = args[0].GetInt32();
                        }
                        var tags = _db.GetSuggestedTags(limit);
                        SendRpcResponse(rpcId, new { ok = true, tags });
                    }
                    break;

                case "rename_tag":
                    {
                        string oldName = "";
                        string newName = "";

                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                        {
                            oldName = args[0].GetString() ?? "";
                            newName = args[1].GetString() ?? "";
                        }
                        else if (args.ValueKind == JsonValueKind.Object)
                        {
                            if (args.TryGetProperty("oldName", out var oldProp)) oldName = oldProp.GetString() ?? "";
                            if (args.TryGetProperty("newName", out var newProp)) newName = newProp.GetString() ?? "";
                        }

                        bool ok = _db.RenameTag(oldName, newName);
                        SendRpcResponse(rpcId, new { ok });
                    }
                    break;

                case "delete_tag":
                    {
                        string tagName = "";
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                        {
                            tagName = args[0].GetString() ?? "";
                        }
                        else if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("tagName", out var tagProp))
                        {
                            tagName = tagProp.GetString() ?? "";
                        }

                        bool ok = _db.DeleteTag(tagName);
                        SendRpcResponse(rpcId, new { ok });
                    }
                    break;

                case "update_clip":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2 && TryGetClipId(args[0], out long updateId))
                    {
                        string newText = args[1].GetString() ?? "";
                        if (newText.Length > ClipboardListener.MaxTextChars)
                        {
                            newText = newText.Substring(0, ClipboardListener.MaxTextChars);
                        }
                        _db.UpdateText(updateId, newText);
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "add_clip":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string text = args[0].GetString() ?? "";
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            if (text.Length > ClipboardListener.MaxTextChars)
                            {
                                text = text.Substring(0, ClipboardListener.MaxTextChars);
                            }
                            var (newId, isNew) = _db.AddOrBump(text, "manual", "DualClip.exe", "Manual Entry", "all");
                            string? dcIcon = AppIconStore.GetCachedOrQueueExtract("DualClip.exe") ?? AppIconStore.GetCachedOrQueueExtract("DualClip");
                            SendRpcResponse(rpcId, new { ok = true, id = newId, app_icon = dcIcon });
                            break;
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "add_text_to_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string dropText = args[0].GetString() ?? "";
                        string targetCol = args.GetArrayLength() > 1 ? args[1].GetString() ?? "all" : "all";
                        bool isFav = args.GetArrayLength() > 2 && TryGetBool(args[2], out bool favVal) && favVal;
                        if (!string.IsNullOrWhiteSpace(dropText))
                        {
                            if (ClipboardListener.TryParseSvg(dropText, out string dims, out string? sanitizedSvg) && sanitizedSvg != null)
                            {
                                byte[] svgBytes = Encoding.UTF8.GetBytes(sanitizedSvg);
                                var hash = Convert.ToHexString(SHA256.HashData(svgBytes));
                                var imagesDir = PathHelper.GetImagesFolder();
                                var imageFilePath = Path.Combine(imagesDir, $"{hash}.svg");
                                if (!File.Exists(imageFilePath))
                                {
                                    try { File.WriteAllBytes(imageFilePath, svgBytes); } catch { }
                                }
                                string thumbData = $"data:image/svg+xml;base64,{Convert.ToBase64String(svgBytes)}";
                                string sizeStr = svgBytes.Length < 1024 ? $"{svgBytes.Length} B SVG" : $"{Math.Max(1, svgBytes.Length / 1024)} KB SVG";
                                var (id, isNew) = _db.AddOrBumpSvg(hash, sanitizedSvg, imageFilePath, thumbData, dims, sizeStr, "manual", "drop", "Drag & Drop", targetCol);
                                if (id > 0 && isFav)
                                {
                                    _db.SetFavorite(id, true);
                                }
                                if (id > 0)
                                {
                                    PostEventToJs("refreshClips", new { });
                                    SendRpcResponse(rpcId, new { ok = true, id, isNew, collection = targetCol });
                                    break;
                                }
                            }
                            else
                            {
                                if (dropText.Length > ClipboardListener.MaxTextChars)
                                {
                                    dropText = dropText.Substring(0, ClipboardListener.MaxTextChars);
                                }

                                var (id, isNew) = _db.AddOrBumpToCollection(dropText, targetCol, isFav, "drop", "Drag & Drop");
                                if (id > 0)
                                {
                                    PostEventToJs("refreshClips", new { });
                                    SendRpcResponse(rpcId, new { ok = true, id, isNew, collection = targetCol });
                                    break;
                                }
                            }
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "rename_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        string colId = args[0].GetString() ?? "";
                        string newName = args[1].GetString() ?? "";
                        bool ok = _db.RenameCollection(colId, newName);
                        if (ok)
                        {
                            var defs = _db.GetCollections();
                            var def = defs.Find(d => string.Equals(d.Id, colId.Trim(), StringComparison.OrdinalIgnoreCase));
                            _db.SaveCollection(colId, newName, def?.Pinned ?? false, def?.SortOrder ?? 0, def?.ParentId);
                        }
                        SendRpcResponse(rpcId, new { ok = ok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "save_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        string saveId = args[0].GetString() ?? "";
                        string saveName = args[1].GetString() ?? "";
                        bool savePinned = args.GetArrayLength() >= 3 && args[2].ValueKind == JsonValueKind.True;
                        int saveOrder = 0;
                        if (args.GetArrayLength() >= 4 && args[3].ValueKind == JsonValueKind.Number && args[3].TryGetInt32(out int so)) saveOrder = so;
                        string? parentId = null;
                        if (args.GetArrayLength() >= 5 && args[4].ValueKind == JsonValueKind.String) parentId = args[4].GetString();
                        bool sok = _db.SaveCollection(saveId, saveName, savePinned, saveOrder, parentId);
                        SendRpcResponse(rpcId, new { ok = sok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_collection_parent":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 1)
                    {
                        string colId = args[0].GetString() ?? "";
                        string? parentId = null;
                        if (args.GetArrayLength() >= 2 && args[1].ValueKind == JsonValueKind.String)
                        {
                            parentId = args[1].GetString();
                            if (string.IsNullOrWhiteSpace(parentId)) parentId = null;
                        }
                        bool ok = _db.SetCollectionParent(colId, parentId);
                        SendRpcResponse(rpcId, new { ok = ok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "delete_collection_def":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 1)
                    {
                        string delId = args[0].GetString() ?? "";
                        bool deleteClips = args.GetArrayLength() >= 2 && args[1].ValueKind == JsonValueKind.True;
                        bool dok = deleteClips ? _db.DeleteCollectionWithClips(delId) : _db.DeleteCollectionDef(delId);
                        if (_db.LastBackupError != null)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = _db.LastBackupError });
                            break;
                        }
                        SendRpcResponse(rpcId, new { ok = dok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_collections":
                    {
                        var defs = _db.GetCollections();
                        SendRpcResponse(rpcId, new { ok = true, collections = defs.Select(d => new { id = d.Id, name = d.Name, pinned = d.Pinned, sortOrder = d.SortOrder, parentId = d.ParentId }) });
                    }
                    break;

                case "get_collection_counts":
                    {
                        var data = _db.GetCollectionCountsData();
                        var totals = new Dictionary<string, int>
                        {
                            ["all_total"] = data.AllTotal,
                            ["all_unorganized"] = data.AllUnorganized,
                            ["pins"] = data.Pins,
                            ["most_used"] = data.MostUsed
                        };
                        SendRpcResponse(rpcId, new { ok = true, counts = data.Collections, totals = totals });
                    }
                    break;

                case "get_clear_stats":
                    {
                        var stats = _db.GetClearStats();
                        SendRpcResponse(rpcId, new { 
                            ok = true, 
                            unpinned = stats.unpinned, 
                            images = stats.images, 
                            pinned = stats.pinned, 
                            starred = stats.starred, 
                            collections = stats.collections 
                        });
                    }
                    break;

                case "reassign_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        string fromId = args[0].GetString() ?? "";
                        string toId = args[1].GetString() ?? "all";
                        bool rok = _db.ReassignCollection(fromId, toId);
                        if (rok) PostEventToJs("refreshClips", new { });
                        SendRpcResponse(rpcId, new { ok = rok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "migrate_collection_keys":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 1 && args[0].ValueKind == JsonValueKind.Array)
                    {
                        var pairs = new List<(string id, string name)>();
                        foreach (var el in args[0].EnumerateArray())
                        {
                            if (el.ValueKind != JsonValueKind.Object) continue;
                            string pid = el.TryGetProperty("id", out var idp) && idp.ValueKind == JsonValueKind.String ? idp.GetString() ?? "" : "";
                            string pname = el.TryGetProperty("name", out var nmp) && nmp.ValueKind == JsonValueKind.String ? nmp.GetString() ?? "" : "";
                            if (!string.IsNullOrWhiteSpace(pid) && !string.IsNullOrWhiteSpace(pname)) pairs.Add((pid, pname));
                        }
                        int moved = _db.MigrateCollectionKeys(pairs);
                        if (moved > 0) PostEventToJs("refreshClips", new { });
                        SendRpcResponse(rpcId, new { ok = true, migrated = moved });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "merge_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        string src = args[0].GetString() ?? "";
                        string tgt = args[1].GetString() ?? "";
                        bool ok = _db.MergeCollection(src, tgt);
                        SendRpcResponse(rpcId, new { ok = ok });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "clear_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        bool anyCleared = false;
                        for (int i = 0; i < args.GetArrayLength(); i++)
                        {
                            string col = args[i].GetString() ?? "";
                            if (!string.IsNullOrWhiteSpace(col))
                            {
                                anyCleared |= _db.DeleteClipsInCollection(col, true);
                            }
                        }
                        if (_db.LastBackupError != null)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = _db.LastBackupError });
                            break;
                        }
                        PostEventToJs("refreshClips", new { });
                        SendRpcResponse(rpcId, new { ok = true, cleared = anyCleared });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "delete_clips_in_collection":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string delCol = args[0].GetString() ?? "";
                        if (string.IsNullOrWhiteSpace(delCol))
                        {
                            SendRpcResponse(rpcId, new { ok = false });
                            break;
                        }
                        _db.DeleteClipsInCollection(delCol, false);
                        if (_db.LastBackupError != null)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = _db.LastBackupError });
                            break;
                        }
                        PostEventToJs("refreshClips", new { });
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "export_clips":
                    string scopeJson = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 ? args[0].GetRawText() : "{}";
                    BeginInvoke(() => HandleExportClips(rpcId, scopeJson));
                    break;

                case "import_into_collection":
                    string impCol = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 ? args[0].GetString() ?? "all" : "all";
                    BeginInvoke(() => HandleImportIntoCollection(rpcId, impCol));
                    break;

                case "import_dropped_package":
                    string dropPath = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 ? args[0].GetString() ?? "" : "";
                    Task.Run(() => ExecutePackageImport(dropPath, "all", rpcId));
                    break;

                case "import_package_base64":
                    string pkgFileName = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 ? args[0].GetString() ?? "import.dualclip" : "import.dualclip";
                    string pkgB64 = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 1 ? args[1].GetString() ?? "" : "";
                    Task.Run(() => HandleImportPackageBase64(rpcId, pkgFileName, pkgB64));
                    break;

                case "set_autostart":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool enable))
                    {
                        var s = AppSettings.Load();
                        s.StartWithWindows = enable;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, enabled = enable });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_autostart":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.GetStartWithWindows() });
                    break;

                case "set_start_hidden":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool hidden))
                    {
                        var s = AppSettings.Load();
                        s.StartHidden = hidden;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, start_hidden = hidden });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_start_hidden":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().StartHidden, start_hidden = AppSettings.Load().StartHidden });
                    break;

                case "set_hotkey":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 5 &&
                        TryGetBool(args[0], out bool win) &&
                        TryGetBool(args[1], out bool ctrl) &&
                        TryGetBool(args[2], out bool alt) &&
                        TryGetBool(args[3], out bool shift) &&
                        TryGetInt(args[4], out int vk))
                    {
                        bool registered = _hotkeys.UpdateCustomHotkey(win, ctrl, alt, shift, vk);
                        if (registered)
                        {
                            var s = AppSettings.Load();
                            s.HotkeyWin = win;
                            s.HotkeyCtrl = ctrl;
                            s.HotkeyAlt = alt;
                            s.HotkeyShift = shift;
                            s.HotkeyVk = vk;
                            AppSettings.Save(s);
                            SendRpcResponse(rpcId, new { ok = true, win, ctrl, alt, shift, vk });
                        }
                        else
                        {
                            var s = AppSettings.Load();
                            s.HotkeyWin = false;
                            s.HotkeyCtrl = true;
                            s.HotkeyAlt = false;
                            s.HotkeyShift = true;
                            s.HotkeyVk = (int)Keys.V;
                            AppSettings.Save(s);
                            SendRpcResponse(rpcId, new { ok = false, fallback = "Ctrl+Shift+V", win = false, ctrl = true, alt = false, shift = true, vk = (int)Keys.V });
                        }
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_hotkey":
                    var curHot = AppSettings.Load();
                    SendRpcResponse(rpcId, new
                    {
                        ok = true,
                        win = curHot.HotkeyWin,
                        ctrl = curHot.HotkeyCtrl,
                        alt = curHot.HotkeyAlt,
                        shift = curHot.HotkeyShift,
                        vk = curHot.HotkeyVk,
                        key = curHot.HotkeyVk
                    });
                    break;

                case "set_ignore_passwords":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool ign))
                    {
                        var s = AppSettings.Load();
                        s.IgnorePasswords = ign;
                        AppSettings.Save(s);
                        _listener.IgnorePasswords = ign;
                        SendRpcResponse(rpcId, new { ok = true, ignore = ign });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_ignore_passwords":
                    var curIgn = AppSettings.Load();
                    SendRpcResponse(rpcId, new { ok = true, ignore = curIgn.IgnorePasswords, enabled = curIgn.IgnorePasswords });
                    break;

                case "set_capture_images":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool cap))
                    {
                        var s = AppSettings.Load();
                        s.CaptureImages = cap;
                        AppSettings.Save(s);
                        _listener.CaptureImages = cap;
                        SendRpcResponse(rpcId, new { ok = true, capture = cap });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_capture_images":
                    SendRpcResponse(rpcId, new { ok = true, capture = AppSettings.Load().CaptureImages, enabled = AppSettings.Load().CaptureImages });
                    break;

                case "set_capture_filters":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2 &&
                        TryGetInt(args[0], out int minLen) &&
                        TryGetBool(args[1], out bool ignoreWs))
                    {
                        var s = AppSettings.Load();
                        s.MinClipLength = minLen;
                        s.IgnoreWhitespaceOnly = ignoreWs;
                        AppSettings.Save(s);
                        _listener.MinClipLength = minLen;
                        _listener.IgnoreWhitespaceOnly = ignoreWs;
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_capture_filters":
                    var sFilter = AppSettings.Load();
                    SendRpcResponse(rpcId, new { ok = true, min_length = sFilter.MinClipLength, ignore_whitespace = sFilter.IgnoreWhitespaceOnly });
                    break;

                case "set_blocklist":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2 && TryGetBool(args[0], out bool blkEnable))
                    {
                        var apps = new List<string>();
                        if (args[1].ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in args[1].EnumerateArray())
                            {
                                var str = item.GetString();
                                if (!string.IsNullOrWhiteSpace(str)) apps.Add(str.Trim());
                            }
                        }
                        var s = AppSettings.Load();
                        s.EnableBlocklist = blkEnable;
                        s.BlocklistedApps = apps;
                        AppSettings.Save(s);
                        _listener.ApplySettings(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_blocklist":
                    var sBlock = AppSettings.Load();
                    SendRpcResponse(rpcId, new { ok = true, enabled = sBlock.EnableBlocklist, apps = sBlock.BlocklistedApps, blocklist = sBlock.BlocklistedApps, double_copy_override = sBlock.DoubleCopyOverride });
                    break;

                case "set_double_copy_override":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool dco))
                    {
                        var s = AppSettings.Load();
                        s.DoubleCopyOverride = dco;
                        AppSettings.Save(s);
                        _listener.DoubleCopyOverride = dco;
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_double_copy_override":
                    var sDco = AppSettings.Load();
                    SendRpcResponse(rpcId, new { ok = true, enabled = sDco.DoubleCopyOverride });
                    break;

                case "set_auto_sort_rules":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.Array)
                    {
                        var rules = new List<AutoSortRuleEntry>();
                        foreach (var r in args[0].EnumerateArray())
                        {
                            string type = r.TryGetProperty("type", out var te) ? te.GetString() ?? "process" : "process";
                            string pat = (r.TryGetProperty("pattern", out var pate) ? pate.GetString() : null)
                                      ?? (r.TryGetProperty("process", out var pe) ? pe.GetString() : null)
                                      ?? "";
                            string proc = r.TryGetProperty("process", out var oldPe) ? oldPe.GetString() ?? pat : pat;
                            string col = (r.TryGetProperty("collectionId", out var cid) ? cid.GetString() : null)
                                      ?? (r.TryGetProperty("collection", out var ce) ? ce.GetString() : null)
                                      ?? "all";
                            if (!string.IsNullOrWhiteSpace(pat) || !string.IsNullOrWhiteSpace(proc))
                            {
                                rules.Add(new AutoSortRuleEntry
                                {
                                    Type = string.IsNullOrWhiteSpace(type) ? "process" : type.Trim().ToLowerInvariant(),
                                    Pattern = pat.Trim(),
                                    Process = proc.Trim(),
                                    Collection = col.Trim()
                                });
                            }
                        }
                        var s = AppSettings.Load();
                        s.AutoSortRules = rules;
                        AppSettings.Save(s);
                        _listener.ApplySettings(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_auto_sort_rules":
                    SendRpcResponse(rpcId, new { ok = true, rules = AppSettings.Load().AutoSortRules });
                    break;

                case "set_suppress_in_fullscreen":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0
                        && (args[0].ValueKind == JsonValueKind.True || args[0].ValueKind == JsonValueKind.False))
                    {
                        var s = AppSettings.Load();
                        s.SuppressInFullscreen = args[0].GetBoolean();
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, suppress_in_fullscreen = s.SuppressInFullscreen });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_suppress_in_fullscreen":
                    SendRpcResponse(rpcId, new { ok = true, suppress_in_fullscreen = AppSettings.Load().SuppressInFullscreen });
                    break;

                case "set_max_clips":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetInt(args[0], out int max))
                    {
                        var s = AppSettings.Load();
                        s.MaxClips = max;
                        AppSettings.Save(s);
                        _db.EnforceMaxClips(max);
                        SendRpcResponse(rpcId, new { ok = true, max_clips = max });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_storage_stats":
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var storageStats = _db.GetStorageStats();
                            SendRpcResponse(rpcId, storageStats);
                        }
                        catch (Exception ex)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
                        }
                    });
                    break;

                case "get_usage_stats":
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var usageStats = _db.GetUsageStats();
                            SendRpcResponse(rpcId, usageStats);
                        }
                        catch (Exception ex)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
                        }
                    });
                    break;

                case "reset_usage_stats":
                    _db.ResetUsageStats();
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "set_supporter_status":
                    {
                        bool isSupporter = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].GetBoolean();
                        _db.SetConfig("is_supporter", isSupporter ? "1" : "0");
                        try
                        {
                            var suppSettings = AppSettings.Load();
                            suppSettings.IsSupporter = isSupporter;
                            AppSettings.Save(suppSettings);
                        }
                        catch { }
                        SendRpcResponse(rpcId, new { ok = true, is_supporter = isSupporter });
                        break;
                    }

                case "get_supporter_status":
                    string? suppVal = _db.GetConfig("is_supporter");
                    bool isSupp = suppVal == "1" || AppSettings.Load().IsSupporter;
                    SendRpcResponse(rpcId, new { ok = true, is_supporter = isSupp });
                    break;

                case "clear_history":
                    {
                        bool includePinned = args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].GetBoolean();
                        List<string>? excluded = null;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 1 && args[1].ValueKind == JsonValueKind.Array)
                        {
                            excluded = new List<string>();
                            foreach (var item in args[1].EnumerateArray())
                            {
                                var str = item.GetString();
                                if (!string.IsNullOrWhiteSpace(str)) excluded.Add(str.Trim());
                            }
                        }
                        bool keepStarred = true;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 2)
                        {
                            if (args[2].ValueKind == JsonValueKind.True || args[2].ValueKind == JsonValueKind.False)
                            {
                                keepStarred = args[2].GetBoolean();
                            }
                        }
                        bool deleteUnpinned = true;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 3)
                        {
                            if (args[3].ValueKind == JsonValueKind.True || args[3].ValueKind == JsonValueKind.False)
                            {
                                deleteUnpinned = args[3].GetBoolean();
                            }
                        }
                        bool deleteImages = true;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 4)
                        {
                            if (args[4].ValueKind == JsonValueKind.True || args[4].ValueKind == JsonValueKind.False)
                            {
                                deleteImages = args[4].GetBoolean();
                            }
                        }
                        List<string>? colPinned = null;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 5 && args[5].ValueKind == JsonValueKind.Array)
                        {
                            colPinned = new List<string>();
                            foreach (var item in args[5].EnumerateArray())
                            {
                                var str = item.GetString();
                                if (!string.IsNullOrWhiteSpace(str)) colPinned.Add(str.Trim());
                            }
                        }
                        List<string>? colStarred = null;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 6 && args[6].ValueKind == JsonValueKind.Array)
                        {
                            colStarred = new List<string>();
                            foreach (var item in args[6].EnumerateArray())
                            {
                                var str = item.GetString();
                                if (!string.IsNullOrWhiteSpace(str)) colStarred.Add(str.Trim());
                            }
                        }
                        List<string>? delCols = null;
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 7 && args[7].ValueKind == JsonValueKind.Array)
                        {
                            delCols = new List<string>();
                            foreach (var item in args[7].EnumerateArray())
                            {
                                var str = item.GetString();
                                if (!string.IsNullOrWhiteSpace(str)) delCols.Add(str.Trim());
                            }
                        }
                        bool ok = _db.ClearHistory(includePinned, excluded, keepStarred, deleteUnpinned, deleteImages, colPinned, colStarred, delCols);
                        if (!ok)
                        {
                            SendRpcResponse(rpcId, new { ok = false, error = _db.LastBackupError ?? "backup_failed" });
                            break;
                        }
                        PostEventToJs("refreshClips", new { });
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }

                case "browse_application":
                    BeginInvoke(() => HandleBrowseApplication(rpcId));
                    break;

                case "set_show_taskbar":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        bool show = args[0].GetBoolean();
                        ShowInTaskbar = show;
                        var s = AppSettings.Load();
                        s.ShowTaskbar = show;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_window_pos":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        int x = args[0].GetInt32();
                        int y = args[1].GetInt32();
                        Location = new Point(x, y);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "center_window":
                    {
                        var area = Screen.FromControl(this).WorkingArea;
                        var centered = WindowPlacement.CenterIn(Size, area);
                        Location = WindowPlacement.ClampToWorkingArea(centered, Size, area);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }

                case "set_window_size":
                case "resize_window":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() >= 2)
                    {
                        int w = args[0].GetInt32();
                        int h = args[1].GetInt32();
                        bool animate = args.GetArrayLength() > 2 && TryGetBool(args[2], out bool animFlag) && animFlag;
                        // 4th arg: persist=false marks a transient resize (Settings view) that must
                        // not overwrite the remembered History size. Defaults to true so every
                        // existing caller keeps its current behaviour.
                        bool persist = !(args.GetArrayLength() > 3 && TryGetBool(args[3], out bool persistFlag) && !persistFlag);
                var curScreen = Screen.FromControl(this).WorkingArea;
                // Leave room for the taskbar: sizing to the full monitor would push the
                // bottom edge under it, which is what WorkingArea exists to prevent.
                int maxW = Math.Max(MIN_WINDOW_WIDTH, curScreen.Width - WindowPlacement.EdgeMargin * 2);
                int maxH = Math.Max(MIN_WINDOW_HEIGHT, curScreen.Height - WindowPlacement.EdgeMargin * 2);
                        var targetSize = new Size(Math.Clamp(w, MIN_WINDOW_WIDTH, maxW), Math.Clamp(h, MIN_WINDOW_HEIGHT, maxH));
                        if (animate)
                        {
                            _transientSize = !persist;
                            _transientSizeValue = persist ? Size.Empty : targetSize;
                            StartBoundsMorph(targetSize, centerAtEnd: true, persistOnComplete: persist);
                            SendRpcResponse(rpcId, new { ok = true, width = targetSize.Width, height = targetSize.Height });
                            break;
                        }
                        // Skip the Win32 resize when bounds already match (e.g. the frontend's
                        // onWindowShow handler re-applies the active preset after a summon):
                        // a redundant same-size SetWindowPos is pure churn.
                        if (Size != targetSize)
                        {
                            _suppressResizeSave = true;
                            try
                            {
                                Size = targetSize;
                            }
                            finally
                            {
                                _suppressResizeSave = false;
                            }
                        }
                        _transientSize = !persist;
                        _transientSizeValue = persist ? Size.Empty : targetSize;
                        if (persist)
                        {
                            var s = AppSettings.Load();
                            bool isCompact = string.Equals(s.LayoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
                            if (isCompact)
                            {
                                s.CompactWidth = Size.Width;
                                s.CompactHeight = Size.Height;
                            }
                            else
                            {
                                s.StandardWidth = Size.Width;
                                s.StandardHeight = Size.Height;
                                s.WindowWidth = Size.Width;
                                s.WindowHeight = Size.Height;
                            }
                            s.LastWindowWidth = Size.Width;
                            s.LastWindowHeight = Size.Height;
                            AppSettings.Save(s);
                        }
                        SendRpcResponse(rpcId, new { ok = true, width = Size.Width, height = Size.Height });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_layout_preset":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && args[0].ValueKind == JsonValueKind.String)
                    {
                        string preset = args[0].GetString()?.ToLowerInvariant() ?? "standard";
                        var s = AppSettings.Load();
                        s.LayoutPreset = preset == "compact" ? "compact" : "standard";
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, preset = s.LayoutPreset });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_layout_preset":
                    SendRpcResponse(rpcId, new { ok = true, preset = AppSettings.Load().LayoutPreset });
                    break;

                case "reset_window_size":
                    // Layout-aware reset: optional args[0] names the active layout preset
                    // ('compact' / 'standard'; legacy 'expanded' falls back to Standard).
                    // With no arg, replay the frontend's mirrored size, then Standard.
                    string? resetLayout = null;
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0
                        && args[0].ValueKind == JsonValueKind.String)
                    {
                        resetLayout = args[0].GetString();
                    }
                    var sReset = AppSettings.Load();
                    int resetW;
                    int resetH;
                    if (!string.IsNullOrWhiteSpace(resetLayout))
                    {
                        (resetW, resetH) = WindowSizePolicy.ResetSizeFor(resetLayout);
                    }
                    else if (sReset.LastWindowWidth >= MIN_WINDOW_WIDTH && sReset.LastWindowHeight >= MIN_WINDOW_HEIGHT)
                    {
                        resetW = sReset.LastWindowWidth;
                        resetH = sReset.LastWindowHeight;
                    }
                    else
                    {
                        resetW = WindowSizePolicy.StandardWidth;
                        resetH = WindowSizePolicy.StandardHeight;
                    }
                    if (Size != new Size(resetW, resetH))
                    {
                        _suppressResizeSave = true;
                        try
                        {
                            Size = new Size(resetW, resetH);
                        }
                        finally
                        {
                            _suppressResizeSave = false;
                        }
                    }
                    bool resetIsCompact = string.Equals(resetLayout ?? sReset.LayoutPreset, "compact", StringComparison.OrdinalIgnoreCase);
                    if (resetIsCompact)
                    {
                        sReset.CompactWidth = WindowSizePolicy.CompactWidth;
                        sReset.CompactHeight = WindowSizePolicy.CompactHeight;
                    }
                    else
                    {
                        sReset.StandardWidth = WindowSizePolicy.StandardWidth;
                        sReset.StandardHeight = WindowSizePolicy.StandardHeight;
                        sReset.WindowWidth = WindowSizePolicy.StandardWidth;
                        sReset.WindowHeight = WindowSizePolicy.StandardHeight;
                    }
                    sReset.LastWindowWidth = Size.Width;
                    sReset.LastWindowHeight = Size.Height;
                    AppSettings.Save(sReset);
                    SendRpcResponse(rpcId, new { ok = true, width = Size.Width, height = Size.Height });
                    break;

                case "set_theme_color":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string col = args[0].GetString() ?? "purple";
                        var s = AppSettings.Load();
                        s.ThemeColor = col;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_tray_theme":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string thm = args[0].GetString() ?? "dark";
                        var s = AppSettings.Load();
                        s.TrayTheme = thm;
                        AppSettings.Save(s);
                        _tray.SetTheme(thm);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_smart_shortcuts":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        bool sc = args[0].GetBoolean();
                        var s = AppSettings.Load();
                        s.SmartShortcuts = sc;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_smart_shortcuts":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().SmartShortcuts });
                    break;

                case "set_window_position_mode":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string mode = args[0].GetString() ?? "cursor";
                        var s = AppSettings.Load();
                        s.WindowPositionMode = mode;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_window_position_mode":
                    SendRpcResponse(rpcId, new { ok = true, mode = AppSettings.Load().WindowPositionMode });
                    break;

                case "set_tray_position_mode":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string mode = args[0].GetString() ?? "tray";
                        var s = AppSettings.Load();
                        s.TrayPositionMode = mode;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_tray_position_mode":
                    SendRpcResponse(rpcId, new { ok = true, mode = AppSettings.Load().TrayPositionMode });
                    break;

                case "set_live_preview":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool lp))
                    {
                        var s = AppSettings.Load();
                        s.LivePreviewEnabled = lp;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, enabled = s.LivePreviewEnabled });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_live_preview":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().LivePreviewEnabled });
                    break;

                case "set_remember_window_size":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool rem))
                    {
                        var s = AppSettings.Load();
                        s.RememberWindowSize = rem;
                        if (rem && Width >= MIN_WINDOW_WIDTH && Height >= MIN_WINDOW_HEIGHT && Width <= 1600 && Height <= 1200)
                        {
                            s.WindowWidth = Width;
                            s.WindowHeight = Height;
                        }
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_remember_window_size":
                    SendRpcResponse(rpcId, new { ok = true, remember = AppSettings.Load().RememberWindowSize, remember_window_size = AppSettings.Load().RememberWindowSize });
                    break;

                case "set_track_stats":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool ts))
                    {
                        var s = AppSettings.Load();
                        s.TrackStats = ts;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "set_restore_clipboard":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool rc))
                    {
                        var s = AppSettings.Load();
                        s.RestoreClipboard = rc;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_restore_clipboard":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().RestoreClipboard });
                    break;

                case "set_prevent_screen_capture":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool psc))
                    {
                        var s = AppSettings.Load();
                        s.PreventScreenCapture = psc;
                        AppSettings.Save(s);
                        ApplyScreenCaptureProtection(psc);
                        SendRpcResponse(rpcId, new { ok = true, enabled = psc });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_prevent_screen_capture":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().PreventScreenCapture });
                    break;

                case "set_auto_expire_days":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetInt(args[0], out int days))
                    {
                        var s = AppSettings.Load();
                        s.AutoExpireDays = days;
                        AppSettings.Save(s);
                        if (days > 0)
                        {
                            _ = Task.Run(() =>
                            {
                                int purged = _db.PurgeExpiredClips(days);
                                if (purged > 0)
                                {
                                    PostEventToJs("refreshClips", new { });
                                }
                            });
                        }
                        SendRpcResponse(rpcId, new { ok = true });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_auto_expire_days":
                    SendRpcResponse(rpcId, new { ok = true, days = AppSettings.Load().AutoExpireDays });
                    break;

                case "set_quick_number_paste":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetBool(args[0], out bool quickNumberPaste))
                    {
                        var s = AppSettings.Load();
                        s.QuickNumberPaste = quickNumberPaste;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, enabled = quickNumberPaste });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_quick_number_paste":
                    SendRpcResponse(rpcId, new { ok = true, enabled = AppSettings.Load().QuickNumberPaste });
                    break;

                case "set_line_display":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string lineMode = (args[0].GetString() ?? "auto").Trim().ToLowerInvariant();
                        if (lineMode != "1" && lineMode != "2" && lineMode != "3") lineMode = "auto";
                        var s = AppSettings.Load();
                        s.LineDisplay = lineMode;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, mode = lineMode });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_line_display":
                    SendRpcResponse(rpcId, new { ok = true, mode = AppSettings.Load().LineDisplay });
                    break;

                case "set_thumb_size":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string thumbSize = (args[0].GetString() ?? "sm").Trim().ToLowerInvariant();
                        if (thumbSize != "sm" && thumbSize != "md" && thumbSize != "lg") thumbSize = "sm";
                        var s = AppSettings.Load();
                        s.ThumbSize = thumbSize;
                        AppSettings.Save(s);
                        SendRpcResponse(rpcId, new { ok = true, size = thumbSize });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_thumb_size":
                    SendRpcResponse(rpcId, new { ok = true, size = AppSettings.Load().ThumbSize });
                    break;

                case "set_clip_details":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        string details = (args[0].GetString() ?? "hidden").Trim().ToLowerInvariant();
                        if (details != "app-time" && details != "time-only" && details != "icon-only" && details != "hidden")
                        {
                            details = "hidden";
                        }
                        var sDetails = AppSettings.Load();
                        sDetails.ClipDetails = details;
                        AppSettings.Save(sDetails);
                        SendRpcResponse(rpcId, new { ok = true, details = details });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_clip_details":
                    SendRpcResponse(rpcId, new { ok = true, details = AppSettings.Load().ClipDetails });
                    break;

                case "get_clip":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long gcId))
                    {
                        var clip = _db.GetClipById(gcId);
                        if (clip != null)
                        {
                            var jsObj = FormatClipForJs(clip);
                            SendRpcResponse(rpcId, new { ok = true, clip = jsObj, data = jsObj });
                            break;
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_clip_text":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long gctId))
                    {
                        var clip = _db.GetClipById(gctId);
                        SendRpcResponse(rpcId, new { ok = clip != null, text = clip?.Text ?? "" });
                        break;
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "get_clip_temp_file":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0 && TryGetClipId(args[0], out long gctfId))
                    {
                        var clip = _db.GetClipById(gctfId);
                        if (clip != null)
                        {
                            var imgPath = EnsureClipImagePath(clip);
                            if (!string.IsNullOrEmpty(imgPath) && File.Exists(imgPath))
                            {
                                SendRpcResponse(rpcId, new { ok = true, path = imgPath });
                                break;
                            }
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "start_file_drag":
                    if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                    {
                        var ids = new List<long>();
                        if (args[0].ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in args[0].EnumerateArray())
                            {
                                if (item.ValueKind == JsonValueKind.Number) ids.Add(item.GetInt64());
                            }
                        }
                        else if (args[0].ValueKind == JsonValueKind.Number)
                        {
                            ids.Add(args[0].GetInt64());
                        }

                        string dragMode = args.GetArrayLength() > 1 && args[1].ValueKind == JsonValueKind.String
                            ? (args[1].GetString() ?? "file")
                            : "file";

                        var clips = ids.Select(id => _db.GetClipById(id)).Where(c => c != null).Cast<ClipItem>().ToList();
                        if (clips.Count > 0)
                        {
                            var dataObj = new DataObject();
                            bool hasPayload = false;

                            var filePaths = new List<string>();
                            var textParts = new List<string>();

                            foreach (var c in clips)
                            {
                                if (c.IsImage && dragMode != "text")
                                {
                                    var path = EnsureClipImagePath(c);
                                    if (!string.IsNullOrEmpty(path) && File.Exists(path))
                                    {
                                        filePaths.Add(path);
                                    }
                                }
                                else
                                {
                                    string text = !string.IsNullOrEmpty(c.Text) ? c.Text : (!string.IsNullOrEmpty(c.Preview) ? c.Preview : "");
                                    if (!string.IsNullOrEmpty(text))
                                    {
                                        textParts.Add(text);
                                        var txtPath = EnsureClipTextFile(c, text);
                                        if (!string.IsNullOrEmpty(txtPath) && File.Exists(txtPath))
                                        {
                                            filePaths.Add(txtPath);
                                        }
                                    }
                                }
                            }

                            if (filePaths.Count > 0)
                            {
                                dataObj.SetData(DataFormats.FileDrop, filePaths.ToArray());
                                hasPayload = true;
                            }

                            if (textParts.Count > 0)
                            {
                                string fullText = string.Join(Environment.NewLine, textParts);
                                dataObj.SetData(DataFormats.UnicodeText, fullText);
                                dataObj.SetData(DataFormats.Text, fullText);
                                hasPayload = true;
                            }

                            if (hasPayload)
                            {
                                dataObj.SetData("application/x-dualclip-source", "true");
                                var effect = DoDragDrop(dataObj, DragDropEffects.Copy | DragDropEffects.Move);
                                foreach (var c in clips)
                                {
                                    _db.MarkUsed(c.Id);
                                }
                                SendRpcResponse(rpcId, new { ok = true, dropped = effect != DragDropEffects.None });
                                break;
                            }
                        }
                    }
                    SendRpcResponse(rpcId, new { ok = false });
                    break;

                case "ui_ready":
                    FlushPendingEventsToJs();
                    var curSettings = AppSettings.Load();
                    if (curSettings.AutoExpireDays > 0)
                    {
                        _ = Task.Run(() =>
                        {
                            int purged = _db.PurgeExpiredClips(curSettings.AutoExpireDays);
                            if (purged > 0)
                            {
                                PostEventToJs("refreshClips", new { });
                            }
                        });
                    }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                case "write_debug_log":
                    // TEMPORARY: image-row height calibration. Removed as soon as the
                    // constants in render.js are set from measured values.
                    try
                    {
                        if (args.ValueKind == JsonValueKind.Array && args.GetArrayLength() > 0)
                        {
                            string logLine = args[0].GetString() ?? "";
                            string logPath = Path.Combine(PathHelper.GetRootFolder(), "layout_debug.log");
                            File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {logLine}{Environment.NewLine}");
                        }
                    }
                    catch { }
                    SendRpcResponse(rpcId, new { ok = true });
                    break;

                default:
                    SendRpcResponse(rpcId, new { ok = false, error = $"unhandled_method: {method}" });
                    break;
            }
        }
        catch (Exception ex)
        {
            SendRpcResponse(rpcId, new { ok = false, error = ex.Message });
        }
    }
}
