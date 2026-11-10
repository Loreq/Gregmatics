# Build Gregmatics.exe. The window icon is launcher/Gregmatics.ico.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
dotnet build (Join-Path $here "Gregmatics.csproj") -c Release -o (Join-Path $here "bin")
Copy-Item (Join-Path $here "bin\Gregmatics.exe") (Join-Path $root "Gregmatics.exe") -Force
