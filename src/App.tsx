import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database as DatabaseIcon,
  FileArchive,
  Folder,
  FolderOpen,
  HardDrive,
  Info,
  LoaderCircle,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import type { Backup, Database, RestorePlan, Result, Theme } from "./types";

const api = window.nebula;
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const fileName = (value: string) => value.split(/[\\/]/).pop() || value;

export default function App() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selected, setSelected] = useState("");
  const [server, setServer] = useState("localhost");
  const [instance, setInstance] = useState("localhost");
  const [instances, setInstances] = useState<string[]>([]);
  const [root, setRoot] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(Boolean(api));
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [tab, setTab] = useState<"backup" | "restore">("backup");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState("");
  const [file, setFile] = useState("");
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [reviewingRestore, setReviewingRestore] = useState(false);
  const [script, setScript] = useState("");
  const [loadingScript, setLoadingScript] = useState(false);
  const [scriptLoadError, setScriptLoadError] = useState("");
  const [savedScript, setSavedScript] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [operation, setOperation] = useState("");
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("nebula-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const restoreDialog = useRef<HTMLDialogElement>(null);
  const db = databases.find((item) => item.name === selected);
  const locked =
    Boolean(operation) ||
    connecting ||
    savingScript ||
    loadingScript ||
    reviewingRestore;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    localStorage.setItem("nebula-theme", theme);
    void api?.setTheme(theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (!api) return;
    let canceled = false;
    const unsubscribe = api.onProgress(setProgress);
    void (async () => {
      try {
        const settings = await unwrap(api.settings());
        if (canceled) return;
        setRoot(settings.backupRoot);
        setInstances(settings.instances);
        setInstance(settings.server);
        const connection = await unwrap(api.connect());
        if (canceled) return;
        setServer(connection.server);
        setInstance(connection.server);
        setDatabases(connection.databases);
        setConnected(true);
        setSelected(
          connection.databases.find((d) => !d.system && d.state === "ONLINE")
            ?.name ||
            connection.databases[0]?.name ||
            "",
        );
      } catch (error) {
        if (!canceled) {
          setNotice({ type: "error", text: message(error) });
          setConnectionOpen(true);
        }
      } finally {
        if (!canceled) setConnecting(false);
      }
    })();
    return () => {
      canceled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    if (api && selected) {
      setLoadingFiles(true);
      setFileError("");
      setBackups([]);
      unwrap(api.backups(selected))
        .then((files) => {
          if (!canceled) setBackups(files);
        })
        .catch((error) => {
          if (!canceled) setFileError(message(error));
        })
        .finally(() => {
          if (!canceled) setLoadingFiles(false);
        });
    }
    return () => {
      canceled = true;
    };
  }, [selected, root, revision]);

  useEffect(() => {
    if (!api || !selected) return;
    let canceled = false;
    setLoadingScript(true);
    setScriptLoadError("");
    setScript("");
    setSavedScript("");
    unwrap(api.postRestoreScript(selected))
      .then((value) => {
        if (!canceled) {
          setScript(value);
          setSavedScript(value);
        }
      })
      .catch((error) => {
        if (!canceled) setScriptLoadError(message(error));
      })
      .finally(() => {
        if (!canceled) setLoadingScript(false);
      });
    return () => {
      canceled = true;
    };
  }, [selected]);

  async function connect(target = instance) {
    if (!api) return;
    setConnecting(true);
    setNotice(null);
    setConnected(false);
    setDatabases([]);
    setSelected("");
    setBackups([]);
    setFile("");
    setRestorePlan(null);
    try {
      const result = await unwrap(api.connect(target));
      setServer(result.server);
      setInstance(result.server);
      setDatabases(result.databases);
      setConnected(true);
      setConnectionOpen(false);
      setSelected(
        result.databases.find((d) => !d.system && d.state === "ONLINE")?.name ||
          result.databases[0]?.name ||
          "",
      );
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
      setConnectionOpen(true);
    } finally {
      setConnecting(false);
    }
  }
  async function chooseFolder() {
    if (!api) return;
    try {
      setRoot(await unwrap(api.chooseFolder()));
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    }
  }
  async function chooseBackup() {
    if (!api) return;
    try {
      const result = await unwrap(api.chooseBackup());
      if (result) {
        setFile(result);
        setRestorePlan(null);
      }
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    }
  }
  async function runBackup() {
    if (!api || !db) return;
    setOperation("Backing up");
    setProgress("Preparing the backup…");
    setNotice(null);
    try {
      const destination = await unwrap(api.backup(db.name));
      setNotice({
        type: "success",
        text: `Backup created and verified: ${destination}`,
      });
      setRevision((r) => r + 1);
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      setOperation("");
    }
  }
  async function runRestore() {
    if (!api || !db || !restorePlan) return;
    restoreDialog.current?.close();
    setOperation("Restoring");
    setProgress("Waiting for restore confirmation…");
    setNotice(null);
    try {
      const result = await unwrap(api.restore(db.name, file, confirmation));
      if (!result.canceled) {
        setNotice({
          type: result.scriptStatus === "failed" ? "error" : "success",
          text:
            result.scriptStatus === "failed"
              ? `${db.name} was restored successfully, but the post restoration script failed. Earlier script statements may already have taken effect.\n${result.scriptError}`
              : result.scriptStatus === "completed"
                ? `${db.name} was restored and the post restoration script completed.`
                : result.scriptStatus === "skipped"
                  ? `${db.name} was restored. The post restoration script was skipped.`
                  : `${db.name} was restored and is ready to use.`,
        });
        const connection = await unwrap(api.connect(server));
        setDatabases(connection.databases);
      }
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      setOperation("");
      setConfirmation("");
    }
  }
  async function reviewRestore() {
    if (!api || !db || !file) return;
    setReviewingRestore(true);
    setNotice(null);
    setRestorePlan(null);
    try {
      const plan = await unwrap(api.restorePlan(db.name, file));
      setRestorePlan(plan);
      setConfirmation("");
      restoreDialog.current?.showModal();
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      setReviewingRestore(false);
    }
  }
  async function saveScript() {
    if (!api || !db) return;
    setSavingScript(true);
    try {
      setSavedScript(await unwrap(api.savePostRestoreScript(db.name, script)));
      setNotice({
        type: "success",
        text: script.trim()
          ? "Post restoration script saved."
          : "Post restoration script removed.",
      });
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      setSavingScript(false);
    }
  }
  const visible = databases.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const databaseButton = (item: Database) => (
    <button
      key={item.name}
      disabled={locked}
      className={`database-item ${selected === item.name ? "selected" : ""}`}
      title={item.name}
      onClick={() => {
        setSelected(item.name);
        setFile("");
        setRestorePlan(null);
        setNotice(null);
      }}
      aria-current={selected === item.name ? "page" : undefined}
    >
      <DatabaseIcon size={16} />
      <span>{item.name}</span>
      {selected === item.name ? (
        <ChevronRight size={14} />
      ) : item.state !== "ONLINE" ? (
        <CircleAlert size={14} />
      ) : null}
    </button>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <DatabaseIcon size={25} strokeWidth={1.5} />
          </div>
          <div>
            <strong>
              Nebula <span>DBA</span>
            </strong>
            <p>Local database workspace</p>
          </div>
        </div>
        <button
          className="server-switch"
          onClick={() => setConnectionOpen(!connectionOpen)}
          disabled={locked}
        >
          <Server size={18} />
          <span>
            <strong>{server}</strong>
            <small>
              <i className={`dot ${connected ? "online" : ""}`} />
              {connecting
                ? "Connecting…"
                : connected
                  ? "Windows authentication"
                  : "Not connected"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="sidebar-heading">
          <span>
            Databases <b>{databases.length}</b>
          </span>
          <button
            className="icon-button"
            title="Refresh databases"
            aria-label="Refresh databases"
            onClick={() => connect(server)}
            disabled={locked || !api}
          >
            <RefreshCw size={15} className={connecting ? "spin" : ""} />
          </button>
        </div>
        <label className="search">
          <Search size={16} />
          <input
            placeholder="Find a database…"
            aria-label="Find a database"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <nav className="database-list" aria-label="Databases">
          {visible.filter((d) => !d.system).map(databaseButton)}
          {!connecting && !databases.length && (
            <p className="sidebar-empty">
              Connect to your local SQL Server to see databases here.
            </p>
          )}
          {!!databases.length && !visible.length && (
            <p className="sidebar-empty">No matching databases.</p>
          )}
          {!!visible.filter((d) => d.system).length && (
            <>
              <button
                className="system-toggle"
                onClick={() => setShowSystem(!showSystem)}
                aria-expanded={showSystem || Boolean(search)}
              >
                <ChevronRight
                  size={13}
                  className={showSystem || search ? "rotate" : ""}
                />
                System databases{" "}
                <span>{visible.filter((d) => d.system).length}</span>
              </button>
              {(showSystem || search) &&
                visible.filter((d) => d.system).map(databaseButton)}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="theme-label">Appearance</div>
          <div className="theme-picker" aria-label="Appearance">
            {(
              [
                { value: "light", icon: Sun, label: "Light" },
                { value: "dark", icon: Moon, label: "Dark" },
                { value: "system", icon: Monitor, label: "System" },
              ] as const
            ).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                className={theme === value ? "active" : ""}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="local-label">
            <ShieldCheck size={14} />
            On your machine. In your control.
          </div>
        </div>
      </aside>
      <main className="main-pane">
        <header className="topbar">
          <div>
            <Server size={15} />
            <span>{server}</span>
            <ChevronRight size={13} />
            <strong>Backup & restore</strong>
          </div>
          <span className="connection-status">
            <i className={`dot ${connected ? "online" : ""}`} />
            {connecting
              ? "Connecting"
              : connected
                ? "Connected locally"
                : "Offline"}
          </span>
        </header>
        <div className="workspace">
          {!api && (
            <div className="notice" role="status">
              <Info size={19} />
              <div>
                <strong>Open the desktop app to connect</strong>
                <p>
                  This browser view previews the interface. Run{" "}
                  <code>pnpm dev</code> to use SQL Server, backups and native
                  file pickers.
                </p>
              </div>
            </div>
          )}
          {connectionOpen && (
            <section className="panel connection-panel">
              <div>
                <h2>Local SQL Server</h2>
                <p>Connect using your current Windows account.</p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <label htmlFor="instance">Instance</label>
                <div className="flex gap-3">
                  <input
                    id="instance"
                    list="instances"
                    value={instance}
                    onChange={(event) => setInstance(event.target.value)}
                    placeholder="localhost\SQLEXPRESS"
                    disabled={locked}
                  />
                  <datalist id="instances">
                    {instances.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                  <button className="button primary" disabled={locked || !api}>
                    {connecting ? "Connecting…" : "Connect"}
                  </button>
                </div>
              </form>
            </section>
          )}
          {notice && (
            <div
              className={`notice ${notice.type}`}
              role={notice.type === "error" ? "alert" : "status"}
            >
              {notice.type === "error" ? (
                <CircleAlert size={20} />
              ) : (
                <CheckCircle2 size={20} />
              )}
              <div>
                <strong>
                  {notice.type === "error"
                    ? "Operation could not complete"
                    : "Operation complete"}
                </strong>
                <p>{notice.text}</p>
                {notice.type === "error" && (
                  <p className="help">
                    Check the SQL Server service, Windows login permissions, and
                    SQL Server service account access to the backup folder.
                  </p>
                )}
              </div>
              <button
                className="icon-button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">DATABASE OPERATIONS</div>
              <h1>Backup & restore</h1>
              <p>A reliable copy. A clear way back.</p>
            </div>
            <div className="heading-icon">
              <Archive size={32} strokeWidth={1.3} />
            </div>
          </div>
          {db ? (
            <>
              <section className="database-summary">
                <div className="database-emblem">
                  <DatabaseIcon size={24} strokeWidth={1.5} />
                </div>
                <div className="database-title">
                  <h2 title={db.name}>{db.name}</h2>
                  <span>
                    {db.system ? "System database" : "User database"}{" "}
                    <span className="separator">/</span> {server}
                  </span>
                </div>
                <div
                  className={`state-tag ${db.state === "ONLINE" ? "" : "caution"}`}
                >
                  <i
                    className={`dot ${db.state === "ONLINE" ? "online" : ""}`}
                  />
                  {db.state.toLowerCase()}
                </div>
                <div className="summary-stat">
                  <span>Database size</span>
                  <strong>{bytes(db.sizeMB * 1024 ** 2)}</strong>
                </div>
                <div className="summary-stat">
                  <span>Recovery model</span>
                  <strong>{db.recovery.toLowerCase()}</strong>
                </div>
              </section>
              <div className="tabs" aria-label="Database operations">
                <button
                  aria-pressed={tab === "backup"}
                  id="backup-tab"
                  className={tab === "backup" ? "active" : ""}
                  onClick={() => setTab("backup")}
                  disabled={locked}
                >
                  <ArrowDownToLine size={17} />
                  Back up database
                </button>
                <button
                  aria-pressed={tab === "restore"}
                  id="restore-tab"
                  className={tab === "restore" ? "active" : ""}
                  onClick={() => setTab("restore")}
                  disabled={locked}
                >
                  <ArrowUpFromLine size={17} />
                  Restore database
                </button>
              </div>
              <section
                className="panel operation-panel"
                id="operation-panel"
                aria-labelledby={`${tab}-tab`}
              >
                {tab === "backup" ? (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Create a backup</h2>
                        <p>
                          A full copy of your database, stored where you choose.
                        </p>
                      </div>
                      <span className="quiet-tag">FULL BACKUP</span>
                    </div>
                    <div className="field-label">Backup location</div>
                    <div className="folder-control">
                      <Folder size={20} />
                      <div className="folder-value">
                        {root ? (
                          <code title={root}>{root}</code>
                        ) : (
                          <span>Choose a folder for your database backups</span>
                        )}
                      </div>
                      <button
                        className="button"
                        disabled={locked || !api}
                        onClick={chooseFolder}
                      >
                        {root ? "Change folder" : "Choose folder"}
                        <FolderOpen size={15} />
                      </button>
                    </div>
                    <div className="path-preview">
                      <span className="path-branch">└</span>
                      <Folder size={14} />
                      <code>{db.name}</code>
                      <ChevronRight size={12} />
                      <span>Timestamped .bak files</span>
                    </div>
                    <div className="backup-details">
                      <div>
                        <ShieldCheck size={18} />
                        <span>
                          <strong>Copy-only backup</strong>
                          <small>Preserves your existing backup chain</small>
                        </span>
                      </div>
                      <div>
                        <CheckCircle2 size={18} />
                        <span>
                          <strong>Verified after backup</strong>
                          <small>Checksums checked before completion</small>
                        </span>
                      </div>
                    </div>
                    <div className="action-footer">
                      <p>
                        <Info size={15} />
                        SQL Server needs write access to this folder.
                      </p>
                      <button
                        className="button primary"
                        disabled={
                          locked ||
                          !root ||
                          db.state !== "ONLINE" ||
                          db.name === "tempdb"
                        }
                        onClick={runBackup}
                      >
                        <ArrowDownToLine size={17} />
                        Create backup
                      </button>
                    </div>
                    {(db.state !== "ONLINE" || db.name === "tempdb") && (
                      <p className="inline-warning">
                        {db.name === "tempdb"
                          ? "SQL Server does not support backing up tempdb."
                          : `Backups are unavailable while this database is ${db.state.toLowerCase()}.`}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Restore from a backup</h2>
                        <p>
                          Replace this database with a previously saved copy.
                        </p>
                      </div>
                      <ArrowUpFromLine size={23} className="muted" />
                    </div>
                    {db.system ? (
                      <div className="notice">
                        <Info size={20} />
                        <p>
                          System database restores require a dedicated recovery
                          procedure. Select a user database to restore here.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="field-label">Backup file</div>
                        <div className="folder-control">
                          <FileArchive size={20} />
                          <div className="folder-value">
                            <code title={file}>
                              {file || "Select a .bak file or choose one below"}
                            </code>
                          </div>
                          <button
                            className="button"
                            disabled={locked}
                            onClick={chooseBackup}
                          >
                            Browse files
                            <FolderOpen size={15} />
                          </button>
                        </div>
                        <section
                          className="post-restore-script"
                          aria-labelledby="post-script-heading"
                        >
                          <div className="section-heading">
                            <div>
                              <h2 id="post-script-heading">
                                Post restoration script
                              </h2>
                              <p>
                                Optional SQL for {db.name}. After a successful
                                restore, you’ll be asked whether to run this
                                database’s saved script.
                              </p>
                            </div>
                          </div>
                          {scriptLoadError && (
                            <p role="alert">
                              Could not load script: {scriptLoadError}
                            </p>
                          )}
                          <label className="field-label" htmlFor="post-script">
                            SQL script
                          </label>
                          <textarea
                            id="post-script"
                            value={script}
                            onChange={(event) => setScript(event.target.value)}
                            disabled={locked || Boolean(scriptLoadError)}
                            spellCheck={false}
                            maxLength={1000000}
                            placeholder="-- Enter your post restoration SQL here"
                          />
                          <div className="action-footer">
                            <p role="status">
                              {script !== savedScript
                                ? "Unsaved changes. Save or discard them before restoring."
                                : savedScript.trim()
                                  ? "Script saved. You can skip it after any restore."
                                  : "No script configured. No prompt will be shown."}
                            </p>
                            <div className="flex gap-2">
                              <button
                                className="button"
                                disabled={locked || script === savedScript}
                                onClick={() => setScript(savedScript)}
                              >
                                Discard changes
                              </button>
                              <button
                                className="button"
                                disabled={locked || script === savedScript}
                                onClick={saveScript}
                              >
                                {savingScript ? "Saving…" : "Save script"}
                              </button>
                            </div>
                          </div>
                          <p className="script-help">
                            T-SQL and GO batches are supported. Runs with your
                            Windows permissions; explicit USE statements can
                            change the database context. Clear and save to
                            remove the script.
                          </p>
                        </section>
                        <div className="restore-warning">
                          <CircleAlert size={19} />
                          <div>
                            <strong>
                              Restoring replaces the current database
                            </strong>
                            <p>
                              Active connections will be closed. All changes
                              made after the backup will be lost. Create a fresh
                              backup first if you need to keep the current data.
                            </p>
                          </div>
                        </div>
                        <div className="action-footer">
                          <p>
                            <ShieldCheck size={15} />
                            The backup is verified before restoring.
                          </p>
                          <button
                            className="button primary"
                            disabled={locked || !file || script !== savedScript}
                            onClick={reviewRestore}
                          >
                            <ArrowUpFromLine size={17} />
                            {reviewingRestore ? "Reviewing…" : "Review restore"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
              {operation && (
                <div
                  className="operation-progress"
                  role="status"
                  aria-live="polite"
                >
                  <LoaderCircle className="spin" size={22} />
                  <div>
                    <strong>
                      {operation} {db.name}
                    </strong>
                    <p>{progress || "Working…"}</p>
                    <small>
                      Keep Nebula open until the operation finishes.
                    </small>
                  </div>
                  <span className="progress-pulse" />
                </div>
              )}
              <section className="panel backup-library">
                <div className="section-heading">
                  <div className="flex items-center gap-3">
                    <h2>Local backups</h2>
                    <span className="count">{backups.length}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-button"
                      disabled={!root || locked}
                      onClick={async () => {
                        if (api)
                          try {
                            await unwrap(api.revealFolder(db.name));
                          } catch (error) {
                            setNotice({ type: "error", text: message(error) });
                          }
                      }}
                    >
                      <FolderOpen size={15} />
                      Open folder
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Refresh backups"
                      disabled={locked || loadingFiles}
                      onClick={() => setRevision((r) => r + 1)}
                    >
                      <RefreshCw
                        size={15}
                        className={loadingFiles ? "spin" : ""}
                      />
                    </button>
                  </div>
                </div>
                {fileError ? (
                  <div className="empty-library">
                    <CircleAlert size={25} />
                    <strong>Could not read backup folder</strong>
                    <p>{fileError}</p>
                  </div>
                ) : loadingFiles ? (
                  <div className="empty-library">
                    <LoaderCircle className="spin" size={24} />
                    <p>Reading backup folder…</p>
                  </div>
                ) : !backups.length ? (
                  <div className="empty-library">
                    <div className="empty-icon">
                      <Archive size={27} strokeWidth={1.3} />
                    </div>
                    <strong>Your next restore starts here</strong>
                    <p>
                      {root
                        ? "Create your first backup. It will appear here, ready when you need it."
                        : "Choose a backup folder to start building your local backup library."}
                    </p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Backup file</th>
                          <th>Created / modified</th>
                          <th>Size</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {backups.map((backup) => (
                          <tr key={backup.path}>
                            <td>
                              <div className="file-name">
                                <FileArchive size={17} />
                                <span title={backup.name}>{backup.name}</span>
                              </div>
                            </td>
                            <td>{date(backup.modified)}</td>
                            <td className="mono">{bytes(backup.size)}</td>
                            <td>
                              <button
                                className="text-button"
                                disabled={locked || db.system}
                                onClick={() => {
                                  setFile(backup.path);
                                  setRestorePlan(null);
                                  setTab("restore");
                                  document
                                    .getElementById("restore-tab")
                                    ?.focus();
                                }}
                              >
                                {file === backup.path && tab === "restore" ? (
                                  <Check size={14} />
                                ) : (
                                  <ArrowUpFromLine size={14} />
                                )}
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <div className="workspace-footnote">
                <HardDrive size={13} />
                Backups stay on your machine
                <span>SQLCMD · Windows authentication</span>
              </div>
            </>
          ) : (
            <section className="panel welcome">
              <div className="empty-icon">
                {connecting ? (
                  <LoaderCircle size={32} className="spin" />
                ) : (
                  <DatabaseIcon size={32} />
                )}
              </div>
              <h2>
                {connecting
                  ? "Finding your databases…"
                  : "Your databases, in one place"}
              </h2>
              <p>
                {connecting
                  ? "Connecting to the local SQL Server with your Windows account."
                  : connected
                    ? "Choose a database from the sidebar to get started."
                    : "Connect to a local SQL Server instance to create and restore backups."}
              </p>
              {!connecting && !connected && (
                <button
                  className="button primary"
                  disabled={!api}
                  onClick={() => connect()}
                >
                  Connect to SQL Server
                </button>
              )}
            </section>
          )}
        </div>
      </main>
      <dialog
        ref={restoreDialog}
        className="restore-dialog"
        aria-labelledby="restore-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runRestore();
          }}
        >
          <div className="dialog-heading">
            <div className="warning-icon">
              <CircleAlert size={24} />
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close restore confirmation"
              onClick={() => restoreDialog.current?.close()}
            >
              <X size={20} />
            </button>
          </div>
          <h2 id="restore-title">Restore {db?.name}?</h2>
          <p>
            This will overwrite the selected database and disconnect active
            users. Changes since this backup will be lost.
          </p>
          <div className="restore-file">
            <FileArchive size={18} />
            <code>{file}</code>
          </div>
          <section
            className="restore-targets"
            aria-labelledby="restore-targets-title"
          >
            <div className="restore-targets-heading">
              <span>
                <HardDrive size={17} />
                <strong id="restore-targets-title">
                  Database files that will be overwritten
                </strong>
              </span>
              <small>
                {restorePlan?.files.filter((entry) => entry.overwrites)
                  .length || 0}{" "}
                {(restorePlan?.files.filter((entry) => entry.overwrites)
                  .length || 0) === 1
                  ? "file"
                  : "files"}
              </small>
            </div>
            <ul>
              {restorePlan?.files
                .filter((entry) => entry.overwrites)
                .map((entry) => (
                  <li key={`${entry.logicalName}-${entry.destination}`}>
                    <span className="restore-file-type">
                      {fileName(entry.destination)
                        .match(/\.(mdf|ndf|ldf)$/i)?.[1]
                        .toUpperCase() ||
                        (entry.type === "log" ? "LOG" : "DATA")}
                    </span>
                    <span>
                      <code>{fileName(entry.destination)}</code>
                      <small title={entry.destination}>
                        {entry.destination}
                      </small>
                    </span>
                  </li>
                ))}
            </ul>
            {!restorePlan?.files.some((entry) => entry.overwrites) && (
              <p className="restore-targets-empty">
                No existing database files will be overwritten.
              </p>
            )}
          </section>
          {restorePlan?.files.some((entry) => !entry.overwrites) && (
            <section
              className="restore-targets"
              aria-label="Database files that will be created"
            >
              <div className="restore-targets-heading">
                <strong>Database files that will be created</strong>
              </div>
              <ul>
                {restorePlan.files
                  .filter((entry) => !entry.overwrites)
                  .map((entry) => (
                    <li key={entry.destination}>
                      <span className="restore-file-type">
                        {fileName(entry.destination)
                          .match(/\.(mdf|ndf|ldf)$/i)?.[1]
                          .toUpperCase() ||
                          (entry.type === "log" ? "LOG" : "DATA")}
                      </span>
                      <span>
                        <code>{fileName(entry.destination)}</code>
                        <small>{entry.destination}</small>
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          <label htmlFor="confirmation">
            Type <strong>{db?.name}</strong> to continue
          </label>
          <input
            id="confirmation"
            value={confirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => restoreDialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                !db || !restorePlan || confirmation !== db.name || locked
              }
            >
              Restore database
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
