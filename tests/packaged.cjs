const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _electron: electron, expect } = require("@playwright/test");
const manifest = require("../third-party/sqlcmd/manifest.json");
const pkg = require("../package.json");

async function main() {
  const output = path.resolve(__dirname, "../test-results");
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "packaged-smoke-"));
  const executablePath = path.resolve(
    __dirname,
    "../release/win-unpacked/nebula-dba-tools.exe",
  );
  const clientRoot = path.join(
    path.dirname(executablePath),
    "resources",
    "sqlcmd",
  );
  const hash = async (file) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  assert.equal(
    await hash(path.join(clientRoot, "sqlcmd.exe")),
    manifest.executableSha256,
  );
  assert.equal(
    await hash(path.join(clientRoot, "NOTICE.md")),
    manifest.noticeSha256,
  );
  assert.ok(
    (await fs.readFile(path.join(clientRoot, "LICENSE"), "utf8")).includes(
      "MIT License",
    ),
  );
  await assert.rejects(fs.access(path.join(clientRoot, "sqlcmd_debug.exe")));
  const env = {
    ...process.env,
    PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NEBULA_DEV_URL;
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${path.join(root, "profile")}`],
      env,
    });
    const page = await desktop.firstWindow();
    await expect(page.getByText("Connected locally")).toBeVisible({
      timeout: 30000,
    });
    const identity = await desktop.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      profile: app.getPath("userData"),
    }));
    assert.equal(identity.packaged, true);
    assert.equal(identity.version, pkg.version);
    assert.equal(
      path.resolve(identity.profile).toLowerCase(),
      path.join(root, "profile").toLowerCase(),
    );
    const connection = await page.evaluate(() =>
      window.nebula.connect("localhost"),
    );
    assert.equal(connection.ok, true, connection.error);
    assert.ok(connection.data.databases.length > 0);
    assert.ok(
      connection.data.databases.every(
        (db) => typeof db.compressionSupported === "boolean",
      ),
    );
    console.log(
      "PASS: production EXE, bundled SQLCMD and license/notice hashes, Windows authentication, database discovery and compression capabilities with external SQLCMD excluded from PATH.",
    );
  } finally {
    await desktop?.close();
    assert.equal(path.dirname(root), output);
    assert.ok(path.basename(root).startsWith("packaged-smoke-"));
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
