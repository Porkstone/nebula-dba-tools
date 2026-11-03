const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  SqlServer,
  databaseFolder,
  literal,
  identifier,
  localServer,
  supportsBackupCompression,
} = require("../electron/sql.cjs");

test("compression is available only on supported SQL Server editions", async () => {
  for (const [engine, edition] of [
    [3, "Developer Edition (64-bit)"],
    [3, "Enterprise Edition"],
    [3, "Enterprise Evaluation Edition"],
    [2, "Standard Edition"],
    [3, "Standard Developer Edition"],
  ])
    assert.equal(supportsBackupCompression(engine, edition), true, edition);
  for (const [engine, edition] of [
    [4, "Express Edition"],
    [2, "Web Edition"],
    [2, "Unknown"],
    [5, "SQL Azure"],
    [null, null],
  ])
    assert.equal(supportsBackupCompression(engine, edition), false, edition);
  const sql = new SqlServer();
  sql.json = async () => [
    {
      name: "Sales",
      state: "ONLINE",
      engineEdition: 3,
      edition: "Developer Edition",
    },
    {
      name: "tempdb",
      state: "ONLINE",
      engineEdition: 3,
      edition: "Developer Edition",
    },
    {
      name: "Offline",
      state: "OFFLINE",
      engineEdition: 3,
      edition: "Developer Edition",
    },
    {
      name: "Express",
      state: "ONLINE",
      engineEdition: 4,
      edition: "Express Edition",
    },
  ];
  assert.deepEqual(
    (await sql.databases()).map((db) => db.compressionSupported),
    [true, false, false, false],
  );
});

test("backups default to compression, honor opt-out and reject unsupported or invalid options", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nebula-compression-test-"),
  );
  try {
    for (const [supported, requested, expected] of [
      [true, undefined, true],
      [true, true, true],
      [true, false, false],
      [false, undefined, false],
      [false, false, false],
    ]) {
      const sql = new SqlServer();
      const queries = [];
      sql.requireDatabase = async () => ({ compressionSupported: supported });
      sql.query = async (query) => {
        queries.push(query);
        return "";
      };
      await sql.backup("Sales", root, requested);
      assert.match(queries[0], /WITH COPY_ONLY, CHECKSUM, NOINIT,/);
      assert.match(
        queries[0],
        expected ? /, COMPRESSION,/ : /, NO_COMPRESSION,/,
      );
      assert.match(queries[1], /RESTORE VERIFYONLY.*WITH CHECKSUM;/);
    }
    const sql = new SqlServer();
    sql.requireDatabase = async () => ({ compressionSupported: false });
    sql.query = async () => {
      throw new Error("Unexpected SQL execution");
    };
    await assert.rejects(sql.backup("Sales", root, true), /not supported/);
    for (const invalid of ["false", null, 1, {}])
      await assert.rejects(sql.backup("Sales", root, invalid), /on or off/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("nebula-compression-test-"));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SQL identifiers and literals escape independent SQL syntaxes", () => {
  assert.equal(
    identifier("Sales]; DROP DATABASE master;--"),
    "[Sales]]; DROP DATABASE master;--]",
  );
  assert.equal(literal("C:\\O'Brien\\data.bak"), "N'C:\\O''Brien\\data.bak'");
  assert.throws(() => literal("x\n:r bad.sql"));
  assert.throws(() => identifier("x\0"));
});
test("database folders preserve valid names and reject traversal / invalid Windows names", () => {
  assert.equal(
    databaseFolder("C:\\Backups", "Sales & Accounts"),
    "C:\\Backups\\Sales & Accounts",
  );
  for (const name of [
    "../outside",
    "..",
    ".",
    "C:\\outside",
    "a/b",
    "a:b",
    "NUL",
    "CON.txt",
    "COM1",
    "db.",
    "db ",
    "",
  ])
    assert.throws(() => databaseFolder("C:\\Backups", name), name);
  assert.throws(() => databaseFolder("relative", "Sales"));
});
test("connections are limited to local Windows SQL instances", () => {
  for (const server of ["localhost", ".", "(local)", "localhost\\SQLEXPRESS"])
    assert.equal(localServer(server), server);
  for (const server of [
    "remote-server",
    "localhost,1433",
    "-Q",
    "localhost\\bad;sql",
    "localhost\\one\\two",
  ])
    assert.throws(() => localServer(server));
});
test("backend rejects system restore, tempdb backup, and offline backup", async () => {
  const sql = new SqlServer();
  sql.databases = async () => [
    { name: "master", system: true, state: "ONLINE" },
    { name: "tempdb", system: true, state: "ONLINE" },
    { name: "offline", system: false, state: "OFFLINE" },
  ];
  await assert.rejects(sql.requireDatabase("master", true), /System/);
  await assert.rejects(sql.requireDatabase("tempdb"), /online/);
  await assert.rejects(sql.requireDatabase("offline"), /online/);
  await assert.rejects(sql.requireDatabase("missing"), /no longer exists/);
});
