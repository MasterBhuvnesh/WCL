<#
.SYNOPSIS
  Silently install (or update) the WCL exam client on a Windows device.

.DESCRIPTION
  With no arguments this downloads the newest installer from the project's
  GitHub Releases and installs it silently, per-user (no admin, no UAC). This is
  the same script served for the one-line remote install:

    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/MasterBhuvnesh/WCL/main/app/client/scripts/install-wcl.ps1)"

  Overrides (work both as -Params when run as a file and as env vars when piped
  through iex, since iex can't take named parameters):
    -Scope     / $env:WCL_SCOPE      currentuser (default) | allusers
    -Installer / $env:WCL_INSTALLER  path to a local *-setup.exe to install
                                     instead of downloading the latest release

  'currentuser' installs for the logged-in account only and needs no admin, so
  in-app auto-updates stay fully seamless (they never raise a UAC prompt).
  'allusers' installs machine-wide and requires an elevated shell; auto-updates
  for a machine-wide install may then prompt for elevation.

.EXAMPLE
  # Latest release, per-user (default):
  powershell -ExecutionPolicy Bypass -File install-wcl.ps1

.EXAMPLE
  # A locally built installer:
  powershell -ExecutionPolicy Bypass -File install-wcl.ps1 -Installer .\wcl-1.0.5-setup.exe
#>
[CmdletBinding()]
param(
  [string]$Installer,
  [ValidateSet('allusers', 'currentuser')]
  [string]$Scope = 'currentuser'
)

$ErrorActionPreference = 'Stop'
$Repo = 'MasterBhuvnesh/WCL'

# Env-var fallbacks so the remote `iex` form (which can't pass -Params) is still
# configurable. Explicit -Params always win.
if (-not $PSBoundParameters.ContainsKey('Scope') -and $env:WCL_SCOPE) { $Scope = $env:WCL_SCOPE }
if (-not $PSBoundParameters.ContainsKey('Installer') -and $env:WCL_INSTALLER) { $Installer = $env:WCL_INSTALLER }

if (-not $Installer) {
  # Resolve the installer name from latest.yml (the manifest electron-updater
  # itself reads) via the releases/latest/download redirect. This is served by
  # GitHub's release CDN, not the REST API, so it has no 60-req/hour rate limit
  # — safe when thousands of devices install from one shared IP.
  $base = "https://github.com/$Repo/releases/latest/download"
  Write-Host "Resolving latest WCL release ..."
  # The release CDN serves latest.yml as application/octet-stream, so
  # .Content is a byte array, not a string; decode it before parsing.
  $resp = Invoke-WebRequest -Uri "$base/latest.yml" -UseBasicParsing
  $yml = if ($resp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($resp.Content) } else { $resp.Content }

  $name = $null
  foreach ($line in $yml -split "`n") {
    if ($line -match '^\s*path:\s*[''"]?(.+?-setup\.exe)[''"]?\s*$') { $name = $Matches[1].Trim(); break }
  }
  if (-not $name) {
    foreach ($line in $yml -split "`n") {
      if ($line -match '^\s*-?\s*url:\s*[''"]?(.+?-setup\.exe)[''"]?\s*$') { $name = $Matches[1].Trim(); break }
    }
  }
  if (-not $name) { throw "Could not determine installer name from latest.yml." }

  $Installer = Join-Path $env:TEMP $name
  Write-Host "Downloading $name ..."
  Invoke-WebRequest -Uri "$base/$name" -OutFile $Installer -UseBasicParsing
}

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

# Clear the mark-of-the-web on the freshly downloaded installer so SmartScreen
# doesn't interfere with the silent run.
try { Unblock-File -Path $Installer -ErrorAction SilentlyContinue } catch {}

# A running instance makes the NSIS installer fail while replacing its own
# files - often as an access-violation crash (exit code -1073741819 /
# 0xC0000005). Close any running WCL before installing.
Get-Process -Name 'wcl' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# /S = NSIS silent. perMachine:false already defaults to a per-user install, so
# we only pass an explicit scope for the machine-wide (allusers) case.
$installArgs = @('/S')
if ($Scope -eq 'allusers') { $installArgs += '/allusers' }

Write-Host "Installing WCL silently ($Scope) ..."
$proc = Start-Process -FilePath $Installer -ArgumentList $installArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  $code = $proc.ExitCode
  $hint = ''
  if ($code -eq -1073741819) {
    $hint = ' This is a 0xC0000005 access violation - usually WCL was still' +
      ' running, or antivirus/SmartScreen blocked the unsigned installer.' +
      " Close WCL and retry, or install by double-clicking: $Installer"
  }
  throw "Installer exited with code $code.$hint"
}

Write-Host "WCL installed successfully. A desktop shortcut has been created."
