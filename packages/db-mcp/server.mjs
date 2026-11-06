#!/usr/bin/env node
/*
 * AX Navi DB 도구 — 플러그인과 함께 뜨는 MCP 서버(stdio, 줄 단위 JSON-RPC). npm 의존성 없이 프로토콜을 직접 처리한다.
 *
 * 접속 정보는 플러그인 설정(/plugin configure ax-navi@ax-navi) 또는 프로젝트 .env(ORACLE_*)에서 온다. 설정이 없으면
 * db_status 하나만 내놓고 설정 방법을 알려 준다. 모든 조회는 읽기 전용 트랜잭션에서 돌고, 호출마다 새로 접속한다
 * (읽기 전용 트랜잭션은 시작 시점의 스냅숏을 보므로 접속을 오래 붙들면 최신 상태를 못 본다).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeConfig, loadDbConfig } from "./src/config.mjs";
import { connectOracle, dataDir, ORACLEDB_VERSION } from "./src/driver.mjs";
import { dbExport } from "./src/export.mjs";
import { TOOLS } from "./src/oracle-tools.mjs";
import { checkReadOnlySql, limitRows } from "./src/sql-guard.mjs";

const VERSION = "0.1.0";
const QUERY_MAX_ROWS = 200;

const str = (/** @type {string} */ description) => ({ type: "string", description });
const OWNER = str("스키마(소유자). 쉼표로 여럿. 비우면 설정의 대상 스키마, 그것도 없으면 접속 계정.");

/** 도구 정의. 고정 쿼리 도구는 SQL 을 받지 않는다 — 이름·패턴만 바인드 변수로 들어간다. */
export const TOOL_DEFS = [
  {
    name: "db_status",
    description: "AX Navi DB 연결 상태(설정 출처·대상 스키마·드라이버·접속 시험). DB 도구가 안 될 때 먼저 부른다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "db_objects",
    description: "DB 객체(테이블·뷰·패키지·프로시저·함수·트리거·시퀀스·시노님)를 이름 패턴이나 한글 코멘트로 찾는다. 상태(VALID/INVALID)와 마지막 DDL 시각 포함.",
    inputSchema: { type: "object", properties: {
      name: str("이름 일부 또는 패턴(* 와일드카드). 예: PKG_ORDER, TB_*"),
      type: str("객체 유형. 예: TABLE, PACKAGE, PROCEDURE, TRIGGER"),
      comment: str("테이블·컬럼 코멘트(한글 업무명)에서 찾을 말. 예: 운행실적"),
      owner: OWNER,
      limit: { type: "number", description: "최대 건수(기본 100, 최대 500)" },
    } },
  },
  {
    name: "db_source",
    description: "패키지·프로시저·함수·트리거의 소스를 줄 번호와 함께 읽는다. `PKG.PROC` 이면 패키지 바디에서 그 멤버 구간만 준다.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: str("객체 이름. 예: PKG_ORDER, PKG_ORDER.SAVE_ORDER, OWNER.PR_CALC"),
      type: str("PACKAGE(스펙) / PACKAGE BODY / PROCEDURE / FUNCTION / TRIGGER. 비우면 자동"),
      owner: OWNER,
      max_lines: { type: "number", description: "최대 줄 수(기본 1500, 최대 5000)" },
    } },
  },
  {
    name: "db_dependencies",
    description: "객체가 참조하는 것(테이블·다른 패키지)과 그 객체를 참조하는 것을 컴파일러 기록(ALL_DEPENDENCIES)으로 답한다. 영향도의 DB 쪽 근거.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: str("객체 이름(테이블·패키지·프로시저 등)"),
      direction: { type: "string", enum: ["both", "depends_on", "referenced_by"], description: "기본 both" },
      owner: OWNER,
      limit: { type: "number", description: "방향별 최대 건수(기본 300)" },
    } },
  },
  {
    name: "db_table",
    description: "테이블의 컬럼·한글 코멘트·제약(PK/FK/CHECK)·인덱스·트리거, 그 테이블을 참조하는 프로시저·뷰와 그것을 돌리는 배치 잡까지 한 번에.",
    inputSchema: { type: "object", required: ["name"], properties: { name: str("테이블 이름"), owner: OWNER } },
  },
  {
    name: "db_export",
    description: "DB 구조·PL/SQL 소스를 프로젝트 db/dump 에 파일로 내리고 인덱서 설정에 등록한다(데이터 행 제외). 이후 '인덱스만 갱신' 하면 프로시저·트리거·배치 잡이 인덱스(영향도·흐름 추적)에 들어간다. 바뀐 객체만 다시 쓴다.",
    inputSchema: { type: "object", properties: {
      owner: OWNER,
      only_undefined: { type: "boolean", description: "true 면 인덱스가 '정의 없는 프로시저'로 표시한 것의 소스만 받는다" },
      out: str("덤프 폴더(프로젝트 기준 상대경로, 기본 db/dump)"),
    } },
  },
  {
    name: "db_query",
    description: `데이터 확인용 읽기 전용 조회. SELECT/WITH 한 문장만, 최대 ${QUERY_MAX_ROWS}행. 구조 질문은 다른 db_* 도구를 쓴다. 개인정보 컬럼은 꼭 필요할 때만 고른다.`,
    inputSchema: { type: "object", required: ["sql"], properties: {
      sql: str("SELECT 또는 WITH 로 시작하는 한 문장(세미콜론 없이)"),
      max_rows: { type: "number", description: `최대 행 수(기본 50, 최대 ${QUERY_MAX_ROWS})` },
    } },
  },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, openWorldHint: false } }));

/** 설정이 없으면 db_status 만 내놓는다 — DB 를 안 쓰는 사용자의 도구 목록을 어지럽히지 않는다. */
export function listTools(/** @type {import("./src/config.mjs").DbConfig} */ config) {
  return config.type === "none" ? TOOL_DEFS.filter((t) => t.name === "db_status") : TOOL_DEFS;
}

/**
 * @param {string} name
 * @param {any} args
 * @param {{ root: string, env?: NodeJS.ProcessEnv, connect?: (c: any) => Promise<import("./src/driver.mjs").Db> }} deps
 */
export async function callTool(name, args, deps) {
  const env = deps.env ?? process.env;
  const config = loadDbConfig(deps.root, env);
  const connect = deps.connect ?? ((/** @type {any} */ c) => connectOracle(c, env));
  if (name === "db_status") {
    const status = { config: describeConfig(config), problems: config.problems, driver: `oracledb@${ORACLEDB_VERSION} (설치 위치 ${dataDir(env)})`, project: deps.root };
    if (config.type === "none" || config.problems.length) return status;
    try {
      const db = await connect(config);
      try {
        const [row] = await db.all("SELECT USER AS login_user, SYS_CONTEXT('USERENV','DB_NAME') AS db_name FROM dual");
        const roles = await db.all("SELECT role FROM session_roles ORDER BY role", {}, 50);
        return { ...status, connected: true, login: row, roles: roles.map((r) => r.ROLE ?? r.role),
          advice: "읽기 전용 계정(CREATE SESSION + SELECT_CATALOG_ROLE 또는 SELECT ANY DICTIONARY)을 권합니다. 다른 스키마의 소스를 보려면 그 권한이 필요합니다." };
      } finally { await db.close(); }
    } catch (error) {
      return { ...status, connected: false, error: String(/** @type {any} */ (error)?.message ?? error) };
    }
  }
  if (config.type === "none") throw new Error(describeConfig(config));
  if (config.problems.length) throw new Error(`DB 설정이 덜 됐습니다: ${config.problems.join(" ")} (${config.source})`);
  /** @type {string | null} */
  let sql = null;
  if (name === "db_query") {
    const check = checkReadOnlySql(args?.sql);
    if (!check.ok) throw new Error(check.reason);
    sql = limitRows(check.sql, Math.min(Number(args?.max_rows) || 50, QUERY_MAX_ROWS));
  } else if (name !== "db_export" && !(name in TOOLS)) {
    throw new Error(`알 수 없는 도구: ${name}`);
  }
  const db = await connect(config);
  try {
    const ctx = { root: deps.root, owners: config.owners };
    if (sql !== null) {
      const rows = await db.all(sql, {});
      return { rows, row_count: rows.length, note: rows.length >= (Math.min(Number(args?.max_rows) || 50, QUERY_MAX_ROWS)) ? "행 상한에 닿았습니다 — 조건을 좁히세요." : undefined };
    }
    if (name === "db_export") return await dbExport(db, args ?? {}, ctx);
    return await TOOLS[/** @type {keyof typeof TOOLS} */ (name)](db, args ?? {}, ctx);
  } finally {
    await db.close();
  }
}

/** JSON-RPC 요청 하나를 처리해 응답(알림이면 null)을 돌려준다. */
export async function handle(/** @type {any} */ message, /** @type {{ root: string, env?: NodeJS.ProcessEnv, connect?: any }} */ deps) {
  const { id, method, params } = message ?? {};
  const reply = (/** @type {any} */ result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return reply({
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ax-navi-db", version: VERSION },
      instructions: "DB 구조(패키지·프로시저·트리거·의존·배치 잡·코멘트)는 db_* 고정 조회 도구로, 데이터 값 확인만 db_query 로 한다. 인덱스에 없는 DB 객체를 만나면 db_source·db_dependencies 로 확인한다.",
    });
  }
  if (id === undefined || id === null) return null; // 알림(notifications/initialized 등)
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: listTools(loadDbConfig(deps.root, deps.env ?? process.env)) });
  if (method === "tools/call") {
    try {
      const result = await callTool(String(params?.name ?? ""), params?.arguments ?? {}, deps);
      return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
    } catch (error) {
      return reply({ content: [{ type: "text", text: String(/** @type {any} */ (error)?.message ?? error) }], isError: true });
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `지원하지 않는 메서드: ${method}` } };
}

/* 직접 실행될 때만 stdio 를 붙든다(테스트는 handle 을 import 해서 쓴다). */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(String(process.env["CLAUDE_PROJECT_DIR"] || "").startsWith("${") ? process.cwd() : process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
  let buffer = "";
  /* 응답 순서를 요청 순서와 맞춘다 — 느린 DB 호출 뒤에 빠른 응답이 앞지르지 않게. */
  let chain = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      chain = chain.then(async () => {
        let message;
        try { message = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 파싱 실패" } })}\n`); return; }
        const response = await handle(message, { root });
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      });
    }
  });
  process.stdin.on("end", () => { chain.then(() => process.exit(0)); });
}
