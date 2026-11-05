/*
 * Oracle 드라이버(oracledb, thin 모드 — 순수 JS, Instant Client 불필요)를 찾고, 없으면 처음 쓸 때 한 번 설치한다.
 *
 * DB 를 쓰지 않는 사용자에게까지 드라이버를 받게 하지 않으려고 플러그인 설치 때가 아니라 첫 DB 도구 호출 때 설치한다.
 * 설치 위치는 플러그인 데이터 폴더(${CLAUDE_PLUGIN_DATA}) — 플러그인을 업데이트해도 남는다.
 * 접속 뒤에는 `SET TRANSACTION READ ONLY` 로 세션의 트랜잭션을 읽기 전용으로 잠근다. 진짜 보증은 읽기 전용 계정이다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ORACLEDB_VERSION = "6.10.0";
const CALL_TIMEOUT_MS = 30_000;

/** 드라이버를 둘 폴더. 플러그인 밖에서 띄우면(테스트·수동 실행) 사용자 폴더 아래 같은 이름을 쓴다. */
export function dataDir(env = process.env) {
  const value = String(env["CLAUDE_PLUGIN_DATA"] ?? "").trim();
  return value && !value.startsWith("${") ? value : join(homedir(), ".claude", "plugins", "data", "ax-navi-ax-navi");
}

/** npm 을 셸 없이 부를 방법. node 옆의 npm-cli.js 를 node 로 직접 돌리는 것이 먼저다(Windows 의 npm.cmd 는 셸이 필요하다). */
function npmInvocation(/** @type {string[]} */ args) {
  const nodeDir = dirname(process.execPath);
  for (const cli of [join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]) {
    if (existsSync(cli)) return { file: process.execPath, args: [cli, ...args], shell: false };
  }
  return { file: process.platform === "win32" ? "npm.cmd" : "npm", args, shell: process.platform === "win32" };
}

/** @returns {any} oracledb 모듈 */
export function loadOracleDriver(env = process.env) {
  const dir = dataDir(env);
  const req = createRequire(join(dir, "package.json"));
  try {
    return req("oracledb");
  } catch { /* 아래에서 설치 */ }
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ax-navi-data", private: true }, null, 2));
  const args = ["install", `oracledb@${ORACLEDB_VERSION}`, "--no-audit", "--no-fund", "--ignore-scripts", "--save-exact"];
  try {
    /* 고정 인자만 넘긴다. */
    const npm = npmInvocation(args);
    execFileSync(npm.file, npm.args, { cwd: dir, stdio: "pipe", timeout: 180_000, shell: npm.shell, windowsHide: true });
  } catch (error) {
    const detail = String(/** @type {any} */ (error)?.stderr ?? /** @type {any} */ (error)?.message ?? "").trim().split(/\r?\n/).slice(-3).join(" ");
    throw new Error(
      `Oracle 드라이버(oracledb@${ORACLEDB_VERSION})를 자동 설치하지 못했습니다: ${detail}\n` +
      `사내망이면 npm 프록시·레지스트리 설정을 확인한 뒤 직접 설치하세요:\n  cd "${dir}"\n  npm install oracledb@${ORACLEDB_VERSION}`,
    );
  }
  return req("oracledb");
}

/**
 * 읽기 전용 접속. 돌려주는 객체는 도구들이 쓰는 최소 인터페이스다(테스트는 같은 모양의 가짜를 넣는다).
 * @typedef {{ all(sql: string, binds?: any, maxRows?: number): Promise<any[]>, close(): Promise<void>, user: string }} Db
 * @returns {Promise<Db>}
 */
export async function connectOracle(/** @type {import("./config.mjs").DbConfig} */ config, env = process.env) {
  const oracledb = loadOracleDriver(env);
  oracledb.fetchAsString = [oracledb.CLOB];
  const conn = await oracledb.getConnection({
    user: config.user,
    password: config.password,
    connectString: `${config.host}:${config.port}/${config.service}`,
  });
  conn.callTimeout = CALL_TIMEOUT_MS;
  /* 세션의 첫 트랜잭션을 읽기 전용으로 연다. 이후 이 접속으로는 커밋하지 않는다. */
  await conn.execute("SET TRANSACTION READ ONLY");
  return {
    user: config.user.toUpperCase(),
    async all(sql, binds = {}, maxRows = 0) {
      const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows });
      return result.rows ?? [];
    },
    async close() {
      try { await conn.rollback(); } catch { /* 이미 끊김 */ }
      await conn.close();
    },
  };
}
