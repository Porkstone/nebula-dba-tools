const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SqlServer,
  databaseFolder,
  literal,
  identifier,
  localServer,
} = require("../electron/sql.cjs");

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
