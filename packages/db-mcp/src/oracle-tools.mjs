/*
 * Oracle 사전(dictionary) 뷰로 답하는 DB 도구들. 실행하는 SQL 은 전부 이 파일의 상수이고, 바깥 값은 바인드 변수로만 들어간다.
 *
 * 소스를 받아 정규식으로 다시 읽는 대신 DB 가 이미 아는 사실을 그대로 쓴다.
 *   ALL_DEPENDENCIES  컴파일러가 기록한 객체 간 참조(동의어·오버로드를 풀어 둔 정확한 값)
 *   ALL_SOURCE        패키지·프로시저·트리거 본문
 *   ALL_SCHEDULER_JOBS·ALL_JOBS  어떤 프로시저가 배치로 도는가(소스만으로는 보이지 않는 진입점)
 *   ALL_TAB_COMMENTS·ALL_COL_COMMENTS  한글 업무명
 */

/** IN 목록용 바인드 자리표시자와 값. 문장 모양은 개수만 달라질 뿐 값은 문장에 섞이지 않는다. */
export function inList(/** @type {string} */ prefix, /** @type {string[]} */ values) {
  /** @type {Record<string, string>} */
  const binds = {};
  const marks = values.map((value, i) => { binds[`${prefix}${i}`] = value; return `:${prefix}${i}`; });
  return { sql: marks.length ? marks.join(", ") : "NULL", binds };
}

/** 사용자가 준 이름을 사전 뷰 표기(대문자, 따옴표 없음)로. `OWNER.PKG.PROC` 는 객체 이름 `PKG` 와 멤버 `PROC` 로 나눈다. */
export function splitName(/** @type {string} */ raw, /** @type {string[]} */ owners) {
  const parts = String(raw ?? "").replace(/"/g, "").split(".").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (parts.length >= 3) return { owner: parts[0] ?? "", object: parts[1] ?? "", member: parts[2] ?? "" };
  if (parts.length === 2) {
    /* `A.B` 는 `스키마.객체` 일 수도, `패키지.멤버` 일 수도 있다. 대상 스키마 이름과 같으면 앞의 것으로 본다. */
    return owners.includes(parts[0] ?? "") ? { owner: parts[0] ?? "", object: parts[1] ?? "", member: "" } : { owner: "", object: parts[0] ?? "", member: parts[1] ?? "" };
  }
  return { owner: "", object: parts[0] ?? "", member: "" };
}

const SQL = {
  objects: (owners) => `
SELECT o.owner, o.object_name, o.object_type, o.status, TO_CHAR(o.last_ddl_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_ddl_time
  FROM all_objects o
 WHERE o.owner IN (${owners})
   AND o.object_type IN ('TABLE','VIEW','MATERIALIZED VIEW','SEQUENCE','SYNONYM','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TYPE','TYPE BODY')
   AND o.object_name NOT LIKE 'BIN$%'
   AND (:pattern IS NULL OR o.object_name LIKE :pattern ESCAPE '\\')
   AND (:otype IS NULL OR o.object_type = :otype)
 ORDER BY o.owner, o.object_name, o.object_type`,
  commentSearch: (owners) => `
SELECT c.owner, c.table_name, NULL AS column_name, c.comments FROM all_tab_comments c
 WHERE c.owner IN (${owners}) AND c.comments LIKE :text
UNION ALL
SELECT c.owner, c.table_name, c.column_name, c.comments FROM all_col_comments c
 WHERE c.owner IN (${owners}) AND c.comments LIKE :text`,
  wrapped: (owners) => `
SELECT s.owner, s.name, s.type FROM all_source s
 WHERE s.owner IN (${owners}) AND s.line = 1 AND REGEXP_LIKE(SUBSTR(s.text, 1, 200), '\\swrapped(\\s|$)', 'i')`,
  source: `
SELECT s.line, s.text FROM all_source s
 WHERE s.owner = :owner AND s.name = :name AND s.type = :stype
 ORDER BY s.line`,
  sourceTypes: (owners) => `
SELECT DISTINCT s.owner, s.type FROM all_source s
 WHERE s.owner IN (${owners}) AND s.name = :name`,
  dependsOn: (owners) => `
SELECT d.owner, d.name, d.type, d.referenced_owner, d.referenced_name, d.referenced_type, d.referenced_link_name
  FROM all_dependencies d
 WHERE d.owner IN (${owners}) AND d.name = :name
   AND d.referenced_owner NOT IN ('SYS','PUBLIC','SYSTEM','XDB','MDSYS','CTXSYS','ORDSYS')
 ORDER BY d.referenced_type, d.referenced_name`,
  referencedBy: (owners) => `
SELECT d.owner, d.name, d.type, d.referenced_owner, d.referenced_name, d.referenced_type
  FROM all_dependencies d
 WHERE d.referenced_owner IN (${owners}) AND d.referenced_name = :name
 ORDER BY d.type, d.name`,
  allDependencies: (owners) => `
SELECT d.owner, d.name, d.type, d.referenced_owner, d.referenced_name, d.referenced_type, d.referenced_link_name
  FROM all_dependencies d
 WHERE d.owner IN (${owners})
   AND d.referenced_owner NOT IN ('SYS','PUBLIC','SYSTEM','XDB','MDSYS','CTXSYS','ORDSYS')
   AND d.type IN ('PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','VIEW','TYPE BODY','MATERIALIZED VIEW')`,
  columns: (owners) => `
SELECT c.owner, c.table_name, c.column_id, c.column_name, c.data_type, c.data_length, c.char_length, c.char_used,
       c.data_precision, c.data_scale, c.nullable, cc.comments
  FROM all_tab_columns c
  JOIN all_tables t ON t.owner = c.owner AND t.table_name = c.table_name
  LEFT JOIN all_col_comments cc ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
 WHERE c.owner IN (${owners}) AND (:name IS NULL OR c.table_name = :name)
 ORDER BY c.owner, c.table_name, c.column_id`,
  tableComments: (owners) => `
SELECT c.owner, c.table_name, c.table_type, c.comments FROM all_tab_comments c
 WHERE c.owner IN (${owners}) AND c.comments IS NOT NULL AND (:name IS NULL OR c.table_name = :name)`,
  columnComments: (owners) => `
SELECT c.owner, c.table_name, c.column_name, c.comments FROM all_col_comments c
 WHERE c.owner IN (${owners}) AND c.comments IS NOT NULL`,
  constraints: (owners) => `
SELECT c.owner, c.table_name, c.constraint_name, c.constraint_type, c.status, c.search_condition,
       r.owner AS r_owner, r.table_name AS r_table_name,
       (SELECT LISTAGG(cc.column_name, ',') WITHIN GROUP (ORDER BY cc.position) FROM all_cons_columns cc
         WHERE cc.owner = c.owner AND cc.constraint_name = c.constraint_name) AS columns,
       (SELECT LISTAGG(rc.column_name, ',') WITHIN GROUP (ORDER BY rc.position) FROM all_cons_columns rc
         WHERE rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name) AS r_columns
  FROM all_constraints c
  LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
 WHERE c.owner IN (${owners}) AND c.constraint_type IN ('P','U','R','C')
   AND c.table_name NOT LIKE 'BIN$%'
   AND (:name IS NULL OR c.table_name = :name)
 ORDER BY c.owner, c.table_name, c.constraint_type, c.constraint_name`,
  indexes: (owners) => `
SELECT i.owner, i.index_name, i.table_name, i.uniqueness,
       (SELECT LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) FROM all_ind_columns ic
         WHERE ic.index_owner = i.owner AND ic.index_name = i.index_name) AS columns
  FROM all_indexes i
 WHERE i.owner IN (${owners}) AND i.index_type NOT IN ('LOB') AND i.table_name NOT LIKE 'BIN$%'
   AND (:name IS NULL OR i.table_name = :name)`,
  triggers: (owners) => `
SELECT t.owner, t.trigger_name, t.table_owner, t.table_name, t.trigger_type, t.triggering_event, t.status
  FROM all_triggers t
 WHERE t.owner IN (${owners}) AND (:name IS NULL OR t.table_name = :name)`,
  views: (owners) => `
SELECT v.owner, v.view_name, v.text FROM all_views v WHERE v.owner IN (${owners})`,
  sequences: (owners) => `
SELECT s.sequence_owner AS owner, s.sequence_name, s.min_value, s.increment_by, s.last_number
  FROM all_sequences s WHERE s.sequence_owner IN (${owners})`,
  synonyms: (owners) => `
SELECT s.owner, s.synonym_name, s.table_owner, s.table_name, s.db_link FROM all_synonyms s
 WHERE s.owner IN (${owners}) OR (s.owner = 'PUBLIC' AND s.table_owner IN (${owners}))`,
  schedulerJobs: (owners) => `
SELECT j.owner, j.job_name, j.job_type, j.job_action, j.program_owner, j.program_name, p.program_action,
       j.repeat_interval, j.enabled, j.state
  FROM all_scheduler_jobs j
  LEFT JOIN all_scheduler_programs p ON p.owner = j.program_owner AND p.program_name = j.program_name
 WHERE j.owner IN (${owners})`,
  legacyJobs: (owners) => `
SELECT j.job, j.schema_user AS owner, j.what, j.interval, j.broken FROM all_jobs j WHERE j.schema_user IN (${owners})`,
};
export const ORACLE_SQL = SQL;

/** 사전 조회 하나가 권한 부족 등으로 실패해도 나머지는 계속한다. 무엇이 빠졌는지는 skipped 로 돌려준다. */
async function attempt(/** @type {{what: string, reason: string}[]} */ skipped, /** @type {string} */ what, /** @type {() => Promise<any[]>} */ fn) {
  try {
    return await fn();
  } catch (error) {
    skipped.push({ what, reason: String(/** @type {any} */ (error)?.message ?? error).split("\n")[0] ?? "" });
    return [];
  }
}

/** 문자열 안에서 `PKG.PROC` · `OWNER.PKG.PROC` · `PROC` 꼴의 호출 대상 이름을 뽑는다(잡 action 용). */
export function callTargets(/** @type {string} */ text) {
  const names = new Set();
  const code = String(text ?? "").replace(/'(?:[^']|'')*'/g, " ").replace(/--[^\n]*/g, " ");
  const skip = new Set(["BEGIN", "END", "NULL", "DECLARE", "IF", "THEN", "ELSE", "LOOP", "COMMIT", "ROLLBACK", "SYSDATE", "DBMS_OUTPUT", "DBMS_LOCK"]);
  for (const m of code.matchAll(/([A-Za-z][\w$#]*(?:\s*\.\s*[A-Za-z][\w$#]*){0,2})\s*(?=\(|;|$)/g)) {
    const name = (m[1] ?? "").replace(/\s+/g, "").toUpperCase();
    if (name && !skip.has(name) && !skip.has(name.split(".")[0] ?? "")) names.add(name);
  }
  return [...names];
}

/** 암호화(wrap)된 PL/SQL 은 첫 줄이 `PACKAGE BODY x wrapped` 로 시작하고 본문은 읽을 수 없다. */
export const isWrapped = (/** @type {any} */ firstLine) => /\swrapped(?:\s|$)/i.test(String(firstLine ?? "").slice(0, 200));

/** NOT NULL 은 컬럼 정의에 이미 있다 — 이름 없는 `"X" IS NOT NULL` 검사 제약은 덜어 낸다. */
export const isNotNullCheck = (/** @type {any} */ c) => c.constraint_type === "C" && /^\s*"?[\w$#]+"?\s+IS\s+NOT\s+NULL\s*$/i.test(String(c.search_condition ?? ""));

/** 사전 뷰 행(대문자 키)을 소문자 키 객체로. */
function lower(/** @type {any} */ row) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(row ?? {})) if (value !== null && value !== undefined) out[key.toLowerCase()] = value;
  return out;
}

/** @param {import("./driver.mjs").Db} db */
export function ownersOf(db, /** @type {string[]} */ configured, /** @type {any} */ arg) {
  const given = String(arg ?? "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  return given.length ? given : configured.length ? configured : [db.user];
}

export const TOOLS = {
  /** 이름 패턴·유형·한글 코멘트로 객체를 찾는다. */
  async db_objects(/** @type {import("./driver.mjs").Db} */ db, /** @type {any} */ args, /** @type {any} */ ctx) {
    const owners = ownersOf(db, ctx.owners, args.owner);
    const own = inList("o", owners);
    const pattern = args.name ? String(args.name).toUpperCase().replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%") : null;
    const like = pattern && !pattern.includes("%") ? `%${pattern}%` : pattern;
    const limit = Math.min(Number(args.limit) || 100, 500);
    const rows = (await db.all(SQL.objects(own.sql), { ...own.binds, pattern: like, otype: args.type ? String(args.type).toUpperCase() : null }, limit)).map(lower);
    const result = { owners, objects: rows };
    if (args.comment) {
      result.comment_matches = (await db.all(SQL.commentSearch(own.sql), { ...own.binds, text: `%${args.comment}%` }, limit)).map(lower);
    }
    return result;
  },

  /** 패키지·프로시저·함수·트리거 소스(줄 번호 포함). `PKG.PROC` 면 패키지 바디에서 그 멤버 구간만 준다. */
  async db_source(/** @type {import("./driver.mjs").Db} */ db, /** @type {any} */ args, /** @type {any} */ ctx) {
    const owners = ownersOf(db, ctx.owners, args.owner);
    const name = splitName(args.name, owners);
    const scope = name.owner ? [name.owner] : owners;
    const own = inList("o", scope);
    const types = (await db.all(SQL.sourceTypes(own.sql), { ...own.binds, name: name.object })).map(lower);
    if (!types.length) return { found: false, message: `${scope.join(",")} 스키마에서 ${name.object} 소스를 찾지 못했습니다(이름·권한 확인). db_objects 로 찾아보세요.` };
    const wanted = args.type ? String(args.type).toUpperCase() : (name.member ? "PACKAGE BODY" : null);
    const pick = types.find((t) => !wanted || t.type === wanted) ?? types[0];
    const lines = (await db.all(SQL.source, { owner: pick.owner, name: name.object, stype: pick.type })).map(lower);
    let from = 1;
    let to = lines.length;
    if (name.member) {
      const head = new RegExp(String.raw`^\s*(?:procedure|function)\s+"?${name.member}"?\b`, "i");
      const start = lines.findIndex((l) => head.test(l.text ?? ""));
      if (start >= 0) {
        from = start + 1;
        /* `END 멤버;` 가 있으면 거기까지, 없으면 다음 멤버 바로 앞까지. */
        const close = new RegExp(String.raw`^\s*end\s+"?${name.member}"?\s*;`, "i");
        const end = lines.findIndex((l, i) => i > start && close.test(l.text ?? ""));
        const next = lines.findIndex((l, i) => i > start && /^\s*(?:procedure|function)\s+[\w$#"]+/i.test(l.text ?? ""));
        to = end > 0 ? end + 1 : next > 0 ? next : lines.length;
      }
    }
    const maxLines = Math.min(Number(args.max_lines) || 1500, 5000);
    const slice = lines.slice(from - 1, Math.min(to, from - 1 + maxLines));
    const wrapped = isWrapped(lines[0]?.text);
    return {
      owner: pick.owner, name: name.object, type: pick.type, member: name.member || undefined,
      other_types: types.filter((t) => t !== pick).map((t) => t.type),
      wrapped, lines_total: lines.length, from, to: from + slice.length - 1,
      truncated: from - 1 + maxLines < to ? true : undefined,
      source: wrapped ? "(암호화된 PL/SQL 이라 본문을 읽을 수 없습니다)" : slice.map((l) => `${String(l.line).padStart(5)}  ${String(l.text ?? "").replace(/\n$/, "")}`).join("\n"),
    };
  },

  /** 이 객체가 참조하는 것, 이 객체를 참조하는 것(컴파일러 기준). */
  async db_dependencies(/** @type {import("./driver.mjs").Db} */ db, /** @type {any} */ args, /** @type {any} */ ctx) {
    const owners = ownersOf(db, ctx.owners, args.owner);
    const name = splitName(args.name, owners);
    const own = inList("o", name.owner ? [name.owner] : owners);
    const direction = String(args.direction ?? "both");
    const limit = Math.min(Number(args.limit) || 300, 2000);
    const out = { owners, name: name.object, note: "ALL_DEPENDENCIES 는 객체 단위다 — 패키지 멤버 하나가 아니라 패키지 전체의 참조이며, 동적 SQL(EXECUTE IMMEDIATE) 안의 참조는 나오지 않는다." };
    if (direction !== "referenced_by") out.depends_on = (await db.all(SQL.dependsOn(own.sql), { ...own.binds, name: name.object }, limit)).map(lower);
    if (direction !== "depends_on") out.referenced_by = (await db.all(SQL.referencedBy(own.sql), { ...own.binds, name: name.object }, limit)).map(lower);
    return out;
  },

  /** 테이블 하나의 컬럼·코멘트·제약·인덱스·트리거와, 그 테이블을 참조하는 객체·그 객체를 돌리는 배치 잡. */
  async db_table(/** @type {import("./driver.mjs").Db} */ db, /** @type {any} */ args, /** @type {any} */ ctx) {
    const owners = ownersOf(db, ctx.owners, args.owner);
    const name = splitName(args.name, owners);
    const own = inList("o", name.owner ? [name.owner] : owners);
    const binds = { ...own.binds, name: name.object };
    /** @type {{what: string, reason: string}[]} */
    const skipped = [];
    const columns = (await db.all(SQL.columns(own.sql), binds)).map(lower);
    if (!columns.length) return { found: false, message: `${name.object} 테이블을 찾지 못했습니다(이름·스키마·권한 확인).` };
    const comment = (await attempt(skipped, "테이블 코멘트", () => db.all(SQL.tableComments(own.sql), binds))).map(lower)[0]?.comments;
    const constraints = (await attempt(skipped, "제약", () => db.all(SQL.constraints(own.sql), binds))).map(lower).filter((c) => !isNotNullCheck(c));
    const indexes = (await attempt(skipped, "인덱스", () => db.all(SQL.indexes(own.sql), binds))).map(lower);
    const triggers = (await attempt(skipped, "트리거", () => db.all(SQL.triggers(own.sql), binds))).map(lower);
    const referencedBy = (await attempt(skipped, "참조 객체", () => db.all(SQL.referencedBy(own.sql), { ...own.binds, name: name.object }, 500))).map(lower);
    /* 그 테이블을 참조하는 프로시저·패키지를 부르는 잡. 잡 action 의 호출 대상 이름으로 잇는다. */
    const users = new Set(referencedBy.map((r) => r.name));
    const jobOwners = inList("j", [...new Set([...owners, ...referencedBy.map((r) => r.owner)])]);
    const jobs = [
      ...(await attempt(skipped, "스케줄러 잡", () => db.all(SQL.schedulerJobs(jobOwners.sql), jobOwners.binds))).map(lower)
        .map((j) => ({ kind: "scheduler", owner: j.owner, name: j.job_name, action: j.job_action ?? j.program_action, schedule: j.repeat_interval, enabled: j.enabled, state: j.state })),
      ...(await attempt(skipped, "DBMS_JOB 잡", () => db.all(SQL.legacyJobs(jobOwners.sql), jobOwners.binds))).map(lower)
        .map((j) => ({ kind: "dbms_job", owner: j.owner, name: String(j.job), action: j.what, schedule: j.interval, enabled: j.broken === "N" ? "TRUE" : "FALSE" })),
    ].filter((j) => callTargets(j.action).some((t) => t.split(".").some((part) => users.has(part))));
    return { owner: columns[0]?.owner, name: name.object, comment, columns, constraints, indexes, triggers, referenced_by: referencedBy, jobs, skipped: skipped.length ? skipped : undefined };
  },
};
