# Chocolatey package

Package ID: `nebula-dba-tools`. The package downloads the x64 portable executable from a versioned GitHub release and checks its SHA-256 hash. It installs Microsoft ODBC SQLCMD through `sqlserver-cmdlineutils`; it does not install SQL Server.

The Windows executable and Chocolatey command are `nebula-dba-tools.exe` / `nebula-dba-tools`. The portable download keeps its version: `nebula-dba-tools-0.1.0.exe`.

## Build and validate

From the repository root, after the GitHub release asset is available:

```powershell
New-Item -ItemType Directory -Force release/chocolatey | Out-Null
choco pack packaging/chocolatey/nebula-dba-tools.nuspec --output-directory release/chocolatey
choco install nebula-dba-tools --version 0.1.0 --source "release/chocolatey;https://community.chocolatey.org/api/v2/" --yes
choco uninstall nebula-dba-tools --yes
```

Use a disposable Windows VM for full dependency and lifecycle testing. On a machine that already has ODBC SQLCMD installed outside Chocolatey, `--ignore-dependencies` can validate this package without reinstalling those prerequisites. The application must be closed before uninstall or upgrade.

For script validation without administrator access, run `powershell -NoProfile -File scripts/test-chocolatey.ps1`. This extracts the nupkg into `test-results`, runs the real Chocolatey download and checksum helpers, checks x86 rejection, generates a GUI shim and verifies shortcut creation/removal. Start menu paths are redirected into the sandbox; it does not install the dependencies or exercise Chocolatey's elevated package lifecycle.

## Publish

Publish `nebula-dba-tools.png` from this directory to the repository's `master` branch before submitting. Check that the nuspec's jsDelivr `iconUrl` returns the PNG; for an immutable URL, replace `@master` with the commit containing the icon after it has been pushed. The icon uses the app's database mark and light-theme accent color at 128 by 128 pixels on a transparent background. Repack after changing the URL.

Push the validated nupkg to `https://push.chocolatey.org/` with `choco push`. Supply the publishing key through a private credential mechanism; never put it in source control. Submission starts Chocolatey's moderation process and does not mean the package is approved.

### Review of 0.1.0 (30 October 2026)

The [package review](https://community.chocolatey.org/packages/nebula-dba-tools/0.1.0) reports successful automated validation and installation/uninstallation on 28 October. An earlier verification failure was caused by a 504 Gateway Timeout from the Chocolatey feed, before package scripts ran; the later successful run supersedes it.

The two validator guidelines are addressed by adding `iconUrl` and pointing `projectSourceUrl` to the source commit recorded in the submitted package's verification file. The install URL, checksum and verification details now match the submitted and tested executable, rather than the older `Nebula-DBA-0.1.0.exe` release asset.

The 29 October virus-scan note reports between one and five detections and explicitly says this does not prevent approval. It remains for moderator review; a low detection count alone does not establish a false positive. The package continues to retrieve the same official executable with its SHA-256 verified. No scan exception or checksum bypass has been added.

Version `0.1.0` is still awaiting moderation. These local changes need to be published and the rebuilt package resubmitted before the website can reflect them. An unapproved version can be resubmitted with the same version number; follow Chocolatey's submission instructions.

## Updating the package

1. Build and test the application, then publish its versioned portable executable on GitHub.
2. Update the nuspec version, versioned metadata links (including `projectSourceUrl`), and install script download URL.
3. Calculate the executable's SHA-256 with `Get-FileHash -Algorithm SHA256`, and update `checksum64` and `tools/VERIFICATION.txt`.
4. Pack, inspect, test install/upgrade/uninstall in a disposable VM, and submit the nupkg.

Chocolatey automatically manages the GUI command shim. The uninstall script removes the Start menu shortcut. Settings, saved SQL scripts and database backups remain in their existing locations.
