// Opt-in live test. Only uniquely named databases created here are modified/dropped.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { SqlServer, identifier, literal } = require("../electron/sql.cjs");
async function main() {
  const sql = new SqlServer("localhost", (text) => console.log(text));
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const names = [
    `Nebula_Test_${token}_O'Brien]é`,
    `Nebula_Test_${token}_Target`,
  ];
  const created = [];
  const base =
    process.env.NEBULA_TEST_BACKUP_ROOT ||
    path.resolve(__dirname, "../test-results");
  const root = path.resolve(base, `Nebula_Test_${token}`);
  assert.equal(
    path.dirname(root).toLowerCase(),
    path.resolve(base).toLowerCase(),
  );
  try {
    for (const name of names) {
      await sql.query(`CREATE DATABASE ${identifier(name)};`);
      created.push(name);
    }
    await sql.query(
      `USE ${identifier(names[0])}; CREATE TABLE dbo.Probe (id int PRIMARY KEY, value nvarchar(50)); INSERT dbo.Probe VALUES (1,N'before backup');`,
    );
    const file = await sql.backup(names[0], root);
    assert.ok((await fs.stat(file)).size > 0);
    assert.equal(path.basename(path.dirname(file)), names[0]);
    await sql.query(
      `USE ${identifier(names[0])}; UPDATE dbo.Probe SET value=N'after backup';`,
    );
    await sql.restore(names[0], file);
    assert.equal(
      (
        await sql.json(
          `SELECT value FROM ${identifier(names[0])}.dbo.Probe FOR JSON PATH;`,
        )
      )[0].value,
      "before backup",
    );
    await sql.restore(names[1], file);
    assert.equal(
      (
        await sql.json(
          `SELECT value FROM ${identifier(names[1])}.dbo.Probe FOR JSON PATH;`,
        )
      )[0].value,
      "before backup",
    );
    const state = await sql.json(
      `SELECT state_desc AS state, user_access_desc AS access FROM sys.databases WHERE name IN (${names.map(literal).join(",")}) FOR JSON PATH;`,
    );
    assert.ok(
      state.every((d) => d.state === "ONLINE" && d.access === "MULTI_USER"),
    );
    console.log(
      "PASS: discovery, Unicode/quoted names, backup folder, checksum verification, in-place restore, cross-database MOVE, restored content and multi-user state.",
    );
  } finally {
    for (const name of created) {
      assert.ok(name.startsWith(`Nebula_Test_${token}_`));
      await sql.query(
        `IF DB_ID(${literal(name)}) IS NOT NULL BEGIN ALTER DATABASE ${identifier(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${identifier(name)}; END;`,
      );
    }
    assert.equal(path.basename(root), `Nebula_Test_${token}`);
    assert.equal(
      path.dirname(root).toLowerCase(),
      path.resolve(base).toLowerCase(),
    );
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
