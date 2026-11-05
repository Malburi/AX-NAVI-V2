/*
 * db_export — DB 의 구조·PL/SQL 소스를 프로젝트 안 덤프 폴더(기본 db/dump)로 내리고, 인덱서 설정에 그 폴더를 등록한다.
 *
 *   db/dump/<OWNER>/packages/<NAME>.pks|.pkb · procedures/*.prc · functions/*.fnc · triggers/*.trg   ← ALL_SOURCE
 *   db/dump/<OWNER>/tables/<NAME>.ddl · views/<NAME>.ddl · sequences.ddl · synonyms.ddl            ← 사전 뷰로 조립한 DDL
 *   db/dump/_catalog.json   DB 가 아는 사실(객체 상태·암호화·의존·트리거·배치 잡·코멘트·제약). 인덱서가 정규식 근사 위에 덮는다.
 *   db/dump/_export_manifest.json   객체별 LAST_DDL_TIME — 다음 내보내기에서 바뀐 객체만 다시 쓴다.
 *
 * 데이터 행은 내보내지 않는다. 구조와 소스만이다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { callTargets, inList, isNotNullCheck, isWrapped, ORACLE_SQL as SQL, ownersOf } from "./oracle-tools.mjs";

const PLSQL = /** @type {Record<string, [string, string]>} */ ({
  "PACKAGE": ["packages", ".pks"],
  "PACKAGE BODY": ["packages", ".pkb"],
  "PROCEDURE": ["procedures", ".prc"],
  "FUNCTION": ["functions", ".fnc"],
  "TRIGGER": ["triggers", ".trg"],
});

const readJson = (/** @type {string} */ path, /** @type {any} */ fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")); } catch { return fallback; }
};
const lower = (/** @type {any} */ row) => Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k.toLowerCase(), v]));
/** 파일 이름에 못 쓰는 글자(따옴표 식별자에 들어갈 수 있다)는 _ 로. */
const safe = (/** @type {string} */ name) => String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const q = (/** @type {string} */ name) => (/^[A-Z][A-Z0-9_$#]*$/.test(name) ? name : `"${String(name).replace(/"/g, '""')}"`);

/** ALL_TAB_COLUMNS 한 행 → 컬럼 타입 표기. */
export function columnType(/** @type {any} */ c) {
  const t = String(c.data_type ?? "");
  if (/^(N?VARCHAR2|N?CHAR)$/.test(t)) return `${t}(${c.char_length || c.data_length}${t.startsWith("N") ? "" : c.char_used === "C" ? " CHAR" : " BYTE"})`;
  if (t === "RAW") return `RAW(${c.data_length})`;
  if (t === "NUMBER" && c.data_precision != null) return `NUMBER(${c.data_precision}${c.data_scale ? `,${c.data_scale}` : ""})`;
  if (t === "NUMBER" && c.data_scale === 0) return "INTEGER";
  return t;
}

/** 테이블 하나의 DDL — 컬럼·PK·UK·FK·CHECK·인덱스·코멘트. 인덱서의 DDL 파서가 읽는 모양을 따른다. */
export function tableDdl(/** @type {string} */ owner, /** @type {string} */ table, /** @type {any[]} */ columns, /** @type {any[]} */ constraints, /** @type {any[]} */ indexes, /** @type {string | undefined} */ comment) {
  const lines = columns.map((c) => `  ${q(c.column_name)} ${columnType(c)}${c.nullable === "N" ? " NOT NULL" : ""}`);
  for (const c of constraints) {
    const cols = String(c.columns ?? "").split(",").filter(Boolean).map(q).join(", ");
    if (c.constraint_type === "P") lines.push(`  CONSTRAINT ${q(c.constraint_name)} PRIMARY KEY (${cols})`);
    else if (c.constraint_type === "U") lines.push(`  CONSTRAINT ${q(c.constraint_name)} UNIQUE (${cols})`);
    else if (c.constraint_type === "R") lines.push(`  CONSTRAINT ${q(c.constraint_name)} FOREIGN KEY (${cols}) REFERENCES ${c.r_owner && c.r_owner !== owner ? `${q(c.r_owner)}.` : ""}${q(c.r_table_name)} (${String(c.r_columns ?? "").split(",").filter(Boolean).map(q).join(", ")})`);
    else if (c.constraint_type === "C" && !isNotNullCheck(c)) lines.push(`  CONSTRAINT ${q(c.constraint_name)} CHECK (${String(c.search_condition ?? "").trim()})`);
  }
  const out = [`CREATE TABLE ${q(owner)}.${q(table)} (\n${lines.join(",\n")}\n);`];
  const constraintNames = new Set(constraints.map((c) => c.constraint_name));
  for (const i of indexes) {
    if (constraintNames.has(i.index_name)) continue; // PK·UK 가 만든 인덱스는 위 제약으로 충분하다
    out.push(`CREATE ${i.uniqueness === "UNIQUE" ? "UNIQUE " : ""}INDEX ${q(owner)}.${q(i.index_name)} ON ${q(owner)}.${q(table)} (${String(i.columns ?? "").split(",").filter(Boolean).map(q).join(", ")});`);
  }
  if (comment) out.push(`COMMENT ON TABLE ${q(owner)}.${q(table)} IS '${String(comment).replace(/'/g, "''")}';`);
  for (const c of columns) if (c.comments) out.push(`COMMENT ON COLUMN ${q(owner)}.${q(table)}.${q(c.column_name)} IS '${String(c.comments).replace(/'/g, "''")}';`);
  return `${out.join("\n")}\n`;
}

/** 인덱스 _meta 의 정의 없는 프로시저(`PKG.PROC`·`OWNER.PROC`·`PROC`)에서 내보낼 객체 이름 후보. */
export function undefinedObjectNames(/** @type {string} */ root) {
  const meta = readJson(join(root, "_workspace", "index", "_meta.json"), {});
  const names = new Set();
  for (const item of meta?.db_source?.undefined_procedures?.items ?? []) {
    const parts = String(item.name ?? "").toUpperCase().split(".").filter(Boolean);
    /* `A.B` 는 패키지.멤버 또는 스키마.프로시저 — 둘 다 후보로 둔다(없는 이름은 사전에서 걸러진다). */
    for (const part of parts.slice(-2)) names.add(part);
  }
  return names;
}

/** 덤프 폴더를 인덱서 설정 db_dump_paths 에 넣는다. 다른 키는 건드리지 않는다. */
export function registerDumpPath(/** @type {string} */ root, /** @type {string} */ rel) {
  const path = join(root, "_workspace", "indexer-config.json");
  const config = readJson(path, {});
  const list = Array.isArray(config.db_dump_paths) ? config.db_dump_paths : [];
  if (list.includes(rel)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...config, db_dump_paths: [...list, rel] }, null, 2)}\n`, "utf8");
  return true;
}

/**
 * @param {import("./driver.mjs").Db} db
 * @param {{ owner?: string, only_undefined?: boolean, out?: string }} args
 * @param {{ root: string, owners: string[], now?: () => string }} ctx
 */
export async function dbExport(db, args, ctx) {
  const root = resolve(ctx.root);
  const outRel = String(args.out || "db/dump").replace(/\\/g, "/").replace(/^\.\/|\/$/g, "");
  const out = resolve(root, outRel);
  if (isAbsolute(outRel) || relative(root, out).startsWith("..")) throw new Error(`덤프 폴더는 프로젝트 안이어야 합니다: ${outRel}`);
  const owners = ownersOf(db, ctx.owners, args.owner);
  const own = inList("o", owners);
  /** @type {{what: string, reason: string}[]} */
  const skipped = [];
  const attempt = async (/** @type {string} */ what, /** @type {() => Promise<any[]>} */ fn) => {
    try { return (await fn()).map(lower); } catch (error) { skipped.push({ what, reason: String(/** @type {any} */ (error)?.message ?? error).split("\n")[0] ?? "" }); return []; }
  };

  const objects = (await db.all(SQL.objects(own.sql), { ...own.binds, pattern: null, otype: null })).map(lower);
  const wrappedRows = await attempt("암호화 여부", () => db.all(SQL.wrapped(own.sql), own.binds));
  const wrapped = new Set(wrappedRows.map((r) => `${r.owner}/${r.type}/${r.name}`));
  const only = args.only_undefined ? undefinedObjectNames(root) : null;
  const manifestPath = join(out, "_export_manifest.json");
  const previous = readJson(manifestPath, {})?.objects ?? {};
  /** @type {Record<string, string>} */
  const manifest = { ...previous };
  const counts = { written: 0, unchanged: 0, wrapped: 0, tables: 0, views: 0, sequences: 0, synonyms: 0 };
  const write = (/** @type {string} */ rel, /** @type {string} */ text) => {
    const file = join(out, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  };

  /* PL/SQL 소스 — 객체마다 따로 받는다(한 번에 받으면 큰 스키마에서 메모리가 커진다). 바뀌지 않은 객체는 건너뛴다. */
  for (const o of objects) {
    const kind = PLSQL[o.object_type];
    if (!kind) continue;
    if (only && !only.has(o.object_name)) continue;
    const key = `${o.owner}/${o.object_type}/${o.object_name}`;
    const rel = `${safe(o.owner)}/${kind[0]}/${safe(o.object_name)}${kind[1]}`;
    if (wrapped.has(key)) { counts.wrapped += 1; continue; }
    if (previous[key] && previous[key] === o.last_ddl_time && existsSync(join(out, rel))) { counts.unchanged += 1; continue; }
    const lines = (await db.all(SQL.source, { owner: o.owner, name: o.object_name, stype: o.object_type })).map(lower);
    if (!lines.length) continue;
    if (isWrapped(lines[0]?.text)) { counts.wrapped += 1; wrapped.add(key); continue; }
    const body = lines.map((l) => String(l.text ?? "")).join("").replace(/\s+$/, "");
    write(rel, `CREATE OR REPLACE ${body.replace(/^\s+/, "")}\n/\n`);
    manifest[key] = o.last_ddl_time;
    counts.written += 1;
  }

  /* 구조 DDL — 정의 없는 프로시저만 받을 때는 건너뛴다(그때는 소스가 목적이다). */
  const columns = only ? [] : await attempt("컬럼", () => db.all(SQL.columns(own.sql), { ...own.binds, name: null }));
  const constraints = await attempt("제약", () => db.all(SQL.constraints(own.sql), { ...own.binds, name: null }));
  const tableComments = await attempt("테이블 코멘트", () => db.all(SQL.tableComments(own.sql), { ...own.binds, name: null }));
  if (!only) {
    const indexes = await attempt("인덱스", () => db.all(SQL.indexes(own.sql), { ...own.binds, name: null }));
    const group = (/** @type {any[]} */ rows, /** @type {string} */ field) => {
      /** @type {Map<string, any[]>} */
      const map = new Map();
      for (const r of rows) { const k = `${r.owner}\u0000${r[field]}`; map.set(k, [...(map.get(k) ?? []), r]); }
      return map;
    };
    const byCons = group(constraints, "table_name");
    const byIdx = group(indexes, "table_name");
    const comments = new Map(tableComments.map((r) => [`${r.owner}\u0000${r.table_name}`, r.comments]));
    for (const [k, cols] of group(columns, "table_name")) {
      const [owner = "", table = ""] = k.split("\u0000");
      write(`${safe(owner)}/tables/${safe(table)}.ddl`, tableDdl(owner, table, cols, byCons.get(k) ?? [], byIdx.get(k) ?? [], comments.get(k)));
      counts.tables += 1;
    }
    for (const v of await attempt("뷰", () => db.all(SQL.views(own.sql), own.binds))) {
      write(`${safe(v.owner)}/views/${safe(v.view_name)}.ddl`, `CREATE OR REPLACE VIEW ${q(v.owner)}.${q(v.view_name)} AS\n${String(v.text ?? "").trim()};\n`);
      counts.views += 1;
    }
    const seqs = group(await attempt("시퀀스", () => db.all(SQL.sequences(own.sql), own.binds)), "owner");
    for (const [k, rows] of seqs) {
      const owner = k.split("\u0000")[0] ?? "";
      write(`${safe(owner)}/sequences.ddl`, rows.map((s) => `CREATE SEQUENCE ${q(owner)}.${q(s.sequence_name)} START WITH ${s.last_number} INCREMENT BY ${s.increment_by};`).join("\n") + "\n");
      counts.sequences += rows.length;
    }
    const syns = group(await attempt("시노님", () => db.all(SQL.synonyms(own.sql), own.binds)), "owner");
    for (const [k, rows] of syns) {
      const owner = k.split("\u0000")[0] ?? "";
      const head = owner === "PUBLIC" ? "CREATE PUBLIC SYNONYM " : `CREATE SYNONYM ${q(owner)}.`;
      write(`${safe(owner)}/synonyms.ddl`, rows.map((s) => `${head}${q(s.synonym_name)} FOR ${s.table_owner ? `${q(s.table_owner)}.` : ""}${q(s.table_name)}${s.db_link ? `@${s.db_link}` : ""};`).join("\n") + "\n");
      counts.synonyms += rows.length;
    }
  }

  /* DB 가 아는 사실 — 인덱서가 정규식 근사 위에 덮는다. */
  const dependencies = await attempt("의존 관계", () => db.all(SQL.allDependencies(own.sql), own.binds));
  const triggers = await attempt("트리거", () => db.all(SQL.triggers(own.sql), { ...own.binds, name: null }));
  const jobs = [
    ...(await attempt("스케줄러 잡", () => db.all(SQL.schedulerJobs(own.sql), own.binds)))
      .map((j) => ({ kind: "scheduler", owner: j.owner, name: j.job_name, action: j.job_action ?? j.program_action ?? null, schedule: j.repeat_interval ?? null, enabled: j.enabled === "TRUE" })),
    ...(await attempt("DBMS_JOB 잡", () => db.all(SQL.legacyJobs(own.sql), own.binds)))
      .map((j) => ({ kind: "dbms_job", owner: j.owner, name: String(j.job), action: j.what ?? null, schedule: j.interval ?? null, enabled: j.broken !== "Y" })),
  ].map((j) => ({ ...j, targets: callTargets(j.action ?? "") }));
  const columnComments = await attempt("컬럼 코멘트", () => db.all(SQL.columnComments(own.sql), own.binds));
  const catalog = {
    version: 1,
    generator: "ax-navi db_export",
    dialect: "oracle",
    exported_at: ctx.now ? ctx.now() : new Date().toISOString(),
    user: db.user,
    owners,
    scope: only ? "undefined-procedures" : "all",
    objects: objects.map((o) => ({ owner: o.owner, name: o.object_name, type: o.object_type, status: o.status, last_ddl_time: o.last_ddl_time, ...(wrapped.has(`${o.owner}/${o.object_type}/${o.object_name}`) ? { wrapped: true } : {}) })),
    dependencies: dependencies.map((d) => ({ owner: d.owner, name: d.name, type: d.type, ref_owner: d.referenced_owner, ref_name: d.referenced_name, ref_type: d.referenced_type, ...(d.referenced_link_name ? { ref_link: d.referenced_link_name } : {}) })),
    triggers: triggers.map((t) => ({ owner: t.owner, name: t.trigger_name, table_owner: t.table_owner, table: t.table_name, timing: t.trigger_type, events: String(t.triggering_event ?? "").split(/\s+OR\s+/i).map((e) => e.trim().toUpperCase()).filter(Boolean), status: t.status })),
    jobs,
    comments: {
      tables: tableComments.map((c) => ({ owner: c.owner, table: c.table_name, comment: c.comments })),
      columns: columnComments.map((c) => ({ owner: c.owner, table: c.table_name, column: c.column_name, comment: c.comments })),
    },
    constraints: constraints.filter((c) => !isNotNullCheck(c)).map((c) => ({ owner: c.owner, table: c.table_name, name: c.constraint_name, type: c.constraint_type, columns: String(c.columns ?? "").split(",").filter(Boolean), ...(c.r_table_name ? { ref_table: c.r_table_name, ref_columns: String(c.r_columns ?? "").split(",").filter(Boolean) } : {}), ...(c.search_condition && c.constraint_type === "C" ? { condition: String(c.search_condition).trim() } : {}) })),
    skipped,
  };
  write("_catalog.json", `${JSON.stringify(catalog, null, 1)}\n`);
  write("_export_manifest.json", `${JSON.stringify({ exported_at: catalog.exported_at, owners, objects: manifest }, null, 1)}\n`);
  const registered = registerDumpPath(root, outRel);
  return {
    out: outRel,
    owners,
    scope: catalog.scope,
    plsql: { written: counts.written, unchanged: counts.unchanged, wrapped: counts.wrapped },
    ddl: { tables: counts.tables, views: counts.views, sequences: counts.sequences, synonyms: counts.synonyms },
    catalog: { objects: catalog.objects.length, dependencies: catalog.dependencies.length, triggers: catalog.triggers.length, jobs: jobs.length, column_comments: columnComments.length },
    indexer_config: registered ? `_workspace/indexer-config.json 의 db_dump_paths 에 ${outRel} 를 넣었습니다.` : `db_dump_paths 에 ${outRel} 가 이미 있습니다.`,
    skipped,
    next: "인덱스에 반영하려면 \"인덱스만 갱신해줘\"(build-index --mode incremental)를 실행하세요. 덤프는 구조·소스만 담고 데이터 행은 없습니다.",
  };
}
