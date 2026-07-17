@echo off
setlocal
:: Local convenience wrapper: double-click to install WCL for the current user
:: (silent, no admin needed). Runs the co-located install-wcl.ps1, which
:: downloads the latest release and installs it. Extra args pass through, e.g.
::   install-wcl.cmd -Installer .\wcl-1.0.5-setup.exe
:: For a machine-wide install run an elevated shell:  install-wcl.cmd -Scope allusers

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-wcl.ps1" %*
if %errorlevel% neq 0 (
  echo.
  echo Install failed. See the message above.
  pause
  exit /b 1
)

echo.
echo WCL installed. You can close this window.
pause
