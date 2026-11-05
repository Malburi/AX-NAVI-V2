#!/usr/bin/env node
/*
 * 심층 분석 결과를 분석 리포트에 합친다 (결정론적, LLM 없음).
 *
 * 영역별 심층 분석(analyzer mode: deep)은 `_workspace/deep/*.md`에 쓴다. 그런데 writer 와 domain-expert 는 `01_analyzer_report.md`
 * 만 읽으므로, 합치지 않으면 심층 분석이 하네스(CLAUDE.md·domain-expert)에 반영되지 않는다. 이 스크립트가
 *   1) 영역별 파일에서 발췌(영역당 --max-bytes)를 만들어 `<!-- DEEP_BEGIN --> ... <!-- DEEP_END -->` 블록으로 리포트에 넣고(다시 돌리면 교체),
 *   2) "미수행·확인 범위 밖"으로 비어 있던 필수 절은 그 자리에 심층 분석을 가리키는 포인터로 바꾼다.
 * 전문은 그대로 `_workspace/deep/`에 남는다 — 리포트는 domain-expert 에 주입되므로 길이를 제한한다.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REQUIRED_SECTIONS, isStubSection, splitSections } from "./report-depth.mjs";

const BEGIN = "<!-- DEEP_BEGIN -->";
const END = "<!-- DEEP_END -->";
const DEEP_RE = /<!--\s*DEEP_BEGIN\s*-->[\s\S]*?<!--\s*DEEP_END\s*-->\n?/;
const bytes = (text) => Buffer.byteLength(text, "utf8");

/* 마지막에 항상 남기는 절: 확인하지 못한 것은 잘려 나가면 안 된다. */
const KEEP_TAIL = /확인하지\s*못한|확인\s*불가|미확인/;

/** 영역 파일 하나에서 발췌를 만든다. 제목 레벨을 낮춰 리포트의 다른 절과 섞이지 않게 한다. */
export function excerpt(markdown, maxBytes) {
  const text = markdown.replace(/\r\n/g, "\n");
  const title = text.match(/^#\s+(.*\S)\s*$/m)?.[1] || "영역 분석";
  const sections = splitSections(text);
  const demote = (body) => body.replace(/^###\s+/gm, "##### ").replace(/^##\s+/gm, "#### ");
  const render = (section) => `#### ${section.title}\n${demote(section.body).trimEnd()}\n`;

  const tail = sections.find((section) => KEEP_TAIL.test(section.title));
  const tailText = tail ? render(tail).slice(0, 1500) : "";
  const budget = Math.max(0, maxBytes - bytes(tailText));
  let used = 0;
  const parts = [];
  for (const section of sections) {
    if (section === tail) continue;
    const rendered = render(section);
    if (used + bytes(rendered) > budget) {
      const room = budget - used;
      if (room > 600) parts.push(`${rendered.slice(0, Math.floor(room / 3))}\n…(이하 전문 참조)\n`);
      break;
    }
    parts.push(rendered);
    used += bytes(rendered);
  }
  if (tailText) parts.push(tailText);
  return { title, text: parts.join("\n") };
}

export function mergeDeep({ root, maxBytes = 6000 }) {
  const reportPath = join(root, "_workspace", "01_analyzer_report.md");
  const deepDir = join(root, "_workspace", "deep");
  if (!existsSync(reportPath)) throw new Error("01_analyzer_report.md 가 없다");
  const files = existsSync(deepDir) ? readdirSync(deepDir).filter((name) => name.endsWith(".md")).sort() : [];
  if (!files.length) throw new Error("_workspace/deep/*.md 가 없어 합칠 것이 없다");

  let report = readFileSync(reportPath, "utf8").replace(/\r\n/g, "\n");
  const blocks = files.map((name) => {
    const markdown = readFileSync(join(deepDir, name), "utf8");
    const { title, text } = excerpt(markdown, maxBytes);
    return `### ${title}\n> 전문: \`_workspace/deep/${name}\` (${bytes(markdown)}B)\n\n${text}`;
  });
  const block = [
    BEGIN,
    "## 심층 분석 (영역별)",
    "> 영역별 심층 분석 에이전트가 소스를 직접 열어 쓴 것이다(근거는 `파일:줄`). 아래는 발췌이며 전문은 `_workspace/deep/`에 있다.",
    "",
    blocks.join("\n\n"),
    END,
    "",
  ].join("\n");

  /* 1) 기존 블록 교체, 없으면 기계 요약 블록 앞(없으면 첫 "## A." 앞, 그것도 없으면 맨 끝)에 삽입 */
  if (DEEP_RE.test(report)) report = report.replace(DEEP_RE, block);
  else {
    const anchors = [report.indexOf("<!-- INDEX_SUMMARY_BEGIN -->"), report.search(/^## A\./m), report.indexOf("=== END REPORT ===")].filter((index) => index >= 0);
    const at = anchors.length ? Math.min(...anchors) : report.length;
    report = `${report.slice(0, at)}${block}\n${report.slice(at)}`;
  }

  /* 2) 비어 있던 필수 절은 포인터로 바꾼다 */
  const replaced = [];
  const pointer = "→ 영역별로 소스를 직접 읽어 정리했다. 아래 \"심층 분석 (영역별)\"과 `_workspace/deep/*.md`를 참조한다.";
  for (const name of REQUIRED_SECTIONS) {
    const section = splitSections(report.replace(DEEP_RE, "")).find((item) => item.title.includes(name));
    if (!section || !isStubSection(section.body)) continue;
    const heading = new RegExp(`(^## [^\\n]*${name.replace(/[/.]/g, "\\$&")}[^\\n]*\\n)([\\s\\S]*?)(?=^## |<!-- DEEP_BEGIN -->|<!-- INDEX_SUMMARY_BEGIN -->|$(?![\\s\\S]))`, "m");
    if (heading.test(report)) { report = report.replace(heading, `$1${pointer}\n\n`); replaced.push(name); }
  }
  writeFileSync(reportPath, report, "utf8");
  return { merged_files: files.length, block_bytes: bytes(block), replaced_stub_sections: replaced, report_bytes: bytes(report) };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), maxBytes: 6000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = resolve(argv[++i]);
    else if (argv[i] === "--max-bytes") out.maxBytes = Number(argv[++i]) || 6000;
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  try {
    process.stdout.write(`${JSON.stringify(mergeDeep(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}
