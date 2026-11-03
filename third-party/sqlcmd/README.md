# Bundled Microsoft SQLCMD

Nebula DBA ships the Windows x64 standalone Go client from [microsoft/go-sqlcmd](https://github.com/microsoft/go-sqlcmd). This replaces the external ODBC SQLCMD prerequisite and its ODBC / Visual C++ redistributable dependency chain.

`manifest.json` pins the upstream version, release archive URL, archive SHA-256, executable SHA-256 and upstream notice SHA-256. `scripts/prepare-sqlcmd.ps1` verifies those hashes before using the client. It extracts only `sqlcmd.exe` and `NOTICE.md`; the debug executable is excluded.

The MIT license is copied from the [v1.10.0 source tag](https://github.com/microsoft/go-sqlcmd/blob/v1.10.0/LICENSE). The upstream archive's `NOTICE.md` contains notices and licenses for the client's dependencies. Both are included next to the client in the packaged app's `resources/sqlcmd` directory.

To update the client, verify an official release's archive and file hashes, update the manifest and license, then run the backup/restore, post-restoration script and desktop integration tests before packaging.
