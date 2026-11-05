/*
 * SQL 방언 판별 — oracle · mssql · mysql · postgresql · generic.
 *
 * 왜 필요한가: `.sql` 파일에 `CREATE PROCEDURE`가 있으면 예전에는 DB 종류와 무관하게 전부 Oracle PL/SQL 파서로 넘겼다.
 * T-SQL·MySQL·PL/pgSQL 프로시저를 그 파서로 읽으면 이름만 잡히고 본문 해석은 빗나간다. 파일 내용에서 방언을 먼저 가려
 * 알맞은 추출기로 보내고, 가릴 수 없으면 `generic`을 돌려줘 기존(Oracle) 경로를 그대로 탄다(하위 호환).
 *
 * 점수 기준: 그 방언에서만 나오는 표식이 있으면 가점. 표식 하나(우연 일치)로 결정하지 않도록 최소 점수와 2위와의 격차를 둔다.
 * 정규식 기반의 근사다 — 실제 DB가 낸 덤프로 검증된 값이 아니라 흔한 덤프 도구(DBMS_METADATA·SSMS·mysqldump·pg_dump)의 모양을 따른다.
 */

/* 오라클 전용 확장자는 내용을 볼 것도 없이 오라클이다. build-index.mjs 의 PLSQL_EXTENSIONS 와 같은 목록. */
const ORACLE_EXTENSIONS = new Set([".pks", ".pkb", ".pck", ".spc", ".bdy", ".prc", ".fnc", ".trg", ".pls"]);

const SIGNALS = {
  oracle: [
    /\bvarchar2\s*\(/i, /\bnvarchar2\s*\(/i, /\bnumber\s*(?:\(|,|\s+(?:not\s+null|default))/i, /\btablespace\b/i,
    /\bsegment\s+creation\b/i, /\bcreate\s+(?:or\s+replace\s+)?(?:(?:non)?editionable\s+)?package\b/i, /\bdbms_\w+/i,
    /\bpragma\s+(?:autonomous_transaction|exception_init)\b/i, /%(?:row)?type\b/i, /\bfrom\s+dual\b/i, /\bnocompress\b/i,
    /\bcreate\s+or\s+replace\s+force\s+view\b/i,
  ],
  mssql: [
    /^[ \t]*go[ \t]*$/im, /\[dbo\]|\[\w+\]\s*\.\s*\[\w+\]/, /\bset\s+ansi_nulls\b/i, /\bset\s+quoted_identifier\b/i,
    /\bidentity\s*\(\s*\d+\s*,\s*\d+\s*\)/i, /\bdeclare\s+@\w+/i, /\bgetdate\s*\(\s*\)/i, /\bon\s+\[primary\]/i,
    /\b(?:non)?clustered\b/i, /\bnvarchar\s*\(\s*(?:max|\d+)\s*\)/i, /\bexec(?:ute)?\s+(?:\[?\w+\]?\s*\.\s*)?\[?(?:sp|usp|pr)_\w+/i,
    /\bsp_executesql\b/i, /\bcreate\s+(?:or\s+alter\s+)?proc\b/i,
  ],
  mysql: [
    /\bengine\s*=\s*\w+/i, /\bauto_increment\b/i, /^[ \t]*delimiter\b/im, /\/\*!\d{5}/, /\bunsigned\b/i,
    /\bdefault\s+charset\s*=/i, /\block\s+tables\b/i, /\bdefiner\s*=\s*`/i, /\btinyint\s*\(\s*\d+\s*\)/i,
  ],
  postgresql: [
    /\$\$/, /\blanguage\s+plpgsql\b/i, /\b(?:big|small)?serial\b/i, /::\s*(?:text|integer|bigint|regclass|character\s+varying|timestamp|date|numeric|boolean|jsonb?)\b/i,
    /\bowner\s+to\b/i, /\bset\s+search_path\b/i, /\bcreate\s+extension\b/i, /\breturns\s+trigger\b/i, /\bcharacter\s+varying\b/i,
    /\bnextval\s*\(/i, /\btimestamp\s+(?:with|without)\s+time\s+zone\b/i, /\bexecute\s+(?:function|procedure)\b/i,
  ],
};

/* 백틱 식별자는 MySQL 의 가장 흔한 표식이지만 한두 개는 우연일 수 있어 개수로 센다. */
function backtickScore(text) {
  return (text.match(/`[A-Za-z_]\w*`/g) || []).length >= 3 ? 1 : 0;
}

export function sqlDialectScores(text) {
  const sample = String(text || "").slice(0, 300000);
  const scores = {};
  for (const [dialect, patterns] of Object.entries(SIGNALS)) {
    scores[dialect] = patterns.reduce((sum, pattern) => sum + (pattern.test(sample) ? 1 : 0), 0);
  }
  scores.mysql += backtickScore(sample);
  return scores;
}

/**
 * @param {string} text  파일 본문(주석을 지운 것이어도 된다)
 * @param {string} rel   저장소 상대경로 — 확장자만 본다
 * @returns {"oracle"|"mssql"|"mysql"|"postgresql"|"generic"}
 */
export function detectSqlDialect(text, rel = "") {
  const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  if (ORACLE_EXTENSIONS.has(ext)) return "oracle";
  const scores = sqlDialectScores(text);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  /* 표식이 2개 미만이거나 2위와 격차가 1 이하면 가리지 않는다 — 잘못 가르는 것보다 기존 경로가 낫다. */
  if (bestScore < 2 || bestScore - second < 2) return "generic";
  return best;
}

/* MySQL 덤프(mysqldump)는 루틴·트리거를 `/*!50003 CREATE*\/ ... *\/` 버전 조건부 주석으로 감싼다 — 주석으로 지우면 통째로 사라진다. */
export function unwrapMysqlConditionalComments(text) {
  /* 길이를 그대로 유지한다 — 줄 번호·오프셋이 원본과 어긋나면 안 된다. */
  return String(text).replace(/\/\*!\d{0,5}([\s\S]*?)\*\//g, (whole, inner) => " ".repeat(whole.length - inner.length - 2) + inner + "  ");
}
