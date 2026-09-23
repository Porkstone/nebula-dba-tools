const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  SqlServer,
  databaseFolder,
  discoverInstances,
  validateScript,
} = require("./sql.cjs");
let window,
  sql,
  busy = false,
  settings = { backupRoot: "", server: "localhost" };
let selectedBackup, reviewedRestore;
if (!app.isPackaged && process.env.NEBULA_PROFILE_DIR)
  app.setPath("userData", path.resolve(process.env.NEBULA_PROFILE_DIR));
const configPath = () => path.join(app.getPath("userData"), "settings.json");
const save = () =>
  fs.writeFile(configPath(), JSON.stringify(settings, null, 2));
const progress = (text) => {
  if (text && window && !window.isDestroyed())
    window.webContents.send("progress", text);
};
function handle(name, callback) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted request.");
    try {
      return { ok: true, data: await callback(...args) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}
async function exclusive(fn) {
  if (busy) throw new Error("Wait for the current operation to finish.");
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}
const requireSql = () => {
  if (!sql) throw new Error("Connect to SQL Server first.");
  return sql;
};
async function readPostRestoreScript(name) {
  if (!settings.scriptRoot) return "";
  try {
    return await fs.readFile(
      path.join(databaseFolder(settings.scriptRoot, name), "post-restore.sql"),
      "utf8",
    );
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
async function listBackups(name) {
  if (!settings.backupRoot) return [];
  const folder = databaseFolder(settings.backupRoot, name);
  let files;
  try {
    files = await fs.readdir(folder, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return (
    await Promise.all(
      files
        .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".bak"))
        .map(async (f) => {
          const fullPath = path.join(folder, f.name),
            stat = await fs.stat(fullPath);
          return {
            name: f.name,
            path: fullPath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        }),
    )
  ).sort((a, b) => b.modified.localeCompare(a.modified));
}
async function requireKnownBackup(name, file) {
  const knownFile =
    file === selectedBackup ||
    (await listBackups(name)).some((backup) => backup.path === file);
  if (!knownFile)
    throw new Error("Choose the backup using the file picker or backup list.");
}
app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(await fs.readFile(configPath(), "utf8"));
    if (
      typeof saved.backupRoot === "string" &&
      typeof saved.server === "string"
    )
      settings = saved;
  } catch {
    /* First launch uses defaults. */
  }
  if (typeof settings.scriptRoot !== "string" || !settings.scriptRoot)
    settings.scriptRoot = path.join(
      app.getPath("userData"),
      "post-restoration-scripts",
    );
  handle("settings", async () => ({
    ...settings,
    instances: await discoverInstances(),
  }));
  handle("theme", (theme) => {
    if (!["light", "dark", "system"].includes(theme))
      throw new Error("Invalid theme.");
    nativeTheme.themeSource = theme;
  });
  handle("post-restore-script", readPostRestoreScript);
  handle("save-post-restore-script", (name, script) =>
    exclusive(async () => {
      validateScript(script);
      await requireSql().requireDatabase(name, true);
      const folder = databaseFolder(settings.scriptRoot, name);
      const file = path.join(folder, "post-restore.sql");
      if (script.trim()) {
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(file, script, "utf8");
      } else {
        await fs.unlink(file).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return script;
    }),
  );
  handle("connect", (server) =>
    exclusive(async () => {
      sql = undefined;
      reviewedRestore = undefined;
      const candidates = server
        ? [server]
        : [...new Set([settings.server, ...(await discoverInstances())])];
      const errors = [];
      for (const candidate of candidates) {
        try {
          const client = new SqlServer(candidate, progress),
            databases = await client.databases();
          settings.server = candidate;
          await save();
          sql = client;
          return { server: candidate, databases };
        } catch (e) {
          errors.push(`${candidate}: ${e.message}`);
        }
      }
      throw new Error(errors.join("\n"));
    }),
  );
  handle("choose-folder", () =>
    exclusive(async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "Choose backup storage",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: settings.backupRoot || undefined,
      });
      if (!result.canceled) {
        settings.backupRoot = result.filePaths[0];
        await save();
      }
      return settings.backupRoot;
    }),
  );
  handle("choose-backup", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose a SQL Server backup",
      defaultPath: settings.backupRoot || undefined,
      properties: ["openFile"],
      filters: [{ name: "SQL Server backup", extensions: ["bak"] }],
    });
    selectedBackup = result.canceled ? undefined : result.filePaths[0];
    reviewedRestore = undefined;
    return selectedBackup || null;
  });
  handle("backups", listBackups);
  handle("backup", (name) =>
    exclusive(async () => {
      if (!settings.backupRoot)
        throw new Error("Choose a backup folder first.");
      return requireSql().backup(name, settings.backupRoot);
    }),
  );
  handle("restore-plan", (name, file) =>
    exclusive(async () => {
      const client = requireSql();
      await requireKnownBackup(name, file);
      const plan = await client.restorePlan(name, file);
      reviewedRestore = { client, name, file, plan };
      return plan;
    }),
  );
  handle("restore", (name, file, confirmation) =>
    exclusive(async () => {
      const client = requireSql();
      await client.requireDatabase(name, true);
      if (confirmation !== name)
        throw new Error("Type the exact database name to confirm the restore.");
      await requireKnownBackup(name, file);
      if (
        reviewedRestore?.client !== client ||
        reviewedRestore?.name !== name ||
        reviewedRestore?.file !== file
      )
        throw new Error("Review the restore again before continuing.");
      const plan = reviewedRestore.plan;
      const script = await readPostRestoreScript(name);
      const overwritten = plan.files
        .filter((entry) => entry.overwrites)
        .map((entry) => path.win32.basename(entry.destination))
        .join(", ");
      const answer = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Overwrite database?",
        message: `Restore over ${name}?`,
        detail: `This replaces all current data in ${name} and disconnects active users. Changes since the backup will be lost.\n\nFiles overwritten: ${overwritten}\n\nBackup: ${file}`,
        buttons: ["Cancel", "Restore database"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer.response !== 1) return { canceled: true };
      await client.restore(name, file, plan);
      reviewedRestore = undefined;
      if (!script.trim()) return { canceled: false };
      progress(
        "Database restored. Waiting for the post restoration script decision…",
      );
      const run = await dialog.showMessageBox(window, {
        type: "question",
        title: "Post restoration script",
        message: "Execute the post restoration script?",
        detail: `${name} was restored successfully. Run the saved script on ${name} (${client.server}) using your Windows account?`,
        buttons: ["Skip", "Run script"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (run.response !== 1)
        return { canceled: false, scriptStatus: "skipped" };
      try {
        await client.runPostRestoreScript(name, script);
        return { canceled: false, scriptStatus: "completed" };
      } catch (error) {
        return {
          canceled: false,
          scriptStatus: "failed",
          scriptError: error.message,
        };
      }
    }),
  );
  handle("reveal-folder", async (name) => {
    if (!settings.backupRoot) throw new Error("Choose a backup folder first.");
    const folder = databaseFolder(settings.backupRoot, name);
    await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f7f8fa",
    title: "Nebula DBA",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = !app.isPackaged && process.env.NEBULA_DEV_URL;
  const entryUrl =
    devUrl || pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== entryUrl) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.on("close", (event) => {
    if (busy) {
      event.preventDefault();
      dialog.showMessageBox(window, {
        type: "info",
        message: "An operation is running.",
        detail: "Wait for it to finish before closing Nebula.",
      });
    }
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
