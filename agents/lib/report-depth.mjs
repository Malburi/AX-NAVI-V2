#!/usr/bin/env node
/*
 * 분석 리포트 깊이 게이트 (결정론적, LLM 없음).
 *
 * 왜 필요한가: analyzer 가 인덱스 요약만 옮기고 "미수행"·"확인 범위 밖"으로 절을 비워도 harness-evaluator 는 PASS 를 줬다.
 * evaluator 는 인용한 경로가 존재하는지·트리거가 충분한지(정확성·형식)를 보지, 절이 얼마나 비었는지는 보지 않기 때문이다
 * (실측 2026-11-05: 파일 2,737개짜리 시스템의 리포트가 6KB, 업무 규칙 절이 한 줄이었는데 84점 PASS).
 * 이 스크립트가 "얼마나 읽고 썼나"를 숫자로 재서, 얕으면 FAIL 로 알리고 심층 분석(deep) 패스를 처방한다.
 *
 * 입력: `_workspace/01_analyzer_report.md` + `_workspace/deep/*.md`(심층 패스 산출물, 있으면)
 * 출력: `_workspace/report_depth.json` (--out 으로 바꿈) · exit 0 = PASS/WARN, exit 1 = FAIL
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

/** 규모에 따른 하한. 작은 프로젝트에 큰 분량을 요구하지 않고, 큰 프로젝트가 몇 줄로 끝나지 못하게 한다. */
export function thresholds(sourceFileCount, tier) {
  const files = Math.max(0, Number(sourceFileCount) || 0);
  const full = tier !== "Standard";
  const scale = full ? 1 : 0.5;
  return {
    narrative_bytes: Math.round(Math.min(60000, Math.max(10000, files * 6)) * scale),
    citations: Math.round(Math.min(120, Math.max(20, files / 60)) * scale),
  };
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function measureDepth({ root, tier = "Full" }) {
  const reportPath = join(root, "_workspace", "01_analyzer_report.md");
  const raw = readText(reportPath);
  const meta = (() => { try { return JSON.parse(readText(join(root, "_workspace", "index", "_meta.json")) || "{}"); } catch { return {}; } })();
  const sourceFiles = meta.source_file_count ?? 0;
  const limit = thresholds(sourceFiles, tier);

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

  const findings = [];
  const check = (id, ok, detail, level = "FAIL") => findings.push({ id, status: ok ? "PASS" : level, detail });
  const strict = tier !== "Standard";
  check("narrative_bytes", narrativeBytes >= limit.narrative_bytes, `서술 ${narrativeBytes}B (하한 ${limit.narrative_bytes}B, 소스 ${sourceFiles}파일${deepFiles.length ? `, 심층 ${deepFiles.length}개 ${deepBytes}B 포함` : ""})`, strict ? "FAIL" : "WARN");
  check("citations", citations >= limit.citations, `파일:줄 근거 ${citations}건 (하한 ${limit.citations})`, strict ? "FAIL" : "WARN");
  check("required_sections", stubSections.length === 0, stubSections.length ? `비어 있는 필수 절: ${stubSections.join(", ")}` : "필수 절 모두 서술 있음", strict ? "FAIL" : "WARN");
  check("stub_phrases", stubHits <= 3 || deepBytes >= limit.narrative_bytes, `'미수행·확인 범위 밖' 류 표현 ${stubHits}회`, "WARN");

  const failed = findings.some((item) => item.status === "FAIL");
  const warned = findings.some((item) => item.status === "WARN");
  return {
    version: 1,
    tier,
    verdict: failed ? "FAIL" : warned ? "WARN" : "PASS",
    metrics: {
      source_files: sourceFiles, report_bytes: bytes(raw), narrative_bytes: narrativeBytes, deep_files: deepFiles.length, deep_bytes: deepBytes,
      citations, stub_phrase_hits: stubHits, stub_sections: stubSections,
    },
    limits: limit,
    sections: sectionReport,
    findings,
    /* FAIL 일 때의 처방: 오케스트레이터가 analyzer(mode: deep)를 영역별로 병렬 실행한다(area-split.mjs 로 분할). */
    remedy: failed ? { action: "deep_pass", instruction: "area-split.mjs 로 영역을 나누고 영역마다 analyzer(mode: deep)를 실행한 뒤 merge-deep.mjs 로 리포트에 합친다." } : null,
  };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), tier: "Full", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = resolve(argv[++i]);
    else if (argv[i] === "--tier") out.tier = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(join(args.root, "_workspace", "01_analyzer_report.md"))) {
    process.stderr.write("01_analyzer_report.md 가 없어 깊이를 측정할 수 없다\n");
    process.exit(2);
  }
  const result = measureDepth({ root: args.root, tier: args.tier });
  const outPath = args.out ? (args.out.match(/^([A-Za-z]:|\/)/) ? args.out : join(args.root, args.out)) : join(args.root, "_workspace", "report_depth.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ verdict: result.verdict, metrics: result.metrics, failed: result.findings.filter((item) => item.status !== "PASS") }, null, 2)}\n`);
  process.exit(result.verdict === "FAIL" ? 1 : 0);
}
