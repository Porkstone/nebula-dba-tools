const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { SqlServer, identifier, literal } = require("../electron/sql.cjs");

async function main() {
  const output = path.resolve(__dirname, "../test-results");
  const profile = path.join(output, `profile-${randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env, NEBULA_PROFILE_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NEBULA_DEV_URL;
  const sql = new SqlServer();
  const name = `Nebula_UI_Test_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let desktop;
  const errors = [];
  await sql.query(`CREATE DATABASE ${identifier(name)};`);
  try {
    await sql.query(
      `USE ${identifier(name)}; CREATE TABLE dbo.Probe(value int); INSERT dbo.Probe VALUES(42);`,
    );
    desktop = await electron.launch({
      args: ["."],
      cwd: path.resolve(__dirname, ".."),
      env,
    });
    const page = await desktop.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByText("Connected locally")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create backup", exact: true }),
    ).toBeDisabled();
    // Native dialogs are replaced only in the test process, never in production code.
    await desktop.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, output);
    await page
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create backup", exact: true })
      .click();
    await expect(
      page.getByText("Operation complete", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.screenshot({ path: path.join(output, "desktop-dark.png") });
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await page.screenshot({ path: path.join(output, "desktop-light.png") });
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByRole("button", { name: "Review restore" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Restore database", exact: true }),
    ).toBeDisabled();
    await page.locator("#confirmation").fill(name);
    await page.screenshot({ path: path.join(output, "desktop-restore.png") });
    // First exercise native cancellation, then restore this test database only.
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore database", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Review restore" }),
    ).toBeEnabled();
    await sql.query(`UPDATE ${identifier(name)}.dbo.Probe SET value=99;`);
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.getByRole("button", { name: "Review restore" }).click();
    await page.locator("#confirmation").fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore database", exact: true })
      .click();
    await expect(
      page.getByText(`${name} was restored and is ready to use.`, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    expect(
      (
        await sql.json(
          `SELECT value FROM ${identifier(name)}.dbo.Probe FOR JSON PATH;`,
        )
      )[0].value,
    ).toBe(42);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(980, 680),
    );
    await page.screenshot({ path: path.join(output, "desktop-small.png") });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Refresh databases" }).click();
    await expect(page.getByText("Connected locally")).toBeVisible({
      timeout: 30000,
    });
    await page
      .getByRole("button", { name: /localhost Windows authentication/ })
      .click();
    await page.locator("#instance").fill("remote-server");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Enter a local instance",
    );
    expect(errors).toEqual([]);
    console.log(
      "PASS: Electron launch, real IPC connection, folder selection, backup, restore cancellation, confirmation, restored data, both themes, small window, connection error and no renderer exceptions.",
    );
  } finally {
    await desktop?.close();
    if (!name.startsWith("Nebula_UI_Test_"))
      throw new Error("Unexpected test database");
    await sql.query(
      `IF DB_ID(${literal(name)}) IS NOT NULL BEGIN ALTER DATABASE ${identifier(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${identifier(name)}; END;`,
    );
    for (const target of [profile, path.join(output, name)]) {
      if (path.dirname(path.resolve(target)) !== output)
        throw new Error("Unsafe cleanup path");
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
