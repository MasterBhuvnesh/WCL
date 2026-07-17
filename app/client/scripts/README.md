# WCL client deployment

Installers are published to [GitHub Releases](https://github.com/MasterBhuvnesh/WCL/releases)
by CI on every push to `main` that touches the client. After the first install,
clients auto-update themselves on launch — these scripts are only for the
initial rollout.

## Remote one-liner (no file copy)

Paste into **cmd** on the target device. Downloads the latest installer and
installs it silently, per-user (no admin, no UAC):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/MasterBhuvnesh/WCL/main/app/client/scripts/install-wcl.ps1)"
```

Fully hidden window (for login scripts / MDM):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "iex (irm https://raw.githubusercontent.com/MasterBhuvnesh/WCL/main/app/client/scripts/install-wcl.ps1)"
```

Machine-wide install (needs an elevated shell):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:WCL_SCOPE='allusers'; iex (irm https://raw.githubusercontent.com/MasterBhuvnesh/WCL/main/app/client/scripts/install-wcl.ps1)"
```

## Local scripts

- `install-wcl.cmd` — double-click to install for the current user.
- `install-wcl.ps1` — the installer itself; also served as the remote one-liner
  above. Supports `-Scope currentuser|allusers` and `-Installer <path-to-setup.exe>`.

> The raw URL resolves only after these scripts are on `main`, and GitHub's raw
> CDN caches for a few minutes, so a freshly pushed change can take a moment to
> appear.
