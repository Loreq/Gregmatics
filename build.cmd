@echo off
setlocal
cd /d "%~dp0"
dotnet build launcher\Gregmatics.csproj -c Release -o launcher\bin
if errorlevel 1 exit /b 1
copy /y launcher\bin\Gregmatics.exe start.exe >nul
if exist Gregmatics.exe del /f /q Gregmatics.exe
if not exist release mkdir release
if exist release\Gregmatics rmdir /s /q release\Gregmatics
if exist release\Gregmatics.zip del /f /q release\Gregmatics.zip
copy /y launcher\bin\Gregmatics.exe release\Gregmatics.exe >nul
echo release\Gregmatics.exe
exit /b 0
