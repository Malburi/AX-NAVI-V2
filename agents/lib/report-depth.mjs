#!/usr/bin/env node
/*
 * 분석 리포트 깊이 게이트 (결정론적, LLM 없음).
 *
 * 왜 필요한가: analyzer 가 인덱스 요약만 옮기고 "미수행"·"확인 범위 밖"으로 절을 비워도 harness-evaluator 는 PASS 를 줬다.
 * evaluator 는 인용한 경로가 존재하는지·트리거가 충분한지(정확성·형식)를 보지, 절이 얼마나 비었는지는 보지 않기 때문이다
 * (실측 2026-11-05: 파일 2,737개짜리 시스템의 리포트가 6KB, 업무 규칙 절이 한 줄이었는데 84점 PASS).
 * 이 스크립트가 "얼마나 읽고 썼나"를 숫자로 재서, 얕으면 FAIL 로 알리고 심층 분석(deep) 패스를 처방한다.
 *
 * 무엇으로 막는가 — **규모와 무관한 신호만 막고, 규모에 비례하는 신호는 알리기만 한다**:
 *   막는다(FAIL):  필수 절이 둘 이상 비어 있다 / `파일:줄` 근거가 하한의 25% 에도 못 미친다
 *   알린다(WARN):  서술 분량이 하한 미만 / 필수 절 하나가 비었다 / "미수행" 류 표현이 많다
 * 서술 분량 하한은 프로젝트 둘의 실측으로 정한 경험값이라 1차 신호로 쓰면 작은 프로젝트의 정상적인 짧은 리포트를 막는다.
 * 작은 프로젝트도 똑같이 막는다 — 분석은 규모와 무관하게 있어야 하고, 작은 시스템의 심층 패스는 영역 1개·30만 토큰 이하라
 * 확인 없이 자동 진행되므로 비용이 막을 이유가 못 된다(처방 크기는 규모를 따라 줄어든다). FAIL 을 낮추는 건 옵트인(`small_project_files`)이다.
 *
 * 설정: `_workspace/indexer-config.json` 의 `depth_gate`
 *   { "enabled": false }                    게이트를 끈다(verdict SKIPPED)
 *   { "narrative_bytes": N, "citations": N } 하한을 직접 지정
 *   { "small_project_files": N }            옵트인: 소스가 N 파일 미만이면 FAIL 을 WARN 으로 낮춤(기본 0 = 낮추지 않음)
 *   { "min_stub_sections": N }              비어 있는 필수 절이 N 개 이상이면 FAIL(기본 2)
 *   { "auto_proceed_tokens": N }            심층 패스 견적이 이 이하면 확인 없이 진행(기본 300000)
 *
 * 입력: `_workspace/01_analyzer_report.md` + `_workspace/deep/*.md`(심층 패스 산출물, 있으면)
 * 출력: `_workspace/report_depth.json` (--out 으로 바꿈) · exit 0 = PASS/WARN/SKIPPED, exit 1 = FAIL
 * `--declined`: 사용자가 심층 패스를 거절했음을 기록한다(처방을 비우고 평가가 상한 대신 감점만 하게 한다).
 *
 * 기계가 만든 인덱스 요약 블록(`<!-- INDEX_SUMMARY_BEGIN -->` ~ `END`)은 LLM 이 쓴 서술이 아니므로 세지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/* 비어 있음을 드러내는 표현. 이 문구가 절의 본문을 차지하면 그 절은 채워지지 않은 것이다. */
export const STUB_PATTERN = /미수행|수행하지\s*않(?:음|았)|확인\s*범위\s*밖|미작성|미확인으로\s*남|추후\s*(?:확인|작성)|TODO|해당\s*없음|\[DEEP_PASS_PENDING\]|인덱스\s*기반\s*확인/;
/* 근거 인용: `경로/파일.확장자:줄` */
export const CITATION_PATTERN = /[\w./\\@()-]+\.(?:java|xml|jsp|jspf|js|ts|tsx|jsx|vue|py|cs|sql|properties|yml|yaml|json|html|htm|kt|go|prc|pkb|pks|fnc|trg):\d+/g;

/* 리포트에서 반드시 서술이 있어야 하는 절(Full). 제목에 이 문자열이 들어 있는 H2 를 찾는다. */
export const REQUIRED_SECTIONS = ["업무 개요", "업무별 흐름", "업무 규칙", "비동기/스케줄/이벤트", "인증/인가 경로"];

const MACHINE_BLOCK = /<!--\s*INDEX_SUMMARY_BEGIN\s*-->[\s\S]*?<!--\s*INDEX_SUMMARY_END\s*-->/g;
const DEEP_BLOCK = /<!--\s*DEEP_BEGIN\s*-->[\s\S]*?<!--\s*DEEP_END\s*-->/g;

const DEFAULTS = { small_project_files: 0, min_stub_sections: 2, auto_proceed_tokens: 300000 };
/* 영역 하나를 깊이 읽는 데 든 토큰. 실측(2026-11-05 eduLms, 7개 영역 병렬): 187K~326K, 평균 약 266K. 견적용 상수다. */
export const TOKENS_PER_AREA = 250000;

const bytes = (text) => Buffer.byteLength(text, "utf8");

/** H2 단위로 자른다. 반환: [{ title, body }] */
export function splitSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) { current = { title: heading[1], body: "" }; sections.push(current); continue; }
    if (current) current.body += `${line}\n`;
  }
  return sections;
}

/** 절 본문이 "채워지지 않은 것"인가: 짧거나, 비었음을 말하는 표현이 짧은 본문을 차지한다. */
export function isStubSection(body, minChars = 500, floor = 300) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  /* 표현이 없어도 몇 줄짜리 일반 문장은 서술이 아니다 — 필수 절은 최소 분량(floor)을 넘어야 채운 것으로 본다. */
  if (text.length < floor) return true;
  return STUB_PATTERN.test(text) && text.length < minChars;
}

/**
 * 규모에 따른 하한. 작은 프로젝트에 큰 분량을 요구하지 않고, 큰 프로젝트가 몇 줄로 끝나지 못하게 한다.
 * 서술 바이트는 1차 신호가 아니다(WARN 만) — 바닥을 낮게(3KB) 둬 작은 프로젝트의 정상 리포트가 걸리지 않게 한다.
 */
export function thresholds(sourceFileCount, tier, overrides = {}) {
  const files = Math.max(0, Number(sourceFileCount) || 0);
  const scale = tier === "Standard" ? 0.5 : 1;
  return {
    narrative_bytes: overrides.narrative_bytes ?? Math.round(Math.min(60000, Math.max(3000, files * 6)) * scale),
    citations: overrides.citations ?? Math.round(Math.min(120, Math.max(8, files / 60)) * scale),
  };
}

/** 심층 패스의 영역 수: 파일 400개당 하나, 1~7. 작은 프로젝트에 영역 7개를 권하지 않는다. */
export function recommendedAreaCount(sourceFileCount) {
  return Math.min(7, Math.max(1, Math.round((Number(sourceFileCount) || 0) / 400)));
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readText(path) || "null") ?? fallback; } catch { return fallback; }
}

/** `_workspace/indexer-config.json` 의 depth_gate. 알 수 없는 값은 무시한다. */
export function loadGateConfig(root) {
  const raw = readJson(join(root, "_workspace", "indexer-config.json")).depth_gate;
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const num = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined);
  return {
    ...DEFAULTS,
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...Object.fromEntries(["narrative_bytes", "citations", "small_project_files", "min_stub_sections", "auto_proceed_tokens"]
      .map((key) => [key, num(raw[key])]).filter(([, value]) => value !== undefined)),
  };
}

export function measureDepth({ root, tier = "Full", declined = false }) {
  const config = loadGateConfig(root);
  const reportPath = join(root, "_workspace", "01_analyzer_report.md");
  const raw = readText(reportPath);
  const meta = readJson(join(root, "_workspace", "index", "_meta.json"));
  const sourceFiles = meta.source_file_count ?? 0;

  if (config.enabled === false) {
    return { version: 2, tier, verdict: "SKIPPED", reason: "indexer-config.json 의 depth_gate.enabled 가 false", metrics: { source_files: sourceFiles }, limits: null, sections: [], findings: [], remedy: null, declined: false, config };
  }

  const limit = thresholds(sourceFiles, tier, config);
  /* 서술만: 기계 요약 블록을 빼고, 심층 병합 블록(DEEP)은 서술로 센다. */
  const narrative = raw.replace(MACHINE_BLOCK, "");
  const deepDir = join(root, "_workspace", "deep");
  const deepFiles = existsSync(deepDir) ? readdirSync(deepDir).filter((name) => name.endsWith(".md")).sort() : [];
  const deepTexts = deepFiles.map((name) => ({ name, text: readText(join(deepDir, name)) }));
  const deepBytes = deepTexts.reduce((sum, item) => sum + bytes(item.text), 0);
  const deepCitations = deepTexts.reduce((sum, item) => sum + (item.text.match(CITATION_PATTERN) || []).length, 0);

  const sections = splitSections(narrative);
  const strictFloor = tier === "Standard" ? 150 : 300;
  const stubSections = [];
  const sectionReport = REQUIRED_SECTIONS.map((name) => {
    const found = sections.find((item) => item.title.includes(name));
    const stub = !found || isStubSection(found.body, 500, strictFloor);
    /* 심층 병합 블록이 이 절을 대신 가리키면(포인터) 채운 것으로 본다. */
    const pointed = Boolean(found && /심층\s*분석|_workspace\/deep\//.test(found.body));
    if (stub && !pointed) stubSections.push(name);
    return { section: name, present: Boolean(found), chars: found ? found.body.replace(/\s+/g, " ").trim().length : 0, stub: stub && !pointed, pointed };
  });

  const reportNarrativeBytes = bytes(narrative.replace(DEEP_BLOCK, ""));
  const narrativeBytes = reportNarrativeBytes + deepBytes;
  const citations = (narrative.match(CITATION_PATTERN) || []).length + deepCitations;
  const stubHits = (narrative.match(new RegExp(STUB_PATTERN.source, "g")) || []).length;

  const strict = tier !== "Standard";
  const small = sourceFiles < config.small_project_files;
  const findings = [];
  const check = (id, status, detail) => findings.push({ id, status, detail });
  /* 막는 신호: 규모와 무관하다 */
  const stubStatus = stubSections.length === 0 ? "PASS" : stubSections.length >= config.min_stub_sections ? "FAIL" : "WARN";
  check("required_sections", strict ? stubStatus : (stubSections.length ? "WARN" : "PASS"), stubSections.length ? `비어 있는 필수 절 ${stubSections.length}개: ${stubSections.join(", ")}` : "필수 절 모두 서술 있음");
  const citeStatus = citations >= limit.citations ? "PASS" : citations < limit.citations * 0.25 ? "FAIL" : "WARN";
  check("citations", strict ? citeStatus : (citeStatus === "PASS" ? "PASS" : "WARN"), `파일:줄 근거 ${citations}건 (하한 ${limit.citations}, 이 값의 25% 미만이면 막는다)`);
  /* 알리는 신호: 규모에 비례하는 경험값이라 막지 않는다 */
  check("narrative_bytes", narrativeBytes >= limit.narrative_bytes ? "PASS" : "WARN", `서술 ${narrativeBytes}B (하한 ${limit.narrative_bytes}B, 소스 ${sourceFiles}파일${deepFiles.length ? `, 심층 ${deepFiles.length}개 ${deepBytes}B 포함` : ""})`);
  check("stub_phrases", stubHits <= 3 || deepBytes >= limit.narrative_bytes ? "PASS" : "WARN", `'미수행·확인 범위 밖' 류 표현 ${stubHits}회`);

  /* 옵트인(small_project_files > 0): 그 값 미만이면 FAIL 을 WARN 으로 낮추되 낮췄다는 사실을 남긴다. 기본은 낮추지 않는다. */
  let downgraded = false;
  if (small) {
    for (const item of findings) if (item.status === "FAIL") { item.status = "WARN"; item.detail += " — 소규모 프로젝트라 막지 않음"; downgraded = true; }
  }
  const failed = findings.some((item) => item.status === "FAIL");
  const warned = findings.some((item) => item.status === "WARN");

  const areas = recommendedAreaCount(sourceFiles);
  const estimatedTokens = areas * TOKENS_PER_AREA;
  /* 처방: FAIL 일 때만. 사용자가 거절했으면 비운다(평가가 상한 대신 감점만 하고 Phase 4 가 같은 일을 또 시키지 않게). */
  const remedy = failed && !declined ? {
    action: "deep_pass",
    areas,
    estimated_tokens: estimatedTokens,
    /* 견적이 작으면 묻지 않고 알리고 진행한다 — 작은 프로젝트에서 매번 확인을 요구하지 않는다. */
    confirm_required: estimatedTokens > config.auto_proceed_tokens,
    instruction: `area-split.mjs --max ${areas} 로 영역을 나누고 영역마다 analyzer(mode: deep)를 실행한 뒤 merge-deep.mjs 로 리포트에 합친다.`,
  } : null;

  return {
    version: 2,
    tier,
    verdict: failed ? "FAIL" : warned ? "WARN" : "PASS",
    declined: Boolean(declined && failed),
    metrics: {
      source_files: sourceFiles, report_bytes: bytes(raw), narrative_bytes: narrativeBytes, deep_files: deepFiles.length, deep_bytes: deepBytes,
      citations, stub_phrase_hits: stubHits, stub_sections: stubSections,
    },
    limits: limit,
    small_project: small,
    downgraded_to_warn: downgraded,
    sections: sectionReport,
    findings,
    remedy,
  };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), tier: "Full", out: null, declined: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = resolve(argv[++i]);
    else if (argv[i] === "--tier") out.tier = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--declined") out.declined = true;
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(join(args.root, "_workspace", "01_analyzer_report.md"))) {
    process.stderr.write("01_analyzer_report.md 가 없어 깊이를 측정할 수 없다\n");
    process.exit(2);
  }
  const result = measureDepth({ root: args.root, tier: args.tier, declined: args.declined });
  const outPath = args.out ? (args.out.match(/^([A-Za-z]:|\/)/) ? args.out : join(args.root, args.out)) : join(args.root, "_workspace", "report_depth.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ verdict: result.verdict, declined: result.declined, metrics: result.metrics, remedy: result.remedy, failed: result.findings.filter((item) => item.status !== "PASS") }, null, 2)}\n`);
  process.exit(result.verdict === "FAIL" ? 1 : 0);
}
