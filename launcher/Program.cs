using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Gregmatics
{
    // Runs blueprints/desktop.py.
    internal static class Program
    {
        const uint MbOk = 0;
        const uint MbIconError = 0x10;
        const int StdInput = -10;
        const int StdOutput = -11;
        const int StdError = -12;
        const uint GenericRead = 0x80000000;
        const uint GenericWrite = 0x40000000;
        const uint ShareReadWrite = 3;
        const uint OpenExisting = 3;

        const string PackMagic = "GREGPACK";

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

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate void SetWide(IntPtr value);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate void InitFn();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate int RunFn(IntPtr command);

        [STAThread]
        static int Main(string[] args)
        {
            bool test = HasTest(args);
            string log = LogPath();
            try
            {
                return Launch(args, test, log);
            }
            catch (Exception ex)
            {
                Report(ex.ToString(), test, log);
                return 1;
            }
        }

        static int Launch(string[] args, bool test, string log)
        {
            string exePath = Process.GetCurrentProcess().MainModule.FileName;
            string exeDir = Path.GetDirectoryName(exePath);
            string root = exeDir;
            string script = Path.Combine(exeDir, "blueprints", "desktop.py");
            string bundledHome = null;
            if (!File.Exists(script))
            {
                root = Unpack(exePath, out string unpackError);
                if (root == null)
                {
                    Report(unpackError, test, log);
                    return 1;
                }
                script = Path.Combine(root, "blueprints", "desktop.py");
                bundledHome = Path.Combine(root, "python");
            }

            string home, pythonExe, dll, error;
            bool found;
            if (bundledHome != null)
            {
                home = bundledHome;
                found = FindBundled(home, out pythonExe, out dll, out error);
            }
            else
                found = FindPython(out home, out pythonExe, out dll, out error);
            if (!found)
            {
                Report(error, test, log);
                return 1;
            }

            if (!CanImport(pythonExe, "webview", out error))
            {
                if (bundledHome != null || !PipInstall(pythonExe, "pywebview", out error))
                {
                    Report("Could not load pywebview.\r\n" + error, test, log);
                    return 1;
                }
            }

            if (File.Exists(log))
                File.Delete(log);

            Environment.SetEnvironmentVariable("GREGMATICS_SCRIPT", script);
            Environment.SetEnvironmentVariable("GREGMATICS_ARGV", args.Length == 0 ? "" : string.Join("\n", args));
            Environment.SetEnvironmentVariable("GREGMATICS_LOG", log);
            Environment.SetEnvironmentVariable("PYTHONHOME", home);
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            Environment.SetEnvironmentVariable("PATH", home + ";" + Path.Combine(home, "DLLs") + ";" + path);
            Directory.SetCurrentDirectory(Path.Combine(root, "blueprints"));
            TieStandardHandles();
            SetDllDirectory(home);

            IntPtr module = LoadLibrary(dll);
            if (module == IntPtr.Zero)
            {
                Report("Could not load " + dll + " (" + Marshal.GetLastWin32Error() + ").", test, log);
                return 1;
            }

            SetWide setHome = Bind<SetWide>(module, "Py_SetPythonHome");
            SetWide setName = Bind<SetWide>(module, "Py_SetProgramName");
            InitFn init = Bind<InitFn>(module, "Py_Initialize");
            RunFn run = Bind<RunFn>(module, "PyRun_SimpleString");

            IntPtr homePtr = Marshal.StringToHGlobalUni(home);
            IntPtr namePtr = Marshal.StringToHGlobalUni(bundledHome != null ? pythonExe : exePath);
            setHome(homePtr);
            setName(namePtr);
            init();
            SetDllDirectory(null);

            byte[] code = Encoding.UTF8.GetBytes(Bootstrap + "\0");
            IntPtr codePtr = Marshal.AllocHGlobal(code.Length);
            Marshal.Copy(code, 0, codePtr, code.Length);
            int rc = run(codePtr);
            GC.KeepAlive(setHome);
            GC.KeepAlive(setName);
            GC.KeepAlive(init);
            GC.KeepAlive(run);
            if (rc != 0)
            {
                string detail = File.Exists(log) ? File.ReadAllText(log) : "";
                if (detail.Trim().Length == 0)
                    detail = "Gregmatics failed to start.";
                Report(detail, test, log);
                return 1;
            }
            return 0;
        }

        static bool HasTest(string[] args)
        {
            foreach (string arg in args)
            {
                if (arg == "--test")
                    return true;
            }
            return false;
        }

        static string LogPath()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gregmatics");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "launch.log");
        }

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
            if (text != null && text.Length > 2500)
                text = text.Substring(0, 2500);
            MessageBox(IntPtr.Zero, text ?? "Gregmatics failed to start.", "Gregmatics", MbOk | MbIconError);
        }

        // A released exe has a zip appended after the program, then its length and "GREGPACK".
        static string Unpack(string exePath, out string error)
        {
            error = "Gregmatics could not find its program files.";
            try
            {
                using (var stream = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (stream.Length < 12)
                        return null;
                    byte[] tail = new byte[12];
                    stream.Seek(-12, SeekOrigin.End);
                    if (stream.Read(tail, 0, 12) != 12)
                        return null;
                    if (Encoding.ASCII.GetString(tail, 4, 8) != PackMagic)
                        return null;
                    int length = BitConverter.ToInt32(tail, 0);
                    if (length <= 0 || length > stream.Length - 12)
                    {
                        error = "This copy of Gregmatics.exe is damaged.";
                        return null;
                    }
                    stream.Seek(-(12L + length), SeekOrigin.End);
                    byte[] zip = new byte[length];
                    int read = 0;
                    while (read < length)
                    {
                        int got = stream.Read(zip, read, length - read);
                        if (got <= 0)
                        {
                            error = "This copy of Gregmatics.exe is damaged.";
                            return null;
                        }
                        read += got;
                    }
                    string hash;
                    using (var sha = SHA256.Create())
                    {
                        byte[] sum = sha.ComputeHash(zip);
                        var text = new StringBuilder(sum.Length * 2);
                        foreach (byte b in sum)
                            text.Append(b.ToString("x2"));
                        hash = text.ToString();
                    }
                    string appRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gregmatics", "app");
                    string dest = Path.Combine(appRoot, hash);
                    string ready = Path.Combine(dest, "ready");
                    if (!File.Exists(ready))
                    {
                        if (Directory.Exists(dest))
                            Directory.Delete(dest, true);
                        Directory.CreateDirectory(dest);
                        using (var mem = new MemoryStream(zip))
                        using (var archive = new ZipArchive(mem, ZipArchiveMode.Read))
                        {
                            string fullDest = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
                            foreach (ZipArchiveEntry entry in archive.Entries)
                            {
                                string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                                string path = Path.GetFullPath(Path.Combine(dest, name));
                                if (!path.StartsWith(fullDest, StringComparison.OrdinalIgnoreCase))
                                    continue;
                                if (name.EndsWith(Path.DirectorySeparatorChar.ToString()) || entry.Name.Length == 0)
                                {
                                    Directory.CreateDirectory(path);
                                    continue;
                                }
                                Directory.CreateDirectory(Path.GetDirectoryName(path));
                                entry.ExtractToFile(path, true);
                            }
                        }
                        File.WriteAllText(ready, "ok");
                    }
                    if (Directory.Exists(appRoot))
                    {
                        foreach (string old in Directory.GetDirectories(appRoot))
                        {
                            if (string.Equals(old, dest, StringComparison.OrdinalIgnoreCase))
                                continue;
                            try
                            {
                                Directory.Delete(old, true);
                            }
                            catch (IOException)
                            {
                            }
                        }
                    }
                    error = "";
                    return dest;
                }
            }
            catch (Exception ex)
            {
                error = "Gregmatics could not open its program files.\r\n" + ex.Message;
                return null;
            }
        }

        static bool FindBundled(string home, out string pythonExe, out string dll, out string error)
        {
            pythonExe = Path.Combine(home, "python.exe");
            dll = "";
            foreach (string candidate in Directory.GetFiles(home, "python3*.dll"))
            {
                string name = Path.GetFileName(candidate);
                if (name.StartsWith("python3") && name.Length > "python3.dll".Length && name.EndsWith(".dll"))
                    dll = candidate;
            }
            if (!File.Exists(pythonExe) || dll.Length == 0 || !File.Exists(dll))
            {
                error = "Gregmatics could not find its Python files.";
                return false;
            }
            error = "";
            return true;
        }

        static bool FindPython(out string home, out string pythonExe, out string dll, out string error)
        {
            home = "";
            pythonExe = "";
            dll = "";
            string output = RunProcess("py", "-3 -c \"import sys; print(sys.base_prefix); print(sys.executable); print(sys.version_info[0]); print(sys.version_info[1])\"", out string stderr, out int code);
            if (code != 0)
            {
                error = "Python launcher \"py\" was not found.\r\nInstall Python 3 from python.org, then open Gregmatics again.\r\n" + stderr;
                return false;
            }
            string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length < 4)
            {
                error = "Could not read the Python install path.";
                return false;
            }
            home = lines[0];
            pythonExe = lines[1];
            dll = Path.Combine(home, "python" + lines[2] + lines[3] + ".dll");
            if (!File.Exists(dll))
            {
                error = "Could not find " + dll;
                return false;
            }
            error = "";
            return true;
        }

        static bool CanImport(string pythonExe, string module, out string detail)
        {
            string output = RunProcess(pythonExe, "-c \"import " + module + "\"", out string stderr, out int code);
            detail = (stderr + "\r\n" + output).Trim();
            return code == 0;
        }

        static bool PipInstall(string pythonExe, string package, out string error)
        {
            string output = RunProcess(pythonExe, "-m pip install " + package, out string stderr, out int code);
            error = (stderr + "\r\n" + output).Trim();
            return code == 0;
        }

        static string RunProcess(string fileName, string arguments, out string stderr, out int code)
        {
            var start = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            var output = new StringBuilder();
            var errors = new StringBuilder();
            using (var process = new Process())
            {
                process.StartInfo = start;
                process.OutputDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };
                process.ErrorDataReceived += (_, e) => { if (e.Data != null) errors.AppendLine(e.Data); };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                code = process.ExitCode;
            }
            stderr = errors.ToString();
            return output.ToString();
        }

        static void TieStandardHandles()
        {
            IntPtr read = CreateFile("NUL", GenericRead, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            IntPtr write = CreateFile("NUL", GenericWrite, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            if (read != IntPtr.Zero && read != new IntPtr(-1))
                SetStdHandle(StdInput, read);
            if (write != IntPtr.Zero && write != new IntPtr(-1))
            {
                SetStdHandle(StdOutput, write);
                SetStdHandle(StdError, write);
            }
        }

        static T Bind<T>(IntPtr module, string name) where T : Delegate
        {
            IntPtr address = GetProcAddress(module, name);
            if (address == IntPtr.Zero)
                throw new InvalidOperationException("Python is missing " + name + ".");
            return (T)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }
    }
}
