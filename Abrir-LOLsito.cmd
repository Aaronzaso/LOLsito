@echo off
setlocal
where dotnet >nul 2>&1
if errorlevel 1 (
    echo Hace falta el SDK de .NET 10 para compilar LOLsito.
    echo https://dotnet.microsoft.com/download/dotnet/10.0
    pause
    exit /b 1
)
dotnet build "%~dp0desktop\LOLsito.Desktop.csproj" -c Release --nologo -v quiet
if errorlevel 1 (
    echo No se pudo preparar LOLsito. Revisa el error anterior.
    pause
    exit /b 1
)
start "" "%~dp0desktop\bin\Release\net10.0-windows\LOLsito.exe"
