export interface Database {
  name: string;
  id: number;
  state: string;
  recovery: string;
  sizeMB: number;
  system: boolean;
}
export interface Backup {
  name: string;
  path: string;
  size: number;
  modified: string;
}
export interface RestoreFile {
  logicalName: string;
  type: "data" | "log";
  destination: string;
  overwrites: boolean;
}
export interface RestorePlan {
  database: string;
  backup: string;
  files: RestoreFile[];
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type Theme = "dark" | "light" | "system";
export interface NebulaApi {
  settings(): Promise<
    Result<{
      server: string;
      backupRoot: string;
      instances: string[];
      scriptRoot?: string;
    }>
  >;
  connect(
    server?: string,
  ): Promise<Result<{ server: string; databases: Database[] }>>;
  chooseFolder(): Promise<Result<string>>;
  chooseBackup(): Promise<Result<string | null>>;
  postRestoreScript(name: string): Promise<Result<string>>;
  savePostRestoreScript(name: string, script: string): Promise<Result<string>>;
  backups(name: string): Promise<Result<Backup[]>>;
  backup(name: string): Promise<Result<string>>;
  restorePlan(name: string, file: string): Promise<Result<RestorePlan>>;
  restore(
    name: string,
    file: string,
    confirmation: string,
  ): Promise<
    Result<{
      canceled: boolean;
      scriptStatus?: "skipped" | "completed" | "failed";
      scriptError?: string;
    }>
  >;
  revealFolder(name: string): Promise<Result<void>>;
  setTheme(theme: Theme): Promise<Result<void>>;
  onProgress(callback: (text: string) => void): () => void;
}
declare global {
  interface Window {
    nebula?: NebulaApi;
  }
}
