# Build from the project folder: powershell -File .\build.ps1
# Writes start.exe here, and release\Gregmatics.exe, the program on its own.
# The version is the Version property in launcher/Gregmatics.csproj.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "launcher"

dotnet build (Join-Path $launcher "Gregmatics.csproj") -c Release -o (Join-Path $launcher "bin")
if ($LASTEXITCODE -ne 0) { throw "dotnet build failed" }
Copy-Item (Join-Path $launcher "bin\Gregmatics.exe") (Join-Path $root "start.exe") -Force
$old = Join-Path $root "Gregmatics.exe"
if (Test-Path $old) { Remove-Item $old -Force }

$verLine = py -3 -c "import sys; print('%d.%d.%d' % sys.version_info[:3])"
$ver = $verLine.Trim()
$cache = Join-Path $env:LOCALAPPDATA "Gregmatics\build"
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$embedZip = Join-Path $cache "python-$ver-embed-amd64.zip"
if (-not (Test-Path $embedZip)) {
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$ver/python-$ver-embed-amd64.zip" -OutFile $embedZip
}

$work = Join-Path $cache "payload"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$pyHome = Join-Path $work "python"
New-Item -ItemType Directory -Force -Path $pyHome | Out-Null
Expand-Archive -Path $embedZip -DestinationPath $pyHome

$pth = Get-ChildItem $pyHome -Filter "python*._pth" | Select-Object -First 1
if ($null -eq $pth) { throw "The Python embed has no ._pth file." }
$keep = @()
foreach ($line in [IO.File]::ReadAllLines($pth.FullName)) {
    $trim = $line.Trim()
    if ($trim -eq "" -or $trim.StartsWith("#") -or $trim -eq "import site") { continue }
    $keep += $trim
}
$keep += "Lib\site-packages"
$keep += "import site"
[IO.File]::WriteAllText($pth.FullName, (($keep -join "`n") + "`n"))

$site = Join-Path $pyHome "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $site | Out-Null
py -3 -m pip install --disable-pip-version-check --no-compile --target $site pywebview
Get-ChildItem $site -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

$blue = Join-Path $work "blueprints"
New-Item -ItemType Directory -Force -Path $blue | Out-Null
Copy-Item (Join-Path $root "blueprints\*.py") $blue
Copy-Item (Join-Path $root "blueprints\catalog") (Join-Path $blue "catalog") -Recurse
$editor = Join-Path $blue "editor"
New-Item -ItemType Directory -Force -Path $editor | Out-Null
foreach ($name in @("app.js", "core.js", "view3d.js", "editor.css", "index.html")) {
    Copy-Item (Join-Path $root "blueprints\editor\$name") $editor
}
New-Item -ItemType Directory -Force -Path (Join-Path $work "launcher") | Out-Null
Copy-Item (Join-Path $root "launcher\Gregmatics.csproj") (Join-Path $work "launcher")
Copy-Item (Join-Path $root "launcher\Gregmatics.ico") (Join-Path $work "launcher")

$check = & (Join-Path $pyHome "python.exe") -c "import clr; from webview.util import interop_dll_path; print(interop_dll_path('win-x64'))"
if ($LASTEXITCODE -ne 0) { throw "Bundled Python could not import the window libraries." }

$zip = Join-Path $cache "payload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($work, $zip)

$release = Join-Path $root "release"
if (Test-Path $release) { Remove-Item $release -Recurse -Force }
New-Item -ItemType Directory -Force -Path $release | Out-Null
$out = Join-Path $release "Gregmatics.exe"
Copy-Item (Join-Path $launcher "bin\Gregmatics.exe") $out
$zipBytes = [IO.File]::ReadAllBytes($zip)
$fs = [IO.File]::Open($out, "Append")
try {
    $fs.Write($zipBytes, 0, $zipBytes.Length)
    $len = [BitConverter]::GetBytes([int]$zipBytes.Length)
    $fs.Write($len, 0, 4)
    $magic = [Text.Encoding]::ASCII.GetBytes("GREGPACK")
    $fs.Write($magic, 0, 8)
}
finally {
    $fs.Close()
}
$item = Get-Item $out
Write-Host ("release {0:N1} MB" -f ($item.Length / 1MB))
