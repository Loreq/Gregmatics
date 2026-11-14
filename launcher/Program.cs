using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Gregmatics
{
    /// <summary>Opens the Gregmatics window. The release exe carries the editor inside it.</summary>
    internal static class Program
    {
        const string AppName = "Gregmatics";
        const string TestFlag = "--test";
        const string FailedToStart = "Gregmatics failed to start.";
        // A message box cuts a longer message off.
        const int MessageLimit = 2500;

        const uint MbOk = 0;
        const uint MbIconError = 0x10;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int MessageBox(IntPtr owner, string text, string caption, uint type);

        /// <summary>Read the editor packed into this exe before the window opens.</summary>
        static Program()
        {
            Bundle.LoadEmbedded();
        }

        /// <summary>Run the program. A failure is written to the log, and shown unless this is a --test run.</summary>
        [STAThread]
        static int Main(string[] args)
        {
            bool test = Array.IndexOf(args, TestFlag) >= 0;
            string log = LogPath();
            try
            {
                if (File.Exists(log))
                    File.Delete(log);
                Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
                WebView.UseLoader();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                return MainForm.Run(test, log);
            }
            catch (Exception ex)
            {
                return Fail(ex.Message, test, log);
            }
        }

        /// <summary>Where a failed start leaves its reason.</summary>
        internal static string LogPath()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "launch.log");
        }

        /// <summary>Report why the start failed. Returns the exit code for a failure.</summary>
        internal static int Fail(string text, bool test, string log)
        {
            Report(text, test, log);
            return 1;
        }

        /// <summary>Write a message to the log and show it. A --test run only logs it.</summary>
        internal static void Report(string text, bool test, string log)
        {
            try
            {
                if (!string.IsNullOrEmpty(log))
                    File.WriteAllText(log, text ?? "");
            }
            catch (IOException)
            {
            }
            if (test)
                return;
            if (text != null && text.Length > MessageLimit)
                text = text.Substring(0, MessageLimit);
            MessageBox(IntPtr.Zero, text ?? FailedToStart, AppName, MbOk | MbIconError);
        }
    }
}
