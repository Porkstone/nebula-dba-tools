const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

function validateScript(script) {
  if (
    typeof script !== "string" ||
    script.length > 1_000_000 ||
    script.includes("\0")
  )
    throw new Error("Enter a SQL script of at most 1,000,000 characters.");
  if (/^\s*(?:[:!]|(?:EXIT|QUIT|ED|RESET)\s*$)/im.test(script))
    throw new Error(
      "Use T-SQL and GO batches only; SQLCMD directives are not supported.",
    );
  return script;
}

function clean(value, label = "Value") {
  if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(`${label} is invalid.`);
  return value;
}
const literal = (value) => `N'${clean(value).replaceAll("'", "''")}'`;
const identifier = (value) => `[${clean(value).replaceAll("]", "]]")}]`;
function databaseFolder(root, name) {
  clean(name, "Database name");
  if (
    /[<>:"/\\|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(
      "This database name cannot be used as a Windows folder name. Rename the database before using managed backups.",
    );
  }
  if (!path.win32.isAbsolute(clean(root, "Backup folder")))
    throw new Error("Choose an absolute backup folder.");
  return path.win32.join(root, name);
}
function localServer(server) {
  clean(server, "Instance");
  const [host, instance, extra] = server.split("\\");
  if (
    extra ||
    ![".", "localhost", "(local)", os.hostname().toLowerCase()].includes(
      host.toLowerCase(),
    ) ||
    (instance !== undefined && !/^[a-z0-9_$-]{1,64}$/i.test(instance))
  ) {
    throw new Error(
      "Enter a local instance, such as localhost or localhost\\SQLEXPRESS.",
    );
  }
  return server;
}
function execute(
  file,
  args,
  { timeout = 15000, onOutput, encoding = "utf8" } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let output = "",
      error = "",
      exceeded = false;
    const timer = timeout
      ? setTimeout(() => {
          child.kill();
          reject(
            new Error(
              "Connection timed out. Check that the SQL Server service is running.",
            ),
          );
        }, timeout)
      : null;
    child.stdout.setEncoding(encoding);
    child.stdout.on("data", (data) => {
      output += data;
      onOutput?.(data);
      if (output.length > 16 * 1024 * 1024) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on("data", (data) => {
      error += data.toString();
      onOutput?.(data.toString());
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          err.code === "ENOENT"
            ? "SQLCMD was not found. Install Microsoft SQL Server command-line utilities and add sqlcmd to PATH."
            : err.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (exceeded)
        reject(new Error("SQLCMD output exceeded the allowed size."));
      else if (code !== 0)
        reject(
          new Error(
            (error || output || `SQLCMD exited with code ${code}`).trim(),
          ),
        );
      else resolve(output);
    });
  });
}
class SqlServer {
  constructor(server = "localhost", onProgress = () => {}) {
    this.server = localServer(server);
    this.onProgress = onProgress;
  }
  async query(sql, longRunning = false, options = {}) {
    // ODBC sqlcmd applies -u reliably to file output, not redirected stdout.
    const outputFile = path.join(os.tmpdir(), `nebula-sql-${randomUUID()}.txt`);
    try {
      await execute(
        "sqlcmd",
        [
          "-S",
          this.server,
          "-E",
          "-C",
          "-b",
          "-r",
          "1",
          "-l",
          "5",
          "-t",
          "0",
          "-d",
          options.database || "master",
          "-y",
          "0",
          "-w",
          "65535",
          "-u",
          "-o",
          outputFile,
          "-x",
          "-X1",
          ...(options.inputFile
            ? ["-i", options.inputFile]
            : ["-Q", `SET NOCOUNT ON; ${sql}`]),
        ],
        {
          timeout: longRunning ? 0 : 15000,
          onOutput: longRunning
            ? (text) => this.onProgress(text.trim())
            : undefined,
        },
      );
      return (await fs.readFile(outputFile, "utf16le")).replace(/^\uFEFF/, "");
    } catch (error) {
      const details = await fs.readFile(outputFile, "utf16le").catch(() => "");
      if (details.trim())
        throw new Error(
          `${error.message}\n${details.replace(/^\uFEFF/, "").trim()}`,
        );
      throw error;
    } finally {
      await fs.unlink(outputFile).catch(() => {});
    }
  }
  async json(sql) {
    const output = await this.query(sql);
    return JSON.parse(output.trim().split(/\r?\n/).join("") || "[]");
  }
  async runPostRestoreScript(name, script) {
    validateScript(script);
    if (!script.trim())
      throw new Error("No post restoration script is configured.");
    const db = await this.requireDatabase(name, true);
    if (db.state !== "ONLINE")
      throw new Error(
        "The restored database must be online to run the script.",
      );
    const inputFile = path.join(
      os.tmpdir(),
      `nebula-script-${randomUUID()}.sql`,
    );
    try {
      await fs.writeFile(inputFile, `\uFEFF${script}`, "utf16le");
      this.onProgress(`Running post restoration script on ${name}…`);
      await this.query("", true, { database: name, inputFile });
    } finally {
      await fs.unlink(inputFile).catch(() => {});
    }
  }
  async databases() {
    return this
      .json(`SELECT d.name, d.database_id AS id, d.state_desc AS state, d.recovery_model_desc AS recovery,
      CAST(COALESCE((SELECT SUM(CAST(size AS bigint))*8.0/1024 FROM sys.master_files f WHERE f.database_id=d.database_id),0) AS decimal(18,1)) AS sizeMB,
      CAST(CASE WHEN d.database_id <= 4 THEN 1 ELSE 0 END AS bit) AS system
      FROM sys.databases d ORDER BY d.name FOR JSON PATH;`);
  }
  async requireDatabase(name, restore = false) {
    const db = (await this.databases()).find((db) => db.name === name);
    if (!db)
      throw new Error(
        "The selected database no longer exists. Refresh the database list.",
      );
    if (restore && db.system)
      throw new Error("System database restores are not supported.");
    if (!restore && (db.name === "tempdb" || db.state !== "ONLINE"))
      throw new Error(
        "Only online databases other than tempdb can be backed up.",
      );
    return db;
  }
  async backup(name, root) {
    await this.requireDatabase(name);
    const folder = databaseFolder(root, name);
    await fs.mkdir(folder, { recursive: true });
    const filename = `${name}_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}.bak`;
    const destination = path.win32.join(folder, filename);
    this.onProgress("Creating a full copy-only backup…");
    await this.query(
      `BACKUP DATABASE ${identifier(name)} TO DISK = ${literal(destination)} WITH COPY_ONLY, CHECKSUM, NOINIT, STATS = 10;`,
      true,
    );
    this.onProgress("Verifying backup checksums…");
    await this.query(
      `RESTORE VERIFYONLY FROM DISK = ${literal(destination)} WITH CHECKSUM;`,
      true,
    );
    return destination;
  }
  async fileList(file) {
    // SnapshotURL was added in SQL Server 2016; this app targets SQL Server 2016+.
    return this
      .json(`CREATE TABLE #files (LogicalName nvarchar(128),PhysicalName nvarchar(260),Type char(1),FileGroupName nvarchar(128),Size numeric(20,0),MaxSize numeric(20,0),FileID bigint,CreateLSN numeric(25,0),DropLSN numeric(25,0),UniqueID uniqueidentifier,ReadOnlyLSN numeric(25,0),ReadWriteLSN numeric(25,0),BackupSizeInBytes bigint,SourceBlockSize int,FileGroupID int,LogGroupGUID uniqueidentifier,DifferentialBaseLSN numeric(25,0),DifferentialBaseGUID uniqueidentifier,IsReadOnly bit,IsPresent bit,TDEThumbprint varbinary(32),SnapshotURL nvarchar(360));
      INSERT INTO #files EXEC (${literal(`RESTORE FILELISTONLY FROM DISK = ${literal(file)} WITH FILE = 1`)});
      SELECT LogicalName AS name, Type AS type, FileID AS id FROM #files ORDER BY FileID FOR JSON PATH;`);
  }
  async restorePlan(name, file) {
    await this.requireDatabase(name, true);
    clean(file, "Backup file");
    if (
      !path.win32.isAbsolute(file) ||
      path.extname(file).toLowerCase() !== ".bak"
    )
      throw new Error("Choose a local .bak file.");
    await fs.access(file);
    this.onProgress("Reading backup file information…");
    const files = await this.fileList(file);
    if (!files.length || files.some((f) => !["D", "L"].includes(f.type)))
      throw new Error(
        "Only standard data and log files are supported; FILESTREAM backups need specialist restore tooling.",
      );
    const current = await this.json(
      `SELECT name, physical_name AS physical, CASE type WHEN 0 THEN 'D' ELSE 'L' END AS type FROM sys.master_files WHERE database_id=DB_ID(${literal(name)}) ORDER BY file_id FOR JSON PATH;`,
    );
    const defaults = await this.json(
      `SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260)) AS data, CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(260)) AS log FOR JSON PATH;`,
    );
    const used = new Set();
    return {
      database: name,
      backup: file,
      files: files.map((f) => {
        const match = current.find(
          (c) => c.type === f.type && !used.has(c.physical),
        );
        if (match) used.add(match.physical);
        const base = f.type === "L" ? defaults[0]?.log : defaults[0]?.data;
        if (!match && !base)
          throw new Error("Unable to resolve SQL Server data directories.");
        const destination =
          match?.physical ||
          path.win32.join(
            base,
            `nebula_${randomUUID()}_${f.id}.${f.type === "L" ? "ldf" : "ndf"}`,
          );
        return {
          logicalName: f.name,
          type: f.type === "L" ? "log" : "data",
          destination,
          overwrites: Boolean(match),
        };
      }),
    };
  }
  async restore(name, file, reviewedPlan) {
    const plan = reviewedPlan || (await this.restorePlan(name, file));
    if (
      plan?.database !== name ||
      plan?.backup !== file ||
      !Array.isArray(plan.files) ||
      !plan.files.length ||
      plan.files.some(
        (entry) =>
          typeof entry.logicalName !== "string" ||
          !["data", "log"].includes(entry.type) ||
          typeof entry.destination !== "string" ||
          !path.win32.isAbsolute(entry.destination),
      )
    )
      throw new Error("Review the restore again before continuing.");
    if (reviewedPlan) {
      await this.requireDatabase(name, true);
      clean(file, "Backup file");
      await fs.access(file);
    }
    const moves = plan.files
      .map(
        (entry) =>
          `MOVE ${literal(entry.logicalName)} TO ${literal(entry.destination)}`,
      )
      .join(", ");
    this.onProgress("Verifying the backup before restore…");
    await this.query(
      `RESTORE VERIFYONLY FROM DISK = ${literal(file)} WITH FILE = 1, ${moves};`,
      true,
    );
    this.onProgress(
      "Restoring database. Active connections are being disconnected…",
    );
    // One connection owns the single-user window. TRY/CATCH restores access on recoverable failures.
    await this.query(
      `BEGIN TRY
      IF EXISTS (SELECT 1 FROM sys.databases WHERE name=${literal(name)} AND state=0) ALTER DATABASE ${identifier(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      RESTORE DATABASE ${identifier(name)} FROM DISK = ${literal(file)} WITH FILE = 1, REPLACE, RECOVERY, ${moves}, STATS = 10;
      ALTER DATABASE ${identifier(name)} SET MULTI_USER;
      END TRY BEGIN CATCH
      IF EXISTS (SELECT 1 FROM sys.databases WHERE name=${literal(name)} AND state=0) ALTER DATABASE ${identifier(name)} SET MULTI_USER;
      THROW;
      END CATCH;`,
      true,
    );
    return name;
  }
}
async function discoverInstances() {
  try {
    const output = await execute("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@(Get-Service -Name 'MSSQLSERVER','MSSQL$*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress",
    ]);
    const values = JSON.parse(output.trim() || "[]");
    return [
      ...new Set([
        "localhost",
        ...[values]
          .flat()
          .map((n) =>
            n === "MSSQLSERVER" ? "localhost" : `localhost\\${n.slice(6)}`,
          ),
      ]),
    ];
  } catch {
    return ["localhost", "localhost\\SQLEXPRESS"];
  }
}
module.exports = {
  validateScript,
  SqlServer,
  databaseFolder,
  identifier,
  literal,
  localServer,
  discoverInstances,
};
