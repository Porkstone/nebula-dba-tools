# Nebula DBA

Licensed under the [MIT License](LICENSE).

A Windows Electron app for backing up and restoring local SQL Server databases. Built with React, TypeScript, Tailwind, Lucide and Microsoft SQLCMD. The interface follows the supplied Nebula application brand guidelines (edition 1.1), including Light, Dark and System appearance.

## Run

Requires Windows, Node.js 22.12+ (Node 24 recommended), pnpm, SQL Server 2016 or newer, and **Microsoft ODBC SQLCMD** on PATH. Your Windows account needs the relevant SQL Server backup/restore permissions. The app does not use a separate login or cloud service.

```powershell
pnpm install
pnpm dev
```

For a production build:

```powershell
pnpm build
pnpm start
```

Create an unsigned portable Windows executable:

```powershell
pnpm package
# release/Nebula-DBA-0.1.0.exe
```

The portable app still needs ODBC SQLCMD installed. `pnpm dev:web` opens only the browser interface; database operations require Electron. The launcher clears an inherited `ELECTRON_RUN_AS_NODE` variable when launched from coding tools.

## Using the app

1. On launch, Nebula attempts the last-used local instance, then local SQL Server services. Click the instance control to connect manually to `localhost` or `localhost\SQLEXPRESS`. Authentication uses the current Windows account.
2. Select a database from the searchable sidebar. System databases are grouped separately.
3. Choose a backup folder. Nebula remembers it and creates a child folder matching the database name, then writes a uniquely named timestamped `.bak` file there.
4. **Create backup** performs a full, copy-only backup with checksums, then runs `RESTORE VERIFYONLY`. Copy-only preserves existing differential backup chains. Verification checks readability and checksums; it is not a substitute for periodic test restores and `DBCC CHECKDB`.
5. To restore, choose a file from **Local backups** or browse to a `.bak` file. Review the target and source, type the exact target database name, then confirm the native warning. Restore disconnects active sessions and replaces the selected database. Back up current data first if you need to retain it.

The SQL Server **service account**, as well as the current Windows user, needs access to the backup folder. The app does not change filesystem permissions. Protected folders such as Program Files may reject folder creation. Choose a shared local folder accessible to both accounts.

## Scope and limitations

- Local Windows SQL Server instances only; integrated authentication. No SQL logins, remote servers, scheduling, retention, encryption configuration or cloud storage.
- Full database backups only. Restore uses backup set **1** from a single `.bak` file and recovers it immediately. Differential, log-chain, point-in-time and striped backups are not supported.
- Restores target an **existing user database**. Source logical files are mapped to the target's current physical files; additional files use unique names in SQL Server's default data/log directories. Original source database files are not reused for another target.
- System database restores and FILESTREAM/filetable restores are not supported. `tempdb` cannot be backed up. Database names that cannot form valid Windows directory names are rejected instead of silently renamed.
- Restore is destructive and not transactional. A server/storage failure during restore may leave a database requiring manual recovery; the app attempts to return online databases to multi-user mode on failure. There is no cancellation after an operation starts, and normal app closing is blocked until it finishes.
- Local SQLCMD connections trust the server certificate (`-C`) to support locally installed instances with self-signed certificates. The app rejects remote instance names.
- Settings live in Electron's user-data folder (`settings.json`); appearance is saved in local storage. Backups remain in the folder you choose. There is no telemetry.

## Checks

```powershell
pnpm lint
pnpm test
pnpm build
pnpm test:integration
pnpm test:desktop
```

The last two commands require a local SQL Server and permission to create/drop databases. They create uniquely named `Nebula_Test_*` / `Nebula_UI_Test_*` databases, back up and restore **only those databases**, and remove them afterward. Backups use `test-results` by default; for the SQL integration test, set `NEBULA_TEST_BACKUP_ROOT` if another folder is required. Never point tests at production infrastructure. A forcibly interrupted test may need its uniquely named test database cleaned up manually.

The desktop test launches real Electron with an isolated profile, exercises the actual IPC and SQL operations, substitutes native dialogs in the test process, checks restore cancellation/confirmation, and captures screenshots of both themes. Screenshots are in the ignored `test-results` folder.

## Structure

- `src/`: React interface, semantic theme tokens and typed desktop API.
- `electron/main.cjs`: trusted IPC, settings, native pickers and operation locking.
- `electron/preload.cjs`: narrow context-isolated API; no raw SQL or filesystem access in the renderer.
- `electron/sql.cjs`: local instance discovery, SQLCMD execution, quoting, backups, verification and file-aware restores.
- `tests/`: safety unit tests, real SQL round-trip tests and Electron UI tests.
- `docs/plans/implementation.html`: implementation plan for review.

Electron uses sandboxing, context isolation, disabled Node integration, a restrictive content security policy, IPC sender checks, denied new windows and blocked external navigation.

## References

- [Nebula application style guide supplied for this project](https://4dbmtyqz74.ufs.sh/f/6a90DS5AKGnk6qQg9g5AKGnkPOIs7ipX1mrNuUveSWJ2t6ZM)
- [Microsoft SQLCMD documentation](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-utility)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [dbatools](https://github.com/dataplat/dbatools), considered as an alternative; this app uses SQLCMD directly.
