#!/usr/bin/env node
/*
 * 심층 분석 영역 분할 (결정론적, LLM 없음).
 *
 * 깊이 게이트(report-depth.mjs)가 FAIL 이면 analyzer(mode: deep)를 **영역마다** 병렬로 실행한다. 한 에이전트가 2,700개 파일을
 * 혼자 읽을 수 없고 읽다 보면 얕아지기 때문이다. 이 스크립트가 인덱스의 파일 분포로 영역 후보를 나눠 준다.
 *
 * 방법: 소스 파일 경로에서 계층 이름(src·java·service·jsp·config 등)을 걷어 낸 "업무 경로"로 트리를 만들고, 가장 무거운 그룹부터
 * 다음 경로 구간으로 쪼갠다. 쿼리 XML·Struts 설정은 경로가 아니라 파일명이 업무 경로다(`query-lms-back-education-ora.xml`).
 * 상한(--max)을 넘는 작은 그룹은 경로가 가장 많이 겹치는 영역에 붙이고, 겹치는 곳이 없으면 가장 가벼운 영역에 붙인다.
 * 같은 업무가 자바·JSP·쿼리 트리에 흩어져 있으면 경로가 다른 영역으로 갈릴 수 있다 — 이 결과는 출발점이고,
 * 오케스트레이터가 업무 이름으로 합치거나 나눠도 된다.
 *
 * 입력: `_workspace/index/{symbols,sql_usage,api_contract}.json` · 출력: stdout JSON (--out 이 있으면 파일에도)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { recommendedAreaCount } from "./report-depth.mjs";

/* 업무가 아니라 계층·관례를 뜻하는 경로 구간. 대소문자 무시. */
const LAYER_WORDS = new Set([
  "src", "main", "java", "kotlin", "resources", "webapp", "web-inf", "webcontent", "jsp", "jspf", "config", "actconf", "appconf", "query",
  "service", "services", "action", "actions", "dao", "mapper", "mappers", "model", "models", "vo", "dto", "entity", "controller", "controllers",
  "script", "scripts", "js", "css", "html", "static", "public", "assets", "images", "img", "common", "util", "utils", "lib", "libs", "classes",
]);

/* 쿼리 XML·Struts 설정은 경로에 업무 정보가 없고 파일명에 있다: `query-lms-back-education-completion-ora.xml` → [lms, back, education, completion]. */
const CONFIG_NAME = /^(?:query|struts|application|spring|sqlmap)-(.+?)(?:-(?:ora|oracle|mysql|mssql|pg|postgres|sql|xml))?\.xml$/i;
const CONFIG_DIR = /^(?:query|queries|actconf|appconf|sqlmap|sqlmaps)$/i;

export const normalizeKey = (path) => {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  const name = parts.at(-1) || "";
  const dirs = parts.slice(0, -1);
  const tokens = dirs.some((dir) => CONFIG_DIR.test(dir)) ? (name.match(CONFIG_NAME)?.[1] || "").split("-").filter(Boolean) : [];
  if (tokens.length) return tokens;
  return dirs.filter((segment) => !LAYER_WORDS.has(segment.toLowerCase()));
};

/* 파일 종류별 가족: 같은 가족끼리만 "패키지 루트"를 공유한다. */
const family = (path) => {
  const ext = String(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (["java", "kt", "kts", "cs", "py", "go"].includes(ext)) return "code";
  if (["jsp", "jspf", "html", "htm", "vue", "tsx", "jsx", "cshtml"].includes(ext)) return "view";
  if (ext === "xml") return "config";
  return "script";
};

const totalWeight = (files) => files.reduce((sum, file) => sum + file.weight, 0);
const commonLength = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n += 1; return n; };
/** 여러 키의 공통 접두 경로 */
const commonPrefix = (keys) => keys.reduce((acc, key) => (acc === null ? key : acc.slice(0, commonLength(acc, key))), null) || [];

/**
 * @param {{path: string, weight?: number}[]} input
 * @param {{max?: number}} options
 */
export function splitAreas(input, { max = 7 } = {}) {
  const files = input.filter((item) => item && item.path).map((item) => ({ path: item.path, weight: item.weight || 1, key: normalizeKey(item.path), family: family(item.path) }));
  const total = totalWeight(files);
  if (!files.length) return { areas: [], total_files: 0, total_weight: 0 };

  /*
   * 자바 패키지 루트(`eduport/…`)는 쿼리·JSP 경로에는 없어서, 같은 업무가 서로 다른 그룹으로 갈린다. 한 파일 가족의 키가 거의 전부
   * 같은 첫 구간으로 시작하고 그 구간이 **다른 가족의 키 어디에도 없으면** 그 구간은 패키지 루트이므로 뗀다(반복).
   */
  for (let round = 0; round < 4; round += 1) {
    let trimmed = false;
    for (const fam of new Set(files.map((file) => file.family))) {
      const mine = files.filter((file) => file.family === fam && file.key.length > 1);
      if (mine.length < 5) continue;
      const first = new Map();
      for (const file of mine) first.set(file.key[0], (first.get(file.key[0]) || 0) + 1);
      const [segment, count] = [...first.entries()].sort((a, b) => b[1] - a[1])[0];
      if (count / mine.length < 0.9) continue;
      if (files.some((file) => file.family !== fam && file.key.includes(segment))) continue;
      for (const file of mine) if (file.key[0] === segment) file.key = file.key.slice(1);
      trimmed = true;
    }
    if (!trimmed) break;
  }

  let groups = [{ prefix: [], files }];
  /*
   * 가장 무거운 그룹부터 다음 구간으로 쪼갠다. 상한(max)에 닿아도 "한 영역이 전체의 1/max 를 크게 넘는" 동안은 계속 쪼갠다 —
   * 그래야 가장 큰 그룹이 통째로 한 영역으로 남지 않는다. 쪼개며 생긴 초과분은 아래에서 합친다.
   */
  const oversize = (group) => totalWeight(group.files) > (total / max) * 1.5;
  for (let guard = 0; guard < 300; guard += 1) {
    if (groups.length >= max && !groups.some(oversize)) break;
    const candidates = groups.filter((group) => groups.length < max || oversize(group)).sort((a, b) => totalWeight(b.files) - totalWeight(a.files));
    let split = null;
    for (const group of candidates) {
      let prefix = group.prefix;
      /* 모든 파일이 같은 구간을 공유하면 그룹 수를 늘리지 않고 한 칸 내려간다. */
      for (let depth = 0; depth < 50; depth += 1) {
        const next = new Map();
        const direct = [];
        for (const file of group.files) {
          if (file.key.length <= prefix.length) { direct.push(file); continue; }
          const segment = file.key[prefix.length];
          if (!next.has(segment)) next.set(segment, []);
          next.get(segment).push(file);
        }
        if (next.size === 0) break;
        if (next.size === 1 && direct.length === 0) { prefix = [...prefix, [...next.keys()][0]]; continue; }
        const children = [...next.entries()].map(([segment, list]) => ({ prefix: [...prefix, segment], files: list }));
        if (direct.length) children.push({ prefix, files: direct });
        split = { group, children };
        break;
      }
      if (split) break;
    }
    if (!split) break;
    groups = [...groups.filter((item) => item !== split.group), ...split.children];
  }

  /*
   * 상한을 넘는 그룹: 무거운 순으로 max 개를 영역으로 삼고, 나머지는 경로가 가장 많이 겹치는 영역에 붙인다.
   * 겹치는 구간이 없으면(서로 무관한 모듈들) 가장 가벼운 영역에 붙여 한 영역이 비대해지지 않게 한다.
   */
  groups.sort((a, b) => totalWeight(b.files) - totalWeight(a.files));
  const keep = groups.slice(0, max).map((group) => ({ ...group, includes: [] }));
  for (const group of groups.slice(max)) {
    let best = null;
    let bestScore = 0;
    for (const target of keep) {
      const score = commonLength(group.prefix, target.prefix);
      if (score > bestScore || (score === bestScore && score > 0 && totalWeight(target.files) < totalWeight(best.files))) { best = target; bestScore = score; }
    }
    const target = best && bestScore > 0 ? best : [...keep].sort((a, b) => totalWeight(a.files) - totalWeight(b.files))[0];
    target.files = [...target.files, ...group.files];
    target.includes.push({ name: group.prefix.join("/") || "(직속)", weight: totalWeight(group.files) });
  }

  const areas = keep
    .sort((a, b) => totalWeight(b.files) - totalWeight(a.files))
    .map((group, index) => {
      /* 이름은 영역에 든 모든 파일의 공통 업무 경로. 공통 경로가 없으면(서로 무관한 모듈이 합쳐짐) 대표 이름 + 개수로 적는다. */
      const shared = commonPrefix(group.files.map((file) => file.key));
      /* 공통 경로가 세 구간 이상이면 그대로. 짧으면(여러 모듈이 합쳐짐) 가장 무거운 모듈 이름 두세 개를 이어 붙여 서로 구분되게 한다. */
      const heavy = [{ name: group.prefix.join("/") || "(루트)", weight: totalWeight(group.files) - group.includes.reduce((sum, item) => sum + item.weight, 0) }, ...group.includes]
        .sort((a, b) => b.weight - a.weight);
      const leading = [...new Set(heavy.map((item) => item.name))];
      const name = shared.length >= 3 ? shared.join("/") : `${leading.slice(0, 3).join(" + ")}${leading.length > 3 ? ` 외 ${leading.length - 3}` : ""}`;
      return {
        id: `AREA-${index + 1}`,
        name,
        files: group.files.length,
        weight: totalWeight(group.files),
        share: Number((totalWeight(group.files) / total).toFixed(3)),
        ...(group.includes.length ? { includes: group.includes.sort((a, b) => b.weight - a.weight).slice(0, 15).map((item) => item.name) } : {}),
        sample_files: [...group.files].sort((a, b) => b.weight - a.weight).slice(0, 6).map((file) => file.path),
      };
    });
  return { areas, total_files: files.length, total_weight: total };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/** 인덱스에서 파일별 가중치(심볼·SQL·엔드포인트 수)를 모은다. */
export function filesFromIndex(root) {
  const dir = join(root, "_workspace", "index");
  const weights = new Map();
  const add = (file) => { if (file && typeof file === "string") weights.set(file, (weights.get(file) || 0) + 1); };
  for (const symbol of readJson(join(dir, "symbols.json"))?.symbols || []) add(symbol.file);
  for (const sql of readJson(join(dir, "sql_usage.json"))?.sqls || []) add(sql.file);
  for (const endpoint of readJson(join(dir, "api_contract.json"))?.endpoints || []) add(endpoint.file);
  return [...weights.entries()].map(([path, weight]) => ({ path, weight }));
}

function parseArgs(argv) {
  /* max: "auto"(기본) 면 소스 규모에 맞춰 정한다 — 작은 프로젝트에 영역 7개를 권하지 않는다. */
  const out = { root: process.cwd(), max: "auto", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = resolve(argv[++i]);
    else if (argv[i] === "--max") { const value = argv[++i]; out.max = value === "auto" ? "auto" : (Number(value) || 7); }
    else if (argv[i] === "--out") out.out = argv[++i];
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const args = parseArgs(process.argv.slice(2));
  const files = filesFromIndex(args.root);
  if (!files.length) {
    process.stderr.write("인덱스에 파일 정보가 없어 영역을 나눌 수 없다(_workspace/index/symbols.json 확인)\n");
    process.exit(2);
  }
  const sourceFiles = readJson(join(args.root, "_workspace", "index", "_meta.json"))?.source_file_count ?? files.length;
  const max = args.max === "auto" ? recommendedAreaCount(sourceFiles) : args.max;
  const result = { ...splitAreas(files, { max }), max_areas: max, max_basis: args.max === "auto" ? `소스 ${sourceFiles}파일 → 파일 400개당 영역 1개(1~7)` : "지정값" };
  /* 프레임워크 힌트: Struts 설정 파일은 업무 단위로 나뉘어 있는 경우가 많아 영역 이름을 붙일 때 참고가 된다. */
  const actconf = files.map((item) => item.path).filter((path) => /(?:^|\/)actconf\/[^/]+\.xml$/i.test(path.replace(/\\/g, "/")));
  const output = { ...result, hints: { struts_actconf: [...new Set(actconf)].sort() } };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    const outPath = args.out.match(/^([A-Za-z]:|\/)/) ? args.out : join(args.root, args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, "utf8");
  }
  process.stdout.write(text);
}
