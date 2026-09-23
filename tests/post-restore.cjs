const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  SqlServer,
  identifier,
  literal,
  validateScript,
} = require("../electron/sql.cjs");

async function main() {
  for (const invalid of [
    null,
    "\0",
    ":connect elsewhere",
    "SELECT 1;\n:r file.sql",
    "!! whoami",
  ]) {
    expect(() => validateScript(invalid)).toThrow();
  }
  const root = path.resolve("test-results", `post-script-${randomUUID()}`);
  const profile = path.join(root, "profile");
  await fs.mkdir(profile, { recursive: true });
  const sql = new SqlServer();
  const name = `Nebula_UI_Test_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const env = { ...process.env, NEBULA_PROFILE_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NEBULA_DEV_URL;
  let app;
  await sql.query(`CREATE DATABASE ${identifier(name)};`);
  try {
    const dataFiles = await sql.json(
      `SELECT physical_name AS physical FROM sys.master_files WHERE database_id=DB_ID(${literal(name)}) AND type=0 FOR JSON PATH;`,
    );
    const secondary = path.win32.join(
      path.win32.dirname(dataFiles[0].physical),
      `${name}_secondary.ndf`,
    );
    await sql.query(
      `ALTER DATABASE ${identifier(name)} ADD FILE (NAME=${literal(`${name}_secondary`)}, FILENAME=${literal(secondary)}, SIZE=8MB);`,
    );
    await sql.query(
      `USE ${identifier(name)}; CREATE TABLE dbo.Probe(value int); INSERT dbo.Probe VALUES(42);`,
    );
    const backup = await sql.backup(name, root);
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    await expect(page.getByText("Connected locally")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("button", { name: "Restore database", exact: true })
      .click();
    await expect(
      page.getByText("Script storage folder", { exact: true }),
    ).toHaveCount(0);
    const scriptRoot = path.join(profile, "post-restoration-scripts");
    const script = "UPDATE dbo.Probe SET value=84;\nGO\nSELECT N'Completed é';";
    await page.getByLabel("SQL script", { exact: true }).fill(script);
    await page
      .getByRole("button", { name: "Save script", exact: true })
      .click();
    await expect(
      page.getByText("Post restoration script saved.", { exact: true }),
    ).toBeVisible();
    expect(
      await fs.readFile(
        path.join(scriptRoot, name, "post-restore.sql"),
        "utf8",
      ),
    ).toBe(script);
    expect(
      JSON.parse(await fs.readFile(path.join(profile, "settings.json"), "utf8"))
        .scriptRoot,
    ).toBe(scriptRoot);
    expect(
      (
        await page.evaluate(() =>
          window.nebula.postRestoreScript("OtherDatabase"),
        )
      ).data,
    ).toBe("");
    await page.locator(".post-restore-script").screenshot({
      path: "test-results/post-restoration-script.png",
      animations: "disabled",
    });
    await app.evaluate(({ dialog }, backup) => {
      globalThis.scriptChoice = 1;
      globalThis.restoreChoice = 1;
      globalThis.prompts = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [backup],
      });
      dialog.showMessageBox = async (_win, options) => {
        globalThis.prompts.push(options.title);
        return {
          response:
            options.title === "Post restoration script"
              ? globalThis.scriptChoice
              : globalThis.restoreChoice,
        };
      };
    }, backup);
    const targetFiles = await sql.json(
      `SELECT physical_name AS physical FROM sys.master_files WHERE database_id=DB_ID(${literal(name)}) ORDER BY file_id FOR JSON PATH;`,
    );
    await page.getByRole("button", { name: "Browse files" }).click();
    await page.getByRole("button", { name: "Review restore" }).click();
    await expect(
      page.getByRole("region", {
        name: "Database files that will be overwritten",
      }),
    ).toBeVisible();
    for (const target of targetFiles)
      await expect(
        page.locator(".restore-targets code", {
          hasText: path.win32.basename(target.physical),
        }),
      ).toBeVisible();
    for (const extension of ["MDF", "NDF", "LDF"])
      await expect(
        page.locator(".restore-file-type").filter({ hasText: extension }),
      ).toBeVisible();
    await page.locator(".restore-dialog").screenshot({
      path: "test-results/restore-review.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Close restore confirmation" })
      .click();
    const restore = async () => {
      const reviewed = await page.evaluate(
        ({ name, backup }) => window.nebula.restorePlan(name, backup),
        { name, backup },
      );
      expect(reviewed.ok).toBe(true);
      expect(
        reviewed.data.files.filter((entry) => entry.overwrites),
      ).toHaveLength(targetFiles.length);
      return page.evaluate(
        ({ name, backup }) => window.nebula.restore(name, backup, name),
        { name, backup },
      );
    };
    expect((await restore()).data.scriptStatus).toBe("completed");
    expect(
      (
        await sql.json(
          `SELECT value FROM ${identifier(name)}.dbo.Probe FOR JSON PATH;`,
        )
      )[0].value,
    ).toBe(84);
    expect(await app.evaluate(() => globalThis.prompts)).toEqual([
      "Overwrite database?",
      "Post restoration script",
    ]);
    await app.evaluate(() => {
      globalThis.scriptChoice = 0;
    });
    expect((await restore()).data.scriptStatus).toBe("skipped");
    expect(
      (
        await sql.json(
          `SELECT value FROM ${identifier(name)}.dbo.Probe FOR JSON PATH;`,
        )
      )[0].value,
    ).toBe(42);
    await app.evaluate(() => {
      globalThis.scriptChoice = 1;
      globalThis.restoreChoice = 0;
      globalThis.prompts = [];
    });
    expect((await restore()).data.canceled).toBe(true);
    expect(await app.evaluate(() => globalThis.prompts)).toEqual([
      "Overwrite database?",
    ]);
    await app.evaluate(() => {
      globalThis.restoreChoice = 1;
    });
    await page.evaluate(
      (name) =>
        window.nebula.savePostRestoreScript(
          name,
          "THROW 51000, 'Script failure probe', 1;",
        ),
      name,
    );
    const failed = await restore();
    expect(failed.ok).toBe(true);
    expect(failed.data.scriptStatus).toBe("failed");
    expect(failed.data.scriptError).toContain("Script failure probe");
    const corrupt = path.join(root, name, "bad.bak");
    await fs.writeFile(corrupt, "invalid backup");
    await app.evaluate(({ dialog }, corrupt) => {
      globalThis.prompts = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [corrupt],
      });
    }, corrupt);
    await page.evaluate(() => window.nebula.chooseBackup());
    expect(
      (
        await page.evaluate(
          ({ name, corrupt }) => window.nebula.restorePlan(name, corrupt),
          { name, corrupt },
        )
      ).ok,
    ).toBe(false);
    expect(await app.evaluate(() => globalThis.prompts)).toEqual([]);
    await page.evaluate(
      (name) => window.nebula.savePostRestoreScript(name, ""),
      name,
    );
    await expect(
      fs.access(path.join(scriptRoot, name, "post-restore.sql")),
    ).rejects.toThrow();
    await app.evaluate(({ dialog }, backup) => {
      globalThis.prompts = [];
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [backup],
      });
    }, backup);
    await page.evaluate(() => window.nebula.chooseBackup());
    expect((await restore()).data).toEqual({ canceled: false });
    expect(await app.evaluate(() => globalThis.prompts)).toEqual([
      "Overwrite database?",
    ]);
    console.log(
      "PASS: per-database file storage, saved root, GO/Unicode, reviewed overwrite filenames, execution confirmation, skip, canceled/failed restore, script failure, script removal and no-script restore.",
    );
  } finally {
    await app?.close();
    await sql.query(
      `ALTER DATABASE ${identifier(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${identifier(name)};`,
    );
    if (
      path.dirname(root) !== path.resolve("test-results") ||
      !path.basename(root).startsWith("post-script-")
    )
      throw Error("Unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
