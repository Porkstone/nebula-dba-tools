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
const { SqlServer, databaseFolder, discoverInstances } = require("./sql.cjs");
let window,
  sql,
  busy = false,
  settings = { backupRoot: "", server: "localhost" };
let selectedBackup;
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
  handle("settings", async () => ({
    ...settings,
    instances: await discoverInstances(),
  }));
  handle("theme", (theme) => {
    if (!["light", "dark", "system"].includes(theme))
      throw new Error("Invalid theme.");
    nativeTheme.themeSource = theme;
  });
  handle("connect", (server) =>
    exclusive(async () => {
      sql = undefined;
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
      properties: ["openFile"],
      filters: [{ name: "SQL Server backup", extensions: ["bak"] }],
    });
    selectedBackup = result.canceled ? undefined : result.filePaths[0];
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
  handle("restore", (name, file, confirmation) =>
    exclusive(async () => {
      const client = requireSql();
      await client.requireDatabase(name, true);
      if (confirmation !== name)
        throw new Error("Type the exact database name to confirm the restore.");
      const knownFile =
        file === selectedBackup ||
        (await listBackups(name)).some((f) => f.path === file);
      if (!knownFile)
        throw new Error(
          "Choose the backup using the file picker or backup list.",
        );
      const answer = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Overwrite database?",
        message: `Restore over ${name}?`,
        detail: `This replaces all current data in ${name} and disconnects active users. Changes since the backup will be lost.\n\nBackup: ${file}`,
        buttons: ["Cancel", "Restore database"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer.response !== 1) return { canceled: true };
      await client.restore(name, file);
      return { canceled: false };
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
