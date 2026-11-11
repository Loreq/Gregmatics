using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Gregmatics
{
    /// <summary>Write finished files into place, so a half-written file is never left where one is read.</summary>
    internal static class Files
    {
        // A file still being written carries this prefix. Anything listing a folder skips it.
        public const string TempPrefix = "_tmp-";
        const int SwapTries = 10;
        const int SwapWaitMs = 300;

        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        /// <summary>The short hash a plan's text is known by.</summary>
        public static string Fingerprint(string text)
        {
            using (var sha = SHA1.Create())
            {
                byte[] hash = sha.ComputeHash(Utf8.GetBytes(text ?? ""));
                var hex = new StringBuilder(12);
                for (int i = 0; i < 6; i++)
                    hex.Append(hash[i].ToString("x2"));
                return hex.ToString();
            }
        }

        /// <summary>Text that ends with a newline, the way a plan is stored.</summary>
        public static string Ended(string text)
        {
            text = text ?? "";
            return text.EndsWith("\n", StringComparison.Ordinal) ? text : text + "\n";
        }

        /// <summary>Write text with LF line endings, making the folder if it is missing.</summary>
        public static void SaveText(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string tmp = Path.Combine(Path.GetDirectoryName(path), TempPrefix + Path.GetFileName(path));
            File.WriteAllText(tmp, text ?? "", Utf8);
            Replace(tmp, path);
        }

        /// <summary>Move a finished file into place. A viewer holding the old file can block the swap for a moment.</summary>
        static void Replace(string tmp, string path)
        {
            for (int attempt = 0; attempt < SwapTries; attempt++)
            {
                try
                {
                    if (File.Exists(path))
                        File.Replace(tmp, path, null);
                    else
                        File.Move(tmp, path);
                    return;
                }
                catch (IOException)
                {
                    Thread.Sleep(SwapWaitMs);
                }
            }
            if (File.Exists(path))
                File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
