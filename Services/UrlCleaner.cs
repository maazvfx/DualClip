using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web;

namespace DualClip.Services;

public static class UrlCleaner
{
    private static readonly HashSet<string> GlobalTrackingParams = new(StringComparer.OrdinalIgnoreCase)
    {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
        "gclid", "gclsrc", "dclid", "gad_source", "_ga", "_gl", "msclkid",
        "mc_cid", "mc_eid", "vero_id", "vero_conv", "wickedid", "oly_enc_id", "oly_anon_id",
        "fbclid", "igshid", "fb_action_ids", "fb_action_types", "s_kwcid", "ttclid", "twclid"
    };

    private static readonly string[] GlobalTrackingPrefixes = new[]
    {
        "utm_", "pd_rd_", "pf_rd_", "ref_"
    };

    private static bool IsHost(string host, params string[] allowedDomains)
    {
        if (string.IsNullOrEmpty(host)) return false;
        foreach (var domain in allowedDomains)
        {
            if (string.Equals(host, domain, StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    public static string CleanUrl(string rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl)) return string.Empty;
        var match = Regex.Match(rawUrl, @"https?://[^\s]+", RegexOptions.IgnoreCase);
        string target = match.Success ? match.Value : (rawUrl.Trim().StartsWith("http", StringComparison.OrdinalIgnoreCase) ? rawUrl.Trim() : "https://" + rawUrl.Trim());
        target = target.TrimEnd('.', ',', ';', ':', '!', '?', ')');

        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri))
        {
            return target;
        }

        string host = uri.Host;
        var query = HttpUtility.ParseQueryString(uri.Query);
        var keysToRemove = new List<string>();

        bool isTwitter = IsHost(host, "x.com", "twitter.com", "t.co");
        bool isYouTube = IsHost(host, "youtube.com", "youtu.be");
        bool isAmazon = IsHost(host, "amazon.com", "amzn.to", "amazon.co.uk", "amazon.ca", "amazon.de", "amazon.fr", "amazon.in", "amazon.co.jp");

        foreach (string? key in query.AllKeys)
        {
            if (string.IsNullOrEmpty(key)) continue;
            string lower = key.ToLowerInvariant();

            // 1. Global tracking parameters
            if (GlobalTrackingParams.Contains(lower) || Array.Exists(GlobalTrackingPrefixes, p => lower.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
            {
                keysToRemove.Add(key);
                continue;
            }

            // 2. Twitter / X tracking
            if (isTwitter && (lower == "t" || lower == "s" || lower == "ref_src" || lower == "ref_url"))
            {
                keysToRemove.Add(key);
                continue;
            }

            // 3. YouTube tracking (preserves video 'v' and timestamp 't')
            if (isYouTube && (lower == "si" || lower == "feature" || lower == "pp"))
            {
                keysToRemove.Add(key);
                continue;
            }

            // 4. Amazon tracking
            if (isAmazon && (lower == "tag" || lower == "linkcode" || lower == "ref" || lower == "psc" || lower == "_encoding" || lower == "th" || lower == "smid" || lower == "qid" || lower == "sr" || lower == "sprefix"))
            {
                keysToRemove.Add(key);
                continue;
            }
        }

        bool hasAmazonPathRef = isAmazon && Regex.IsMatch(uri.AbsolutePath, @"/ref=[^/?#]+", RegexOptions.IgnoreCase);

        // If nothing needs to be stripped, return original target unchanged (preserves percent-encoding, bare host, casing)
        if (keysToRemove.Count == 0 && !hasAmazonPathRef)
        {
            return target;
        }

        foreach (var key in keysToRemove)
        {
            query.Remove(key);
        }

        var builder = new UriBuilder(uri);
        if (hasAmazonPathRef)
        {
            builder.Path = Regex.Replace(builder.Path, @"/ref=[^/?#]+", "", RegexOptions.IgnoreCase);
        }

        string newQuery = query.ToString() ?? "";
        builder.Query = newQuery;

        string result = builder.Uri.AbsoluteUri;
        if (string.IsNullOrEmpty(newQuery) && result.EndsWith("?"))
        {
            result = result.Substring(0, result.Length - 1);
        }

        // If original target had no trailing slash on bare host, restore bare host form
        if (string.IsNullOrEmpty(uri.AbsolutePath.Trim('/')) && string.IsNullOrEmpty(newQuery) && !target.EndsWith("/") && result.EndsWith("/"))
        {
            result = result.TrimEnd('/');
        }

        return result;
    }

    public static bool IsUrl(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        string trimmed = text.Trim();
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return Regex.IsMatch(trimmed, @"https?://[^\s]+", RegexOptions.IgnoreCase);
    }
}
