using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Gregmatics
{
    /// <summary>Starts Python inside this process and runs blueprints/python/desktop.py.</summary>
    internal static class Program
    {
        const string AppName = "Gregmatics";
        const string TestFlag = "--test";
        const string FailedToStart = "Gregmatics failed to start.";
        const string NoProgramFiles = "Gregmatics could not find its program files.";
        const string Damaged = "This copy of Gregmatics.exe is damaged.";
        // A message box cuts a longer message off.
        const int MessageLimit = 2500;

        // A released exe has a zip appended after the program, then the zip's length and this word.
        const string PackMagic = "GREGPACK";
        const int PackLengthBytes = 4;
        const int PackTailBytes = PackLengthBytes + 8;
        // An unpacked folder holds this file once every entry has been written.
        const string ReadyMark = "ready";

        const uint MbOk = 0;
        const uint MbIconError = 0x10;
        const int StdInput = -10;
        const int StdOutput = -11;
        const int StdError = -12;
        const uint GenericRead = 0x80000000;
        const uint GenericWrite = 0x40000000;
        const uint ShareReadWrite = 3;
        const uint OpenExisting = 3;

        // Runs the script named by GREGMATICS_SCRIPT. A --test run, or a failure, writes to GREGMATICS_LOG.
        const string Bootstrap = @"
import os, runpy, sys, traceback

class _Null:
    def write(self, _text):
        return None
    def flush(self):
        return None
    def isatty(self):
        return False

if sys.stdout is None:
    sys.stdout = _Null()
if sys.stderr is None:
    sys.stderr = _Null()

script = os.environ['GREGMATICS_SCRIPT']
raw = os.environ.get('GREGMATICS_ARGV', '')
args = [] if raw == '' else raw.split('\n')
sys.argv = [script] + args
log_path = os.environ.get('GREGMATICS_LOG', '')
test = '--test' in args
log = None
if test and log_path:
    log = open(log_path, 'w', encoding='utf-8', buffering=1)
    sys.stdout = log
    sys.stderr = log
    print('executable', sys.executable)
    print('prefix', sys.prefix)
try:
    runpy.run_path(script, run_name='__main__')
    if log is not None:
        log.flush()
except SystemExit as err:
    code = err.code
    if code not in (0, None):
        line = 'Gregmatics exited (%s).' % (code,)
        if log is not None:
            log.write(line + '\n')
            log.flush()
        elif log_path:
            open(log_path, 'w', encoding='utf-8').write(line + '\n')
        raise
except Exception:
    text = traceback.format_exc()
    if log is not None:
        log.write(text)
        log.flush()
    elif log_path:
        open(log_path, 'w', encoding='utf-8').write(text)
    raise
";

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr LoadLibrary(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        static extern IntPtr GetProcAddress(IntPtr module, string name);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetDllDirectory(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetStdHandle(int stdHandle, IntPtr handle);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int MessageBox(IntPtr owner, string text, string caption, uint type);

        // The shapes of the Python functions this program calls: one that takes a wide string,
        // Py_Initialize, and PyRun_SimpleString.
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate void SetWide(IntPtr value);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate void InitFn();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate int RunFn(IntPtr command);

        /// <summary>Where the program's files are. A released exe brings its own Python with them.</summary>
        sealed class Install
        {
            public string Root;
            public string BundledPython;

            public string Script { get { return Path.Combine(Root, "blueprints", "python", "desktop.py"); } }

            public bool Bundled { get { return BundledPython != null; } }
        }

        /// <summary>The Python that runs the program: its folder, its exe, and its DLL.</summary>
        sealed class Runtime
        {
            public string Home;
            public string Exe;
            public string Dll;
        }

        /// <summary>What a child process printed, and how it ended.</summary>
        sealed class Outcome
        {
            public int Code;
            public string Output;
            public string Errors;

            public string Text { get { return (Errors + "\r\n" + Output).Trim(); } }
        }

        // ---- start ----

        /// <summary>Run the program. A failure is written to the log, and shown unless this is a --test run.</summary>
        [STAThread]
        static int Main(string[] args)
        {
            bool test = Array.IndexOf(args, TestFlag) >= 0;
            string log = LogPath();
            try
            {
                return Launch(args, test, log);
            }
            catch (Exception ex)
            {
                return Fail(ex.ToString(), test, log);
            }
        }

        /// <summary>Find the program and a Python to run it, then run it. Returns the exit code.</summary>
        static int Launch(string[] args, bool test, string log)
        {
            string exePath = Process.GetCurrentProcess().MainModule.FileName;
            Install install = FindInstall(exePath, out string error);
            if (install == null)
                return Fail(error, test, log);
            Runtime python = install.Bundled ? FindBundled(install.BundledPython, out error) : FindPython(out error);
            if (python == null)
                return Fail(error, test, log);
            if (!HasWebview(python, install.Bundled, out error))
                return Fail("Could not load pywebview.\r\n" + error, test, log);
            if (File.Exists(log))
                File.Delete(log);
            SetEnvironment(install, python, args, log);
            // Python names itself after its own exe in a release, so its paths point into the unpacked folder.
            return RunPython(python, install.Bundled ? python.Exe : exePath, test, log);
        }

        /// <summary>The program beside this exe, or the one this exe carries. Null, with the reason, when there is neither.</summary>
        static Install FindInstall(string exePath, out string error)
        {
            error = "";
            var beside = new Install { Root = Path.GetDirectoryName(exePath) };
            if (File.Exists(beside.Script))
                return beside;
            string unpacked = Unpack(exePath, out error);
            if (unpacked == null)
                return null;
            return new Install { Root = unpacked, BundledPython = Path.Combine(unpacked, "python") };
        }

        /// <summary>Where a failed start leaves its reason.</summary>
        static string LogPath()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "launch.log");
        }

        /// <summary>Report why the start failed. Returns the exit code for a failure.</summary>
        static int Fail(string text, bool test, string log)
        {
            Report(text, test, log);
            return 1;
        }

        /// <summary>Write a message to the log and show it. A --test run only logs it.</summary>
        static void Report(string text, bool test, string log)
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

        // ---- the program files a released exe carries ----

        /// <summary>Unpack the program this exe carries, once per version. Returns its folder, or null with the reason.</summary>
        static string Unpack(string exePath, out string error)
        {
            error = NoProgramFiles;
            try
            {
                byte[] zip = ReadPack(exePath, ref error);
                if (zip == null)
                    return null;
                string appRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName, "app");
                string dest = Path.Combine(appRoot, HexHash(zip));
                if (!File.Exists(Path.Combine(dest, ReadyMark)))
                    Extract(zip, dest);
                DropOtherVersions(appRoot, dest);
                error = "";
                return dest;
            }
            catch (Exception ex)
            {
                error = "Gregmatics could not open its program files.\r\n" + ex.Message;
                return null;
            }
        }

        /// <summary>The zip appended to this exe. Null when it carries none, or when the zip is cut short.</summary>
        static byte[] ReadPack(string exePath, ref string error)
        {
            using (var stream = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                byte[] tail = ReadTail(stream);
                if (tail == null || Encoding.ASCII.GetString(tail, PackLengthBytes, PackMagic.Length) != PackMagic)
                    return null;
                int length = BitConverter.ToInt32(tail, 0);
                byte[] zip = length > 0 && length <= stream.Length - PackTailBytes ? ReadBefore(stream, PackTailBytes, length) : null;
                if (zip == null)
                    error = Damaged;
                return zip;
            }
        }

        /// <summary>The last bytes of a file, where the pack's length and marker go. Null when the file is too short.</summary>
        static byte[] ReadTail(FileStream stream)
        {
            if (stream.Length < PackTailBytes)
                return null;
            byte[] tail = new byte[PackTailBytes];
            stream.Seek(-PackTailBytes, SeekOrigin.End);
            return stream.Read(tail, 0, PackTailBytes) == PackTailBytes ? tail : null;
        }

        /// <summary>The `length` bytes that end `gap` bytes before the end of a file. Null when the file ends early.</summary>
        static byte[] ReadBefore(FileStream stream, int gap, int length)
        {
            stream.Seek(-((long)gap + length), SeekOrigin.End);
            byte[] bytes = new byte[length];
            int read = 0;
            while (read < length)
            {
                int got = stream.Read(bytes, read, length - read);
                if (got <= 0)
                    return null;
                read += got;
            }
            return bytes;
        }

        /// <summary>A SHA-256 hash in lower-case hex. It names the folder a pack unpacks to.</summary>
        static string HexHash(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                var text = new StringBuilder();
                foreach (byte b in sha.ComputeHash(bytes))
                    text.Append(b.ToString("x2"));
                return text.ToString();
            }
        }

        /// <summary>Unpack a zip into an empty folder, then mark the folder ready.</summary>
        static void Extract(byte[] zip, string dest)
        {
            if (Directory.Exists(dest))
                Directory.Delete(dest, true);
            Directory.CreateDirectory(dest);
            string inside = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
            using (var memory = new MemoryStream(zip))
            using (var archive = new ZipArchive(memory, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                    ExtractEntry(entry, dest, inside);
            }
            File.WriteAllText(Path.Combine(dest, ReadyMark), "ok");
        }

        /// <summary>Write one zip entry under a folder. An entry whose path would leave the folder is skipped.</summary>
        static void ExtractEntry(ZipArchiveEntry entry, string dest, string inside)
        {
            char slash = Path.DirectorySeparatorChar;
            string name = entry.FullName.Replace('/', slash).Replace('\\', slash);
            string path = Path.GetFullPath(Path.Combine(dest, name));
            if (!path.StartsWith(inside, StringComparison.OrdinalIgnoreCase))
                return;
            if (name.EndsWith(slash.ToString()) || entry.Name.Length == 0)
            {
                Directory.CreateDirectory(path);
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            entry.ExtractToFile(path, true);
        }

        /// <summary>Delete the unpacked folders of other versions. One still in use by a running copy stays.</summary>
        static void DropOtherVersions(string appRoot, string keep)
        {
            foreach (string old in Directory.GetDirectories(appRoot))
            {
                if (string.Equals(old, keep, StringComparison.OrdinalIgnoreCase))
                    continue;
                try
                {
                    Directory.Delete(old, true);
                }
                catch (IOException)
                {
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
        }

        // ---- finding Python ----

        /// <summary>The Python a released exe brings with it. Null, with the reason, when a file is missing.</summary>
        static Runtime FindBundled(string home, out string error)
        {
            string dll = VersionedDll(home);
            string exe = Path.Combine(home, "python.exe");
            if (dll == null || !File.Exists(exe))
            {
                error = "Gregmatics could not find its Python files.";
                return null;
            }
            error = "";
            return new Runtime { Home = home, Exe = exe, Dll = dll };
        }

        /// <summary>The DLL named for its version, such as python311.dll, and not the python3.dll stub beside it.</summary>
        static string VersionedDll(string home)
        {
            string found = null;
            foreach (string candidate in Directory.GetFiles(home, "python3*.dll"))
            {
                if (Path.GetFileName(candidate).Length > "python3.dll".Length)
                    found = candidate;
            }
            return found;
        }

        /// <summary>The Python the py launcher picks. Null, with the reason, when there is none.</summary>
        static Runtime FindPython(out string error)
        {
            Outcome asked = RunProcess("py", "-3 -c \"import sys; print(sys.base_prefix); print(sys.executable); print(sys.version_info[0]); print(sys.version_info[1])\"");
            if (asked.Code != 0)
            {
                error = "Python launcher \"py\" was not found.\r\nInstall Python 3 from python.org, then open Gregmatics again.\r\n" + asked.Errors;
                return null;
            }
            string[] lines = asked.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length < 4)
            {
                error = "Could not read the Python install path.";
                return null;
            }
            var python = new Runtime { Home = lines[0], Exe = lines[1], Dll = Path.Combine(lines[0], "python" + lines[2] + lines[3] + ".dll") };
            error = File.Exists(python.Dll) ? "" : "Could not find " + python.Dll;
            return error.Length == 0 ? python : null;
        }

        /// <summary>Whether Python can load pywebview. A Python that is not bundled gets it installed when it cannot.</summary>
        static bool HasWebview(Runtime python, bool bundled, out string error)
        {
            Outcome tried = RunProcess(python.Exe, "-c \"import webview\"");
            error = tried.Text;
            if (tried.Code == 0)
                return true;
            if (bundled)
                return false;
            Outcome installed = RunProcess(python.Exe, "-m pip install pywebview");
            error = installed.Text;
            return installed.Code == 0;
        }

        /// <summary>How to start a program with no window, so that what it prints can be read.</summary>
        static ProcessStartInfo Hidden(string fileName, string arguments)
        {
            return new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
        }

        /// <summary>Run a program without a window and wait for it. A program that cannot be started ends with -1.</summary>
        static Outcome RunProcess(string fileName, string arguments)
        {
            var output = new StringBuilder();
            var errors = new StringBuilder();
            using (var process = new Process())
            {
                process.StartInfo = Hidden(fileName, arguments);
                process.OutputDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };
                process.ErrorDataReceived += (_, e) => { if (e.Data != null) errors.AppendLine(e.Data); };
                try
                {
                    process.Start();
                }
                catch (Win32Exception ex)
                {
                    return new Outcome { Code = -1, Output = "", Errors = ex.Message };
                }
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return new Outcome { Code = process.ExitCode, Output = output.ToString(), Errors = errors.ToString() };
            }
        }

        // ---- running Python ----

        /// <summary>Tell Python which script to run and where its own files are, and move into the program's folder.</summary>
        static void SetEnvironment(Install install, Runtime python, string[] args, string log)
        {
            Environment.SetEnvironmentVariable("GREGMATICS_SCRIPT", install.Script);
            Environment.SetEnvironmentVariable("GREGMATICS_ARGV", args.Length == 0 ? "" : string.Join("\n", args));
            Environment.SetEnvironmentVariable("GREGMATICS_LOG", log);
            Environment.SetEnvironmentVariable("PYTHONHOME", python.Home);
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            Environment.SetEnvironmentVariable("PATH", python.Home + ";" + Path.Combine(python.Home, "DLLs") + ";" + path);
            Directory.SetCurrentDirectory(Path.Combine(install.Root, "blueprints"));
        }

        /// <summary>Load Python into this process and run the bootstrap. Returns the exit code.</summary>
        static int RunPython(Runtime python, string programName, bool test, string log)
        {
            TieStandardHandles();
            SetDllDirectory(python.Home);
            IntPtr module = LoadLibrary(python.Dll);
            if (module == IntPtr.Zero)
                return Fail("Could not load " + python.Dll + " (" + Marshal.GetLastWin32Error() + ").", test, log);

            SetWide setHome = Bind<SetWide>(module, "Py_SetPythonHome");
            SetWide setName = Bind<SetWide>(module, "Py_SetProgramName");
            InitFn init = Bind<InitFn>(module, "Py_Initialize");
            RunFn run = Bind<RunFn>(module, "PyRun_SimpleString");

            // Python keeps these strings for as long as it runs, so they are never freed.
            setHome(Marshal.StringToHGlobalUni(python.Home));
            setName(Marshal.StringToHGlobalUni(programName));
            init();
            SetDllDirectory(null);

            int result = run(Utf8(Bootstrap));
            GC.KeepAlive(setHome);
            GC.KeepAlive(setName);
            GC.KeepAlive(init);
            GC.KeepAlive(run);
            return result == 0 ? 0 : Fail(FailureDetail(log), test, log);
        }

        /// <summary>What the bootstrap wrote about a failure, or a plain message when it wrote nothing.</summary>
        static string FailureDetail(string log)
        {
            string detail = File.Exists(log) ? File.ReadAllText(log) : "";
            return detail.Trim().Length == 0 ? FailedToStart : detail;
        }

        /// <summary>A string as UTF-8 bytes ending in a zero, in memory Python can read.</summary>
        static IntPtr Utf8(string text)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text + "\0");
            IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            return memory;
        }

        /// <summary>A window program has no console. Give Python the NUL device, so a print does not fail.</summary>
        static void TieStandardHandles()
        {
            IntPtr read = CreateFile("NUL", GenericRead, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            IntPtr write = CreateFile("NUL", GenericWrite, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            if (IsOpen(read))
                SetStdHandle(StdInput, read);
            if (IsOpen(write))
            {
                SetStdHandle(StdOutput, write);
                SetStdHandle(StdError, write);
            }
        }

        /// <summary>Whether CreateFile gave back a handle.</summary>
        static bool IsOpen(IntPtr handle)
        {
            return handle != IntPtr.Zero && handle != new IntPtr(-1);
        }

        /// <summary>A function of the Python DLL, as something C# can call.</summary>
        static T Bind<T>(IntPtr module, string name) where T : Delegate
        {
            IntPtr address = GetProcAddress(module, name);
            if (address == IntPtr.Zero)
                throw new InvalidOperationException("Python is missing " + name + ".");
            return (T)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }
    }
}
