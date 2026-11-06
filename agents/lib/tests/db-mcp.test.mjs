// DB 도구 MCP 서버(packages/db-mcp) 회귀 테스트 — 실제 DB 없이 가짜 접속으로 SQL 검사·도구 응답·덤프·인덱스 병합을 고정한다.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../build-index.mjs";
import { handle } from "../../../packages/db-mcp/server.mjs";
import { loadDbConfig } from "../../../packages/db-mcp/src/config.mjs";
import { connectOracle, enableThickMode } from "../../../packages/db-mcp/src/driver.mjs";
import { dbExport } from "../../../packages/db-mcp/src/export.mjs";
import { TOOLS } from "../../../packages/db-mcp/src/oracle-tools.mjs";
import { checkReadOnlySql } from "../../../packages/db-mcp/src/sql-guard.mjs";

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}
const indexJson = (root, name) => JSON.parse(readFileSync(join(root, "_workspace", "index", name), "utf8"));

/* 가짜 Oracle 사전. 오라클 드라이버처럼 대문자 키 행을 돌려주고, 받은 SQL·바인드를 모두 기록한다. */
const L = (lines) => lines.map((text, i) => ({ LINE: i + 1, TEXT: `${text}\n` }));
const DICT = {
  objects: [
    { OWNER: "HRD", OBJECT_NAME: "PKG_ENROLL", OBJECT_TYPE: "PACKAGE", STATUS: "VALID", LAST_DDL_TIME: "2026-11-01T10:00:00" },
    { OWNER: "HRD", OBJECT_NAME: "PKG_ENROLL", OBJECT_TYPE: "PACKAGE BODY", STATUS: "INVALID", LAST_DDL_TIME: "2026-11-01T10:00:00" },
    { OWNER: "HRD", OBJECT_NAME: "PKG_SECRET", OBJECT_TYPE: "PACKAGE BODY", STATUS: "VALID", LAST_DDL_TIME: "2026-11-01T10:00:00" },
    { OWNER: "HRD", OBJECT_NAME: "TB_ENROLL", OBJECT_TYPE: "TABLE", STATUS: "VALID", LAST_DDL_TIME: "2026-11-01T10:00:00" },
  ],
  source: {
    "HRD/PACKAGE/PKG_ENROLL": L(["PACKAGE PKG_ENROLL IS", "  PROCEDURE APPLY(p_id NUMBER);", "END PKG_ENROLL;"]),
    "HRD/PACKAGE BODY/PKG_ENROLL": L([
      "PACKAGE BODY PKG_ENROLL IS",
      "  CURSOR c_log IS SELECT * FROM TB_LOG;",
      "  PROCEDURE APPLY(p_id NUMBER) IS",
      "  BEGIN",
      "    INSERT INTO TB_ENROLL (ID) VALUES (p_id);",
      "  END APPLY;",
      "  PROCEDURE CANCEL(p_id NUMBER) IS",
      "  BEGIN",
      "    DELETE FROM TB_ENROLL WHERE ID = p_id;",
      "  END CANCEL;",
      "END PKG_ENROLL;",
    ]),
    "HRD/PACKAGE BODY/PKG_SECRET": [{ LINE: 1, TEXT: "PACKAGE BODY PKG_SECRET wrapped \na000000\nabcd\n" }],
  },
  columns: [
    { OWNER: "HRD", TABLE_NAME: "TB_ENROLL", COLUMN_ID: 1, COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: "N", COMMENTS: "신청번호" },
    { OWNER: "HRD", TABLE_NAME: "TB_ENROLL", COLUMN_ID: 2, COLUMN_NAME: "NM", DATA_TYPE: "VARCHAR2", CHAR_LENGTH: 50, CHAR_USED: "C", NULLABLE: "Y" },
  ],
  constraints: [
    { OWNER: "HRD", TABLE_NAME: "TB_ENROLL", CONSTRAINT_NAME: "PK_TB_ENROLL", CONSTRAINT_TYPE: "P", COLUMNS: "ID" },
    { OWNER: "HRD", TABLE_NAME: "TB_ENROLL", CONSTRAINT_NAME: "SYS_C001", CONSTRAINT_TYPE: "C", SEARCH_CONDITION: "\"ID\" IS NOT NULL", COLUMNS: "ID" },
  ],
  tableComments: [{ OWNER: "HRD", TABLE_NAME: "TB_ENROLL", TABLE_TYPE: "TABLE", COMMENTS: "수강신청" }],
  columnComments: [{ OWNER: "HRD", TABLE_NAME: "TB_ENROLL", COLUMN_NAME: "ID", COMMENTS: "신청번호" }],
  dependencies: [
    { OWNER: "HRD", NAME: "PKG_ENROLL", TYPE: "PACKAGE BODY", REFERENCED_OWNER: "HRD", REFERENCED_NAME: "TB_ENROLL", REFERENCED_TYPE: "TABLE" },
    { OWNER: "HRD", NAME: "PKG_ENROLL", TYPE: "PACKAGE BODY", REFERENCED_OWNER: "HRD", REFERENCED_NAME: "TB_LOG", REFERENCED_TYPE: "TABLE" },
    { OWNER: "HRD", NAME: "PKG_ENROLL", TYPE: "PACKAGE BODY", REFERENCED_OWNER: "HRD", REFERENCED_NAME: "PKG_UTIL", REFERENCED_TYPE: "PACKAGE" },
  ],
  triggers: [],
  schedulerJobs: [{ OWNER: "HRD", JOB_NAME: "J_NIGHTLY", JOB_TYPE: "PLSQL_BLOCK", JOB_ACTION: "BEGIN PKG_ENROLL.APPLY(NULL); END;", REPEAT_INTERVAL: "FREQ=DAILY", ENABLED: "TRUE" }],
};

function fakeDb() {
  const calls = [];
  const route = (sql, binds) => {
    if (/FROM all_objects/.test(sql)) return DICT.objects.filter((o) => !binds.otype || o.OBJECT_TYPE === binds.otype);
    if (/s\.line = 1 AND REGEXP_LIKE/.test(sql)) return [{ OWNER: "HRD", NAME: "PKG_SECRET", TYPE: "PACKAGE BODY" }];
    if (/SELECT DISTINCT s\.owner, s\.type FROM all_source/.test(sql)) return Object.keys(DICT.source).filter((k) => k.endsWith(`/${binds.name}`)).map((k) => ({ OWNER: "HRD", TYPE: k.split("/")[1] }));
    if (/SELECT s\.line, s\.text FROM all_source/.test(sql)) return DICT.source[`${binds.owner}/${binds.stype}/${binds.name}`] || [];
    if (/FROM all_tab_columns/.test(sql)) return DICT.columns.filter((c) => !binds.name || c.TABLE_NAME === binds.name);
    if (/FROM all_constraints c/.test(sql)) return DICT.constraints;
    if (/FROM all_tab_comments c\s+WHERE c\.owner IN \([^)]*\) AND c\.comments IS NOT NULL/.test(sql)) return DICT.tableComments;
    if (/FROM all_col_comments c\s+WHERE c\.owner IN \([^)]*\) AND c\.comments IS NOT NULL/.test(sql)) return DICT.columnComments;
    if (/FROM all_dependencies d/.test(sql)) return DICT.dependencies.filter((d) => !binds.name || d.NAME === binds.name || d.REFERENCED_NAME === binds.name);
    if (/FROM all_triggers/.test(sql)) return DICT.triggers;
    if (/FROM all_scheduler_jobs/.test(sql)) return DICT.schedulerJobs;
    if (/FROM all_jobs/.test(sql)) throw new Error("ORA-00942: table or view does not exist");
    return [];
  };
  return {
    user: "HRD", calls,
    async all(sql, binds = {}) { calls.push({ sql, binds }); return route(sql, binds); },
    async close() {},
  };
}

export async function test(register, assert) {
  register("db_query 사전 검사는 한 문장의 SELECT/WITH 만 통과시킨다", () => {
    for (const sql of ["select * from tb_enroll where nm = 'a;b'", "WITH x AS (SELECT 1 FROM dual) SELECT * FROM x;", "select update_dt from t -- delete"]) {
      assert.ok(checkReadOnlySql(sql).ok, `통과해야 함: ${sql}`);
    }
    for (const sql of ["delete from t", "select 1 from dual; drop table t", "select * from t for update", "select * from t@remote", "update t set a=1", "with function f return number is begin return 1; end; select f from dual", "select 'unterminated from t"]) {
      assert.ok(!checkReadOnlySql(sql).ok, `거부해야 함: ${sql}`);
    }
  });

  register("DB 설정은 프로젝트 .env 가 플러그인 설정보다 우선하고, 풀리지 않은 ${user_config.*} 는 빈 값이다", () => {
    const root = mkdtempSync(join(tmpdir(), "ax-dbmcp-"));
    try {
      const env = { AXNAVI_DB_HOST: "${user_config.db_host}", AXNAVI_DB_USER: "" };
      assert.equal(loadDbConfig(root, env).type, "none", "호스트가 풀리지 않았으면 꺼진 것");
      const on = loadDbConfig(root, { AXNAVI_DB_HOST: "plug", AXNAVI_DB_SERVICE: "S", AXNAVI_DB_USER: "u", AXNAVI_DB_PASSWORD: "p", AXNAVI_DB_OWNERS: "hrd, com" });
      assert.equal(on.type, "oracle");
      assert.equal(on.owners.join(","), "HRD,COM");
      assert.equal(on.problems.length, 0);
      write(root, ".env", "# 주석\nORACLE_HOST=file\nORACLE_SERVICE=S2\nORACLE_USER=reader\nORACLE_PASSWORD=\"pw\"\n");
      const file = loadDbConfig(root, { AXNAVI_DB_HOST: "plug" });
      assert.equal(`${file.host}/${file.user}/${file.password}`, "file/reader/pw", "프로젝트 .env 가 이긴다");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("MCP 서버는 설정이 없으면 db_status 만 내놓고, 거부된 조회는 DB 에 접속하지 않는다", async () => {
    const root = mkdtempSync(join(tmpdir(), "ax-dbmcp-"));
    try {
      const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { root, env: {} });
      assert.equal(init.result.serverInfo.name, "ax-navi-db");
      assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, { root, env: {} }), null, "알림에는 응답하지 않는다");
      const off = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { root, env: {} });
      assert.equal(off.result.tools.map((t) => t.name).join(","), "db_status");
      const env = { AXNAVI_DB_HOST: "h", AXNAVI_DB_SERVICE: "s", AXNAVI_DB_USER: "u", AXNAVI_DB_PASSWORD: "p" };
      const on = await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { root, env });
      assert.ok(on.result.tools.length >= 7 && on.result.tools.every((t) => t.annotations.readOnlyHint), "설정되면 전 도구, 모두 읽기 전용 표시");
      let connected = 0;
      const deps = { root, env, connect: async () => { connected += 1; return fakeDb(); } };
      const bad = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "db_query", arguments: { sql: "delete from t" } } }, deps);
      assert.ok(bad.result.isError, "DML 은 오류");
      assert.equal(connected, 0, "거부된 SQL 은 접속조차 하지 않는다");
      const db = fakeDb();
      const ok = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "db_query", arguments: { sql: "select * from tb_enroll", max_rows: 9999 } } }, { ...deps, connect: async () => db });
      assert.ok(!ok.result.isError, ok.result.content[0].text);
      assert.ok(/WHERE ROWNUM <= 200$/.test(db.calls[0].sql), `행 상한으로 감싼다: ${db.calls[0].sql}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("고정 조회 도구는 값을 SQL 에 섞지 않고 바인드로만 넘긴다 · db_source 는 패키지 멤버 구간만 준다", async () => {
    const db = fakeDb();
    const ctx = { root: tmpdir(), owners: ["HRD"] };
    const src = await TOOLS.db_source(db, { name: "PKG_ENROLL.CANCEL" }, ctx);
    assert.equal(src.type, "PACKAGE BODY");
    assert.equal(`${src.from}-${src.to}`, "7-10", JSON.stringify(src));
    assert.ok(src.source.includes("DELETE FROM TB_ENROLL") && !src.source.includes("INSERT"), src.source);
    const secret = await TOOLS.db_source(db, { name: "PKG_SECRET" }, ctx);
    assert.ok(secret.wrapped, "암호화 표시");
    const deps = await TOOLS.db_dependencies(db, { name: "pkg_enroll" }, ctx);
    assert.ok(deps.depends_on.some((d) => d.referenced_name === "TB_LOG"), "파서가 못 보는 참조도 컴파일러 의존에는 있다");
    const table = await TOOLS.db_table(db, { name: "TB_ENROLL" }, ctx);
    assert.equal(table.comment, "수강신청");
    assert.ok(!table.constraints.some((c) => c.constraint_name === "SYS_C001"), "NOT NULL 검사 제약은 덜어 낸다");
    assert.equal(table.jobs.map((j) => j.name).join(","), "J_NIGHTLY", "테이블을 쓰는 패키지를 돌리는 배치 잡");
    assert.ok(table.skipped.some((s) => s.what === "DBMS_JOB 잡"), "권한 없는 뷰는 건너뛰고 알린다");
    for (const call of db.calls) {
      assert.ok(!/PKG_ENROLL|TB_ENROLL|'HRD'/.test(call.sql), `SQL 문장에 값이 섞였다: ${call.sql}`);
    }
  });

  register("db_export 덤프는 인덱서가 읽어 프로시저·배치 잡·코멘트·컴파일러 의존까지 인덱스에 들어간다", async () => {
    const root = mkdtempSync(join(tmpdir(), "ax-dbmcp-"));
    try {
      write(root, "src/A.java", `package acme;
public class A {
  public void run() { conn.prepareCall("{call PKG_ENROLL.APPLY(?)}"); }
  public void hidden() { conn.prepareCall("{call PKG_SECRET.RUN(?)}"); }
}
`);
      const ctx = { root, owners: ["HRD"], now: () => "2026-11-06T00:00:00Z" };
      const first = await dbExport(fakeDb(), {}, ctx);
      assert.equal(`${first.plsql.written}/${first.plsql.wrapped}`, "2/1", JSON.stringify(first));
      assert.ok(existsSync(join(root, "db/dump/HRD/packages/PKG_ENROLL.pkb")) && existsSync(join(root, "db/dump/HRD/packages/PKG_ENROLL.pks")));
      assert.ok(!existsSync(join(root, "db/dump/HRD/packages/PKG_SECRET.pkb")), "암호화 본문은 쓰지 않는다");
      const ddl = readFileSync(join(root, "db/dump/HRD/tables/TB_ENROLL.ddl"), "utf8");
      assert.ok(ddl.includes("CONSTRAINT PK_TB_ENROLL PRIMARY KEY (ID)") && ddl.includes("NM VARCHAR2(50 CHAR)") && !ddl.includes("SYS_C001"), ddl);
      assert.equal(JSON.parse(readFileSync(join(root, "_workspace/indexer-config.json"), "utf8")).db_dump_paths.join(","), "db/dump");
      const again = await dbExport(fakeDb(), {}, ctx);
      assert.equal(`${again.plsql.written}/${again.plsql.unchanged}`, "0/2", "바뀌지 않은 객체는 다시 쓰지 않는다");

      buildIndex({ root, mode: "init", tier: "Standard", config: null });
      const schema = indexJson(root, "schema.json");
      const apply = schema.procedures.find((p) => p.id === "PKG_ENROLL.APPLY");
      assert.ok(apply, `패키지 멤버가 인덱스에 있다: ${schema.procedures.map((p) => p.id)}`);
      assert.equal(apply.db_status, "INVALID", "DB 의 객체 상태");
      assert.equal(apply.db_references.origin, "db-catalog");
      assert.equal(apply.db_references.not_in_source_parse.join(","), "TB_LOG", "멤버 밖(패키지 수준 커서)이라 파서가 못 본 테이블을 드러낸다");
      assert.equal(apply.scheduled_by.join(","), "HRD.J_NIGHTLY", "배치 잡이 진입점으로 붙는다");
      const graph = indexJson(root, "call_graph.json");
      assert.ok(graph.edges.some((e) => e.from === "trigger:db-job#HRD.J_NIGHTLY" && e.to === "PKG_ENROLL.APPLY" && e.type === "scheduler" && e.origin === "db-catalog"), "call_graph 의 scheduler 엣지");
      assert.ok(!graph.edges.some((e) => e.from === "trigger:db-job#HRD.J_NIGHTLY" && e.to === "PKG_ENROLL.CANCEL"), "이름 끝만 같은 다른 멤버로 잇지 않는다");
      const table = schema.tables.find((t) => String(t.name).toUpperCase().endsWith("TB_ENROLL"));
      assert.equal(table?.comment, "수강신청", JSON.stringify(table));
      assert.equal(table.columns.find((c) => c.name.toUpperCase() === "ID")?.comment, "신청번호");
      const meta = indexJson(root, "_meta.json").db_source;
      assert.equal(meta.catalog.jobs_linked, 1, JSON.stringify(meta.catalog));
      const secret = meta.undefined_procedures.items.find((item) => item.name === "PKG_SECRET.RUN");
      assert.ok(secret?.wrapped, `암호화돼 받을 수 없는 프로시저 표시: ${JSON.stringify(meta.undefined_procedures)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  register("thick 모드: Oracle Client 폴더가 있으면 초기화하고, 환경 변수 지정이 ORACLE_HOME 보다 우선한다", () => {
    const home = mkdtempSync(join(tmpdir(), "ax-ora-home-"));
    const custom = mkdtempSync(join(tmpdir(), "ax-ora-lib-"));
    try {
      mkdirSync(join(home, "bin"), { recursive: true });
      writeFileSync(join(home, "bin", "oci.dll"), "x");
      const fake = () => { const calls = []; return { calls, initOracleClient: (o) => calls.push(o.libDir) }; };

      const a = fake();
      const sa = enableThickMode(a, { ORACLE_HOME: home });
      assert.equal(sa.mode, "thick");
      assert.equal(a.calls.join("|"), join(home, "bin"), "ORACLE_HOME\\bin 의 oci.dll 로 자동 감지");
      enableThickMode(a, { ORACLE_HOME: home });
      assert.equal(a.calls.length, 1, "같은 드라이버에는 한 번만 초기화");

      const b = fake();
      enableThickMode(b, { ORACLE_HOME: home, AXNAVI_DB_CLIENT_LIB: custom });
      assert.equal(b.calls.join("|"), custom, "AXNAVI_DB_CLIENT_LIB 가 우선(파일 확인 없이 시도)");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });

  register("thick 모드: 클라이언트가 없으면 thin 그대로, 초기화에 실패해도 접속을 막지 않고 사유를 오류에 덧붙인다", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ax-ora-empty-"));
    try {
      let inited = 0;
      const none = { initOracleClient: () => { inited += 1; } };
      assert.equal(enableThickMode(none, { ORACLE_HOME: empty }).mode, "thin", "oci.dll 이 없으면 thin");
      assert.equal(enableThickMode({ initOracleClient: () => { inited += 1; } }, {}).mode, "thin", "설정이 없으면 thin");
      assert.equal(inited, 0, "클라이언트가 없으면 초기화를 시도하지 않는다");

      const failing = { initOracleClient: () => { throw new Error("DPI-1047: Cannot locate a 64-bit Oracle Client library\nmore"); } };
      const state = enableThickMode(failing, { AXNAVI_DB_CLIENT_LIB: empty });
      assert.equal(state.mode, "thin", "실패해도 예외로 막지 않는다");
      assert.ok(/초기화 실패/.test(state.error) && /DPI-1047/.test(state.error) && !/more/.test(state.error), state.error);

      /* 접속이 실패하면 오류 끝에 thick 초기화 실패 사유가 붙는다 */
      const driver = {
        CLOB: 1,
        initOracleClient: () => { throw new Error("DPI-1047"); },
        getConnection: async () => { throw new Error("ORA-20001: 접속 불가"); },
      };
      const dataDir = mkdtempSync(join(tmpdir(), "ax-ora-data-"));
      try {
        mkdirSync(join(dataDir, "node_modules", "oracledb"), { recursive: true });
        writeFileSync(join(dataDir, "node_modules", "oracledb", "package.json"), JSON.stringify({ name: "oracledb", main: "index.js" }));
        writeFileSync(join(dataDir, "node_modules", "oracledb", "index.js"), "module.exports = global.__fakeOracledb;");
        globalThis.__fakeOracledb = driver;
        let thrown = null;
        try {
          await connectOracle({ host: "h", port: "1521", service: "s", user: "u", password: "p" }, { CLAUDE_PLUGIN_DATA: dataDir, AXNAVI_DB_CLIENT_LIB: empty });
        } catch (error) {
          thrown = error;
        }
        assert.ok(thrown && /ORA-20001/.test(thrown.message) && /thick 모드/.test(thrown.message) && /thin 모드로 접속을 시도/.test(thrown.message), `접속 오류에 사유가 붙어야 함: ${thrown?.message}`);
      } finally {
        delete globalThis.__fakeOracledb;
        rmSync(dataDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
}
