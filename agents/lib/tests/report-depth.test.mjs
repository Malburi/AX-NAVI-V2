import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isStubSection, measureDepth, splitSections } from "../report-depth.mjs";
import { mergeDeep } from "../merge-deep.mjs";
import { splitAreas } from "../area-split.mjs";

const LIB = dirname(dirname(fileURLToPath(import.meta.url)));

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/* 실측(2026-11-05, 파일 2,737개 시스템)의 얕은 리포트를 줄인 모양: 필수 절이 한두 줄이거나 "미수행"이고 파일:줄 근거가 없다. */
const SHALLOW_REPORT = `=== HARNESS ANALYSIS REPORT ===

## 업무 개요
LMS 백엔드. Struts1 기반 레거시 웹앱.

## 업무별 흐름
요청: *.do -> actconf -> Service -> DataAccesser -> JSP.

## 업무 규칙
인덱스 기반 확인 범위 밖. 판정 로직은 프로시저에 있어 미확인.

## B. 비동기/스케줄/이벤트
이번 실행에서 상세 탐지는 수행하지 않음.

## B. 인증/인가 경로
roles 속성 기반 역할 검사.

<!-- INDEX_SUMMARY_BEGIN -->
## B. 의존성 그래프 요약
${"- 허브 메서드 DataAccesser.query (in-degree 2057)\n".repeat(400)}
<!-- INDEX_SUMMARY_END -->

=== END REPORT ===
`;

const DEEP_AREA = `# 과정·수강 심층 분석

## 1. 영역 범위
${"서비스 12개, SQL 340건. WEB-INF/src/java/eduport/lms/front/course/service/FrontCourseApplyService.java:379 가 신청을 저장한다.\n".repeat(30)}
## 2. 핵심 업무 흐름
${"신청: front/course/apply/cosApplyInfoHandle.jsp:133 → FrontCourseApplyService.java:739 → query-lms-front-course-ora.xml:429\n".repeat(60)}
## 3. 업무 규칙
${"| 정원 초과 | CHK3 이면 신청 차단 | ApplyApproveService.java:3340 | HIGH |\n".repeat(30)}
## 8. 확인하지 못한 것
- 신청 판정 프로시저 내부는 이 저장소에서 확인 불가.
`;

function setup(report = SHALLOW_REPORT, files = 2000) {
  const root = mkdtempSync(join(tmpdir(), "ax-depth-"));
  write(root, "_workspace/01_analyzer_report.md", report);
  write(root, "_workspace/index/_meta.json", JSON.stringify({ source_file_count: files }));
  return root;
}

export async function test(register, assert) {
  register("깊이 게이트: 서술이 빈약한 리포트(빈 절·미수행·근거 0건)는 FAIL이고 심층 분석을 처방한다", () => {
    const root = setup();
    try {
      const result = measureDepth({ root, tier: "Full" });
      assert.equal(result.verdict, "FAIL", JSON.stringify(result.findings));
      assert.equal(result.metrics.citations, 0);
      for (const name of ["업무 개요", "업무별 흐름", "업무 규칙", "비동기/스케줄/이벤트", "인증/인가 경로"]) {
        assert.ok(result.metrics.stub_sections.includes(name), `${name} 이 비어 있다고 판정돼야 한다: ${result.metrics.stub_sections}`);
      }
      assert.ok(result.findings.some((item) => item.id === "narrative_bytes" && item.status === "FAIL"));
      assert.ok(result.findings.some((item) => item.id === "citations" && item.status === "FAIL"));
      assert.equal(result.remedy?.action, "deep_pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("깊이 게이트: 기계가 만든 인덱스 요약 블록은 서술 분량으로 세지 않는다", () => {
    const root = setup();
    try {
      const result = measureDepth({ root, tier: "Full" });
      /* 요약 블록만 해도 20KB 가 넘지만 서술은 몇백 바이트다 */
      assert.ok(result.metrics.report_bytes > 15000, `리포트 전체는 크다: ${result.metrics.report_bytes}`);
      assert.ok(result.metrics.narrative_bytes < 1500, `서술은 작다: ${result.metrics.narrative_bytes}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("깊이 게이트: 규모에 맞는 하한 — 작은 프로젝트는 낮고 큰 프로젝트는 높으며 Standard 는 절반이고 WARN만 낸다", () => {
    const small = setup(SHALLOW_REPORT, 100);
    const big = setup(SHALLOW_REPORT, 5000);
    try {
      assert.equal(measureDepth({ root: small, tier: "Full" }).limits.narrative_bytes, 10000, "하한 바닥");
      assert.equal(measureDepth({ root: big, tier: "Full" }).limits.narrative_bytes, 30000);
      assert.equal(measureDepth({ root: big, tier: "Standard" }).limits.narrative_bytes, 15000);
      assert.equal(measureDepth({ root: big, tier: "Standard" }).verdict, "WARN", "Standard 는 막지 않고 알린다");
    } finally {
      rmSync(small, { recursive: true, force: true });
      rmSync(big, { recursive: true, force: true });
    }
  });

  register("깊이 게이트: 절 판정 — 짧은 일반 문장과 '미수행' 류 표현은 비어 있는 것이고, 근거가 있는 충분한 서술은 채운 것이다", () => {
    assert.equal(isStubSection("요청: *.do -> Service -> JSP."), true, "표현이 없어도 짧으면 서술이 아니다");
    assert.equal(isStubSection("이번 실행에서 상세 탐지는 수행하지 않음. ".repeat(3)), true);
    const full = "신청은 FrontCourseApplyService.java:379 가 저장하고 정원 초과는 프로시저가 판정한다. ".repeat(8);
    assert.equal(isStubSection(full), false);
    assert.equal(splitSections("## A\n본문1\n## B\n본문2\n").length, 2);
  });

  register("심층 병합: deep 파일을 합치면 게이트가 PASS 로 바뀌고 비어 있던 절은 포인터로 대체되며 두 번 돌려도 같다", () => {
    const root = setup();
    try {
      for (const name of ["01_course.md", "02_member.md", "03_study.md"]) write(root, `_workspace/deep/${name}`, DEEP_AREA);
      const first = mergeDeep({ root });
      assert.equal(first.merged_files, 3);
      assert.ok(first.replaced_stub_sections.includes("업무 규칙"), JSON.stringify(first));
      const afterFirst = readFileSync(join(root, "_workspace", "01_analyzer_report.md"), "utf8");
      assert.ok(afterFirst.includes("<!-- DEEP_BEGIN -->") && afterFirst.includes("<!-- DEEP_END -->"));
      assert.ok(afterFirst.includes("<!-- INDEX_SUMMARY_BEGIN -->"), "기계 요약 블록은 그대로 남는다");
      assert.ok(afterFirst.includes("신청 판정 프로시저 내부는 이 저장소에서 확인 불가"), "'확인하지 못한 것'은 잘려 나가지 않는다");

      const depth = measureDepth({ root, tier: "Full" });
      assert.equal(depth.verdict, "PASS", JSON.stringify(depth.findings));

      mergeDeep({ root });
      const afterSecond = readFileSync(join(root, "_workspace", "01_analyzer_report.md"), "utf8");
      assert.equal(afterSecond, afterFirst, "다시 돌려도 블록이 중복되지 않는다");
      assert.equal(afterSecond.match(/<!-- DEEP_BEGIN -->/g).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("심층 병합: 영역당 발췌 크기를 제한해 리포트가 부풀지 않는다", () => {
    const root = setup();
    try {
      write(root, "_workspace/deep/01_big.md", DEEP_AREA.repeat(8));
      const result = mergeDeep({ root, maxBytes: 3000 });
      assert.ok(result.block_bytes < 6000, `발췌는 제한된다: ${result.block_bytes}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  register("영역 분할: 자바 패키지 루트를 떼고 쿼리 파일명 토큰을 업무 경로로 써서 같은 업무를 한 영역으로 모은다", () => {
    const files = [];
    for (let i = 0; i < 6; i += 1) {
      files.push({ path: `WEB-INF/src/java/eduport/lms/back/education/apply/service/Svc${i}.java`, weight: 5 });
      files.push({ path: `WEB-INF/src/java/eduport/lms/front/course/service/Front${i}.java`, weight: 5 });
      files.push({ path: `WEB-INF/src/java/eduport/lms/study/study/service/Study${i}.java`, weight: 5 });
    }
    files.push({ path: "WEB-INF/config/query/query-lms-back-education-apply-ora.xml", weight: 40 });
    files.push({ path: "WEB-INF/config/query/query-lms-front-course-ora.xml", weight: 40 });
    files.push({ path: "WEB-INF/config/query/query-lms-study-study-ora.xml", weight: 40 });
    const result = splitAreas(files, { max: 5 });
    assert.ok(result.areas.length <= 5 && result.areas.length >= 3, JSON.stringify(result.areas.map((a) => a.name)));
    const apply = result.areas.find((area) => area.name.includes("education") || (area.includes || []).some((name) => name.includes("education")));
    assert.ok(apply, JSON.stringify(result.areas.map((a) => [a.name, a.includes])));
    assert.ok(apply.sample_files.some((path) => path.endsWith("query-lms-back-education-apply-ora.xml")) || apply.weight >= 70, "쿼리 XML 이 같은 업무 영역에 든다");
    assert.equal(result.areas.reduce((sum, area) => sum + area.weight, 0), result.total_weight, "가중치가 보존된다");
    assert.equal(result.areas.reduce((sum, area) => sum + area.files, 0), result.total_files, "파일이 빠지지 않는다");
  });

  register("영역 분할: 상한을 넘지 않고, 한 영역이 전체를 삼키지 않으며, 파일이 적으면 쪼개지 않는다", () => {
    const many = [];
    for (let area = 0; area < 12; area += 1) for (let i = 0; i < 10; i += 1) many.push({ path: `src/main/java/com/acme/mod${area}/sub${i % 3}/C${i}.java`, weight: 3 });
    const result = splitAreas(many, { max: 6 });
    assert.ok(result.areas.length <= 6, `상한: ${result.areas.length}`);
    assert.ok(Math.max(...result.areas.map((area) => area.share)) < 0.5, `한 영역이 절반을 넘지 않는다: ${JSON.stringify(result.areas.map((a) => a.share))}`);
    assert.equal(result.areas.reduce((sum, area) => sum + area.files, 0), 120);
    const tiny = splitAreas([{ path: "src/A.java" }, { path: "src/B.java" }], { max: 6 });
    assert.equal(tiny.areas.length, 1);
    assert.equal(splitAreas([]).areas.length, 0);
  });

  register("CLI: report-depth 는 얕으면 exit 1, 심층 병합 뒤에는 exit 0 이고 report_depth.json 을 남긴다", () => {
    const root = setup();
    try {
      const run = () => spawnSync(process.execPath, [join(LIB, "report-depth.mjs"), "--root", root, "--tier", "Full"], { encoding: "utf8" });
      assert.equal(run().status, 1);
      assert.ok(existsSync(join(root, "_workspace", "report_depth.json")));
      for (const name of ["01_a.md", "02_b.md", "03_c.md"]) write(root, `_workspace/deep/${name}`, DEEP_AREA);
      const merged = spawnSync(process.execPath, [join(LIB, "merge-deep.mjs"), "--root", root], { encoding: "utf8" });
      assert.equal(merged.status, 0, merged.stderr);
      assert.equal(run().status, 0);
      assert.equal(JSON.parse(readFileSync(join(root, "_workspace", "report_depth.json"), "utf8")).verdict, "PASS");
      const missing = spawnSync(process.execPath, [join(LIB, "report-depth.mjs"), "--root", join(root, "nope")], { encoding: "utf8" });
      assert.equal(missing.status, 2, "리포트가 없으면 측정할 수 없다(exit 2)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
