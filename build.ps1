<#
.SYNOPSIS
    Builds Gregmatics. Run it from the project folder: powershell -File .\build.ps1
.DESCRIPTION
    Writes start.exe here, which runs the code in this folder, and release\Gregmatics.exe, the
    program on its own: the launcher with Python, the window libraries, and the program's files
    packed onto its end. The version is the Version property in launcher\Gregmatics.csproj.
#>
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = $PSScriptRoot
$Launcher = Join-Path $Root "launcher"
$LauncherExe = Join-Path $Launcher "bin\Gregmatics.exe"
$ReleaseExe = Join-Path $Root "release\Gregmatics.exe"
# Where the build keeps what it downloads and puts together, outside the project.
$Cache = Join-Path $env:LOCALAPPDATA "Gregmatics\build"
$Payload = Join-Path $Cache "payload"
$PayloadZip = Join-Path $Cache "payload.zip"
# Program.cs finds the packed files by these eight letters at the very end of the exe.
$PackMark = "GREGPACK"
# The editor file the program writes when it runs, so it is not shipped.
$MadeAtRuntime = "data.js"

# Only the two Get- functions return a value. The rest do their work and return nothing, so what
# dotnet and pip print goes to the console and never ends up inside a result.

# ---- small pieces ----

# Stop the build when the program that just ran reported a failure.
function Assert-Succeeded([string]$Problem) {
    if ($LASTEXITCODE -ne 0) { throw $Problem }
}

# Make a folder, and any above it, if it is not there yet.
function New-Folder([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

# Make a folder that is empty, deleting what was in it.
function New-EmptyFolder([string]$Path) {
    if (Test-Path $Path) { Remove-Item $Path -Recurse -Force }
    New-Folder $Path
}

# ---- the launcher ----

# Compile the launcher into launcher\bin.
function Build-Launcher {
    dotnet build (Join-Path $Launcher "Gregmatics.csproj") -c Release -o (Join-Path $Launcher "bin")
    Assert-Succeeded "dotnet build failed"
}

# Put the launcher in the project folder as start.exe, and remove the name it had before.
function Copy-StartExe {
    Copy-Item $LauncherExe (Join-Path $Root "start.exe") -Force
    $old = Join-Path $Root "Gregmatics.exe"
    if (Test-Path $old) { Remove-Item $old -Force }
}

# ---- Python for the release ----

# The version of the Python that builds, such as 3.12.4. The release ships the same one.
function Get-PythonVersion {
    $line = py -3 -c "import sys; print('%d.%d.%d' % sys.version_info[:3])"
    return $line.Trim()
}

# The embeddable Python of a version, as a zip in the cache. It is downloaded once.
function Get-PythonEmbed([string]$Version) {
    New-Folder $Cache
    $name = "python-$Version-embed-amd64.zip"
    $zip = Join-Path $Cache $name
    if (-not (Test-Path $zip)) {
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$Version/$name" -OutFile $zip
    }
    return $zip
}

# Let the embedded Python import from Lib\site-packages. Its ._pth file lists where it may look.
function Enable-SitePackages([string]$PyHome) {
    $pth = Get-ChildItem $PyHome -Filter "python*._pth" | Select-Object -First 1
    if ($null -eq $pth) { throw "The Python embed has no ._pth file." }
    $kept = @([IO.File]::ReadAllLines($pth.FullName) | ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne "" -and -not $_.StartsWith("#") -and $_ -ne "import site" })
    $lines = $kept + @("Lib\site-packages", "import site")
    [IO.File]::WriteAllText($pth.FullName, (($lines -join "`n") + "`n"))
}

# Install pywebview, which brings pythonnet and WebView2, into the embedded Python.
function Install-WindowLibraries([string]$PyHome) {
    $site = Join-Path $PyHome "Lib\site-packages"
    New-Folder $site
    py -3 -m pip install --disable-pip-version-check --no-compile --target $site pywebview
    Get-ChildItem $site -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
}

# Stop the build unless the embedded Python can load the libraries the window needs.
function Test-WindowLibraries([string]$PyHome) {
    $code = "import clr; from webview.util import interop_dll_path; print(interop_dll_path('win-x64'))"
    & (Join-Path $PyHome "python.exe") -c $code | Out-Null
    Assert-Succeeded "Bundled Python could not import the window libraries."
}

# Unpack the Python embed into a folder and make it ready to open the window.
function Install-Python([string]$PyHome) {
    New-Folder $PyHome
    Expand-Archive -Path (Get-PythonEmbed (Get-PythonVersion)) -DestinationPath $PyHome
    Enable-SitePackages $PyHome
    Install-WindowLibraries $PyHome
}

# ---- the program's files ----

# Copy a folder and what is under it, leaving out Python's cache folders.
function Copy-Tree([string]$From, [string]$To) {
    Get-ChildItem $From -Recurse -File |
        Where-Object { $_.FullName -notlike "*\__pycache__\*" } |
        ForEach-Object {
            $relative = $_.FullName.Substring($From.Length).TrimStart("\")
            $dest = Join-Path $To $relative
            New-Folder (Split-Path -Parent $dest)
            Copy-Item $_.FullName $dest
        }
}

# Copy the editor's page, style, and scripts, folders and all, without the file the program writes itself.
function Copy-Editor([string]$Target) {
    $from = Join-Path $Root "blueprints\editor"
    Get-ChildItem $from -Recurse -File |
        Where-Object { $_.Name -ne $MadeAtRuntime } |
        ForEach-Object {
            $relative = $_.FullName.Substring($from.Length).TrimStart("\")
            $dest = Join-Path $Target $relative
            New-Folder (Split-Path -Parent $dest)
            Copy-Item $_.FullName $dest
        }
}

# Copy what the program runs from into a folder: the Python code, the catalog, the editor, and the
# two launcher files it reads its version and its icon from.
function Copy-Program([string]$Folder) {
    $blueprints = Join-Path $Folder "blueprints"
    New-Folder $blueprints
    Copy-Tree (Join-Path $Root "blueprints\python") (Join-Path $blueprints "python")
    Copy-Tree (Join-Path $Root "blueprints\catalog") (Join-Path $blueprints "catalog")
    Copy-Editor (Join-Path $blueprints "editor")
    $launcherFiles = Join-Path $Folder "launcher"
    New-Folder $launcherFiles
    Copy-Item (Join-Path $Launcher "Gregmatics.csproj") $launcherFiles
    Copy-Item (Join-Path $Launcher "Gregmatics.ico") $launcherFiles
}

# Put together, in a folder, everything the release unpacks when it first runs.
function New-Payload([string]$Folder) {
    New-EmptyFolder $Folder
    $pyHome = Join-Path $Folder "python"
    Install-Python $pyHome
    Copy-Program $Folder
    Test-WindowLibraries $pyHome
}

# Zip a folder, replacing the zip that was there.
function Compress-Payload([string]$Folder, [string]$Zip) {
    if (Test-Path $Zip) { Remove-Item $Zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Folder, $Zip)
}

# ---- the release ----

# Add a zip to the end of an exe, then its length as four bytes, then the mark.
function Add-Payload([string]$Exe, [string]$Zip) {
    $zipBytes = [IO.File]::ReadAllBytes($Zip)
    $stream = [IO.File]::Open($Exe, "Append")
    try {
        $stream.Write($zipBytes, 0, $zipBytes.Length)
        $stream.Write([BitConverter]::GetBytes([int]$zipBytes.Length), 0, 4)
        $stream.Write([Text.Encoding]::ASCII.GetBytes($PackMark), 0, $PackMark.Length)
    }
    finally {
        $stream.Close()
    }
}

# Write the release, in a folder of its own: the launcher with the payload on its end.
function New-Release([string]$Exe, [string]$Zip) {
    New-EmptyFolder (Split-Path -Parent $Exe)
    Copy-Item $LauncherExe $Exe
    Add-Payload $Exe $Zip
}

# ---- the build ----

Build-Launcher
Copy-StartExe
New-Payload $Payload
Compress-Payload $Payload $PayloadZip
New-Release $ReleaseExe $PayloadZip
Write-Host ("release {0:N1} MB" -f ((Get-Item $ReleaseExe).Length / 1MB))
