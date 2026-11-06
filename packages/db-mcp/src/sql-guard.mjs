/*
 * db_query 가 받는 자유 SQL 의 사전 검사. 한 문장의 SELECT/WITH 만 통과시킨다.
 *
 * 이 검사는 실수를 막는 첫 겹일 뿐이다. `SELECT 함수()` 안의 자율 트랜잭션 DML 같은 것은 글자로 막을 수 없으므로
 * 실제 보증은 읽기 전용 계정 권한과 접속 때 건 `SET TRANSACTION READ ONLY` 에 둔다.
 */

/** 문자열 리터럴·따옴표 식별자·주석을 공백으로 지워 키워드 검사가 그 안을 보지 않게 한다. */
export function stripSqlNoise(/** @type {string} */ sql) {
  return sql
    .replace(/'(?:[^']|'')*'/g, (m) => " ".repeat(m.length))
    .replace(/"(?:[^"]|"")*"/g, (m) => " ".repeat(m.length))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** @returns {{ ok: true, sql: string } | { ok: false, reason: string }} */
export function checkReadOnlySql(/** @type {string} */ input) {
  const sql = String(input ?? "").trim().replace(/[;\s/]+$/, "");
  if (!sql) return { ok: false, reason: "SQL 이 비어 있습니다." };
  const bare = stripSqlNoise(sql);
  if (/\/\*|'|"/.test(bare.replace(/\s+/g, ""))) return { ok: false, reason: "닫히지 않은 따옴표나 주석이 있습니다." };
  if (bare.includes(";")) return { ok: false, reason: "한 번에 한 문장만 실행합니다(세미콜론으로 이어진 여러 문장 불가)." };
  if (!/^\s*(?:select|with)\b/i.test(bare)) return { ok: false, reason: "SELECT 또는 WITH 로 시작하는 조회문만 실행합니다." };
  const banned = /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|rename|comment|lock|commit|rollback|savepoint|execute|exec|call|begin|declare)\b/i.exec(bare);
  if (banned) return { ok: false, reason: `조회문에 '${banned[1]}' 이(가) 있습니다. 데이터·구조를 바꾸는 문장은 실행하지 않습니다.` };
  if (/\bfor\s+update\b/i.test(bare)) return { ok: false, reason: "FOR UPDATE 는 행을 잠그므로 실행하지 않습니다." };
  if (/@\s*[A-Za-z_]/.test(bare)) return { ok: false, reason: "DB 링크(@링크)를 통한 원격 조회는 실행하지 않습니다." };
  return { ok: true, sql };
}

/** 행 상한을 감싼다. 원문이 ORDER BY 를 가져도 바깥에서 자르므로 순서는 유지된다. */
export function limitRows(/** @type {string} */ sql, /** @type {number} */ maxRows) {
  return `SELECT * FROM (\n${sql}\n) WHERE ROWNUM <= ${Math.max(1, Math.floor(maxRows))}`;
}
