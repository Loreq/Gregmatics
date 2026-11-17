using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>The latest GitHub release of Gregmatics.exe, and replacing the running program with it.</summary>
    internal static class Update
    {
        const string AssetName = "Gregmatics.exe";
        const string LatestUrl = "https://api.github.com/repos/Loreq/Gregmatics/releases/latest";
        const string DownloadRoot = "https://github.com/Loreq/Gregmatics/releases/download/";
        const string DigestPrefix = "sha256:";

        static readonly TimeSpan CheckLimit = TimeSpan.FromSeconds(20);
        static readonly TimeSpan DownloadLimit = TimeSpan.FromMinutes(10);
        static readonly HttpClient Http = Client();
        static int installing;
        static string pageUrl;

        /// <summary>An HttpClient that waits on the caller's own time limit.</summary>
        static HttpClient Client()
        {
            var client = new HttpClient();
            client.Timeout = Timeout.InfiniteTimeSpan;
            return client;
        }

        /// <summary>Whether the latest release is newer than this program.</summary>
        public static async Task<JObject> Check()
        {
            Found found = await Find().ConfigureAwait(false);
            if (found.Error != null)
                return Fail(found.Error);
            System.Version current = Current();
            string latest = VersionText(found.Release.Version);
            return new JObject
            {
                ["ok"] = true,
                ["current"] = VersionText(current),
                ["latest"] = latest,
                ["newer"] = Compare(found.Release.Version, current) > 0,
                ["date"] = found.Release.Date ?? "",
                ["notes"] = found.Release.Notes ?? "",
                ["title"] = ExtraTitle(found.Release.Title, latest),
                ["page"] = !string.IsNullOrEmpty(found.Release.Page),
            };
        }

        /// <summary>Download a newer Gregmatics.exe, then leave a helper to swap it in after this process exits.</summary>
        public static async Task<JObject> Install()
        {
            if (Interlocked.Exchange(ref installing, 1) == 1)
                return Fail("An update is already downloading.");
            string file = null;
            bool started = false;
            try
            {
                Found found = await Find().ConfigureAwait(false);
                if (found.Error != null)
                    return Fail(found.Error);
                System.Version current = Current();
                if (Compare(found.Release.Version, current) <= 0)
                    return Fail("Gregmatics " + VersionText(found.Release.Version) + " is the latest release.");
                string target = Environment.ProcessPath;
                file = DownloadPath();
                if (!CanReplace(target) || SamePath(file, target))
                    return Fail("Could not replace the program.");
                if (!await Save(found.Release, file).ConfigureAwait(false))
                    return Fail("Could not download the update.");
                if (!Matches(file, found.Release))
                    return Fail("The download did not match the release.");
                if (!BeginReplace(file, target))
                    return Fail("Could not replace the program.");
                started = true;
                return new JObject { ["ok"] = true, ["restarting"] = true };
            }
            catch (Exception)
            {
                return Fail("Could not install the update.");
            }
            finally
            {
                if (!started)
                {
                    Interlocked.Exchange(ref installing, 0);
                    if (!string.IsNullOrEmpty(file) && !SamePath(file, Environment.ProcessPath))
                        TryDelete(file);
                }
            }
        }

        /// <summary>The latest release, or a reason it could not be read.</summary>
        static async Task<Found> Find()
        {
            try
            {
                return Read(await Get(LatestUrl, CheckLimit).ConfigureAwait(false));
            }
            catch (Exception)
            {
                return Found.Fail("Could not reach GitHub.");
            }
        }

        /// <summary>The release record in a GitHub releases/latest body.</summary>
        static Found Read(string body)
        {
            JObject release;
            try
            {
                release = JObject.Parse(body);
            }
            catch (JsonReaderException)
            {
                return Found.Fail("Could not read the release.");
            }
            string tag = release["tag_name"] != null ? release["tag_name"].Value<string>() : "";
            System.Version version = ReleaseVersion(tag);
            if (version == null)
                return Found.Fail("Could not read the release.");
            JObject asset = Asset(release["assets"] as JArray);
            if (asset == null)
                return Found.Fail("The latest release has no Gregmatics.exe.");
            string digest = DigestOf(asset["digest"] != null ? asset["digest"].Value<string>() : "");
            if (digest == null)
                return Found.Fail("The latest release has no checksum.");
            string url = DownloadRoot + tag.Trim() + "/" + AssetName;
            string given = asset["browser_download_url"] != null ? asset["browser_download_url"].Value<string>() : "";
            if (!string.Equals(given, url, StringComparison.Ordinal))
                return Found.Fail("Could not read the release.");
            long size = asset["size"] != null && asset["size"].Type == JTokenType.Integer ? asset["size"].Value<long>() : -1;
            string notes = release["body"] != null && release["body"].Type == JTokenType.String ? release["body"].Value<string>().Trim() : "";
            string title = release["name"] != null && release["name"].Type == JTokenType.String ? release["name"].Value<string>().Trim() : "";
            string page = release["html_url"] != null ? release["html_url"].Value<string>() : "";
            if (!ReleasePage(page, tag.Trim()))
                page = "";
            pageUrl = page;
            return Found.Ok(new Release
            {
                Version = version,
                Url = url,
                Digest = digest,
                Size = size,
                Notes = notes,
                Title = title,
                Date = Published(release["published_at"]),
                Page = page,
            });
        }

        /// <summary>Whether this is the GitHub page for that release tag.</summary>
        static bool ReleasePage(string url, string tag)
        {
            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(tag))
                return false;
            return string.Equals(url, "https://github.com/Loreq/Gregmatics/releases/tag/" + tag, StringComparison.Ordinal);
        }

        /// <summary>A release name that says something the version line does not.</summary>
        static string ExtraTitle(string name, string versionText)
        {
            if (string.IsNullOrEmpty(name))
                return "";
            if (string.Equals(name, "Gregmatics " + versionText, StringComparison.OrdinalIgnoreCase))
                return "";
            if (string.Equals(name, "Gregmatics v" + versionText, StringComparison.OrdinalIgnoreCase))
                return "";
            return name;
        }

        /// <summary>The published day, as 14 Nov 2026, or empty when the release has none.</summary>
        static string Published(JToken token)
        {
            string text = token != null && token.Type == JTokenType.String ? token.Value<string>() : "";
            DateTime published;
            if (!DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out published))
                return "";
            return published.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
        }

        /// <summary>Open the release page in the browser. The page does not choose the address.</summary>
        public static JObject OpenPage()
        {
            string url = pageUrl;
            if (string.IsNullOrEmpty(url) || !url.StartsWith("https://github.com/Loreq/Gregmatics/releases/tag/", StringComparison.Ordinal))
                return Fail("Could not open the release.");
            try
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
                return new JObject { ["ok"] = true };
            }
            catch (Exception)
            {
                return Fail("Could not open the release.");
            }
        }

        /// <summary>The Gregmatics.exe asset, matched by file name.</summary>
        static JObject Asset(JArray assets)
        {
            if (assets == null)
                return null;
            foreach (JToken token in assets)
            {
                JObject item = token as JObject;
                if (item == null)
                    continue;
                string name = item["name"] != null ? item["name"].Value<string>() : "";
                if (string.Equals(name, AssetName, StringComparison.OrdinalIgnoreCase))
                    return item;
            }
            return null;
        }

        /// <summary>The hex after sha256:, or null when the digest is missing or not that hash.</summary>
        static string DigestOf(string digest)
        {
            if (string.IsNullOrEmpty(digest) || digest.Length != DigestPrefix.Length + 64)
                return null;
            if (!digest.StartsWith(DigestPrefix, StringComparison.OrdinalIgnoreCase))
                return null;
            string hex = digest.Substring(DigestPrefix.Length);
            foreach (char c in hex)
            {
                bool digit = c >= '0' && c <= '9';
                bool lower = c >= 'a' && c <= 'f';
                bool upper = c >= 'A' && c <= 'F';
                if (!digit && !lower && !upper)
                    return null;
            }
            return hex;
        }

        /// <summary>A release tag such as 0.1.3 or v0.1.3, or null when it is not a version.</summary>
        static System.Version ReleaseVersion(string tag)
        {
            if (string.IsNullOrWhiteSpace(tag))
                return null;
            string text = tag.Trim();
            if (text.Length > 1 && (text[0] == 'v' || text[0] == 'V'))
                text = text.Substring(1);
            System.Version version;
            if (!System.Version.TryParse(text, out version))
                return null;
            return version;
        }

        /// <summary>The program version from the assembly, compared on major, minor, and build.</summary>
        static System.Version Current()
        {
            return Assembly.GetExecutingAssembly().GetName().Version ?? new System.Version(0, 0, 0);
        }

        /// <summary>Three-part text for a version. A missing build is zero.</summary>
        static string VersionText(System.Version version)
        {
            int build = version.Build < 0 ? 0 : version.Build;
            return version.Major + "." + version.Minor + "." + build;
        }

        /// <summary>How latest sits against current, ignoring a fourth part.</summary>
        static int Compare(System.Version latest, System.Version current)
        {
            var left = new System.Version(latest.Major, latest.Minor, latest.Build < 0 ? 0 : latest.Build);
            var right = new System.Version(current.Major, current.Minor, current.Build < 0 ? 0 : current.Build);
            return left.CompareTo(right);
        }

        /// <summary>GET a URL and return its body. A failed status throws.</summary>
        static async Task<string> Get(string url, TimeSpan limit)
        {
            using (var cancel = new CancellationTokenSource(limit))
            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.UserAgent.ParseAdd("Gregmatics");
                request.Headers.Accept.ParseAdd("application/vnd.github+json");
                using (HttpResponseMessage response = await Http.SendAsync(request, cancel.Token).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                        throw new HttpRequestException(response.StatusCode.ToString());
                    return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                }
            }
        }

        /// <summary>Where the downloaded exe waits to be moved into place.</summary>
        static string DownloadPath()
        {
            return Path.Combine(Path.GetTempPath(), "Gregmatics-update", AssetName);
        }

        /// <summary>Write the release asset to disk. A failed download removes the partial file.</summary>
        static async Task<bool> Save(Release release, string file)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                TryDelete(file);
                using (var cancel = new CancellationTokenSource(DownloadLimit))
                using (var request = new HttpRequestMessage(HttpMethod.Get, release.Url))
                {
                    request.Headers.UserAgent.ParseAdd("Gregmatics");
                    using (HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel.Token).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode)
                            return false;
                        using (Stream input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        using (var output = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None))
                            await input.CopyToAsync(output, 81920, cancel.Token).ConfigureAwait(false);
                    }
                }
                return true;
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is OperationCanceledException || ex is IOException)
            {
                TryDelete(file);
                return false;
            }
        }

        /// <summary>Whether the file is the size and sha256 the release published.</summary>
        static bool Matches(string file, Release release)
        {
            if (release.Size >= 0 && new FileInfo(file).Length != release.Size)
                return false;
            using (var stream = File.OpenRead(file))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                var text = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash)
                    text.Append(b.ToString("x2"));
                return text.ToString().Equals(release.Digest, StringComparison.OrdinalIgnoreCase);
            }
        }

        /// <summary>Whether this process can write a new exe over the one that is running.</summary>
        static bool CanReplace(string target)
        {
            if (string.IsNullOrEmpty(target) || !File.Exists(target) || !PlainPath(target))
                return false;
            if ((File.GetAttributes(target) & FileAttributes.ReadOnly) != 0)
                return false;
            string folder = Path.GetDirectoryName(target);
            if (string.IsNullOrEmpty(folder))
                return false;
            string probe = Path.Combine(folder, ".gregmatics-write-probe");
            try
            {
                File.WriteAllText(probe, "");
                File.Delete(probe);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                TryDelete(probe);
                return false;
            }
        }

        /// <summary>A path a cmd script can quote: no quotes, percent signs, or line breaks.</summary>
        static bool PlainPath(string path)
        {
            return path.IndexOf('"') < 0 && path.IndexOf('%') < 0 && path.IndexOf('\r') < 0 && path.IndexOf('\n') < 0;
        }

        /// <summary>Whether two paths are the same file.</summary>
        static bool SamePath(string left, string right)
        {
            if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right))
                return false;
            return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Start the cmd helper that waits for this process, moves the new exe into place, and opens it.</summary>
        static bool BeginReplace(string source, string target)
        {
            if (!PlainPath(source))
                return false;
            string folder = Path.GetDirectoryName(source);
            string script = Path.Combine(folder, "replace.cmd");
            if (!PlainPath(script))
                return false;
            File.WriteAllText(script, ScriptText(Process.GetCurrentProcess().Id, source, target), Encoding.Default);
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                Arguments = "/s /c \"" + script + "\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = folder,
            };
            return Process.Start(info) != null;
        }

        /// <summary>The helper script: wait until this process is gone, then replace its exe and start that.</summary>
        static string ScriptText(int pid, string source, string target)
        {
            return "@echo off\r\n"
                + "\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -Command \"while (Get-Process -Id " + pid + " -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }\"\r\n"
                + "set /a N=0\r\n"
                + ":swap\r\n"
                + "move /Y \"" + source + "\" \"" + target + "\"\r\n"
                + "if not errorlevel 1 goto run\r\n"
                + "set /a N+=1\r\n"
                + "if %N% GTR 30 exit /b 1\r\n"
                + "ping 127.0.0.1 -n 2 >nul\r\n"
                + "goto swap\r\n"
                + ":run\r\n"
                + "start \"\" \"" + target + "\"\r\n"
                + "del \"%~f0\"\r\n";
        }

        /// <summary>Remove a file and ignore a miss.</summary>
        static void TryDelete(string path)
        {
            if (string.IsNullOrEmpty(path))
                return;
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
            }
        }

        /// <summary>A reply the page can show.</summary>
        static JObject Fail(string reason)
        {
            return new JObject { ["ok"] = false, ["error"] = reason ?? "" };
        }

        /// <summary>A release the page can install, or the reason it cannot.</summary>
        sealed class Found
        {
            public Release Release;
            public string Error;

            public static Found Fail(string error)
            {
                return new Found { Error = error };
            }

            public static Found Ok(Release release)
            {
                return new Found { Release = release };
            }
        }

        /// <summary>The parts of a release this program installs.</summary>
        sealed class Release
        {
            public System.Version Version;
            public string Url;
            public string Digest;
            public long Size;
            public string Notes;
            public string Title;
            public string Date;
            public string Page;
        }
    }
}
