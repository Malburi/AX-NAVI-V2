<div align="center">

# AX Navi — Claude Code 플러그인

**처음 투입된 레거시 프로젝트, 첫날부터 길을 잃지 않게.**

ITO/SI/SM 현장을 위한 Claude Code 플러그인 — 코드베이스 지도를 먼저 만들고, 그 지도를 근거로 찾고 · 따라가고 · 고칩니다.

[![version](https://img.shields.io/badge/version-0.3.13-0F7B85)](docs/changelog.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](#라이선스)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933)](#요구-사항)
[![platform](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-supported-555)](#설치)

[첫날 질문](#첫날-하는-질문-그대로-물어보세요) · [설치](#설치) · [사용법](#사용법) · [DB 덤프](#db-덤프까지-분석하기) · [지원 스택](#지원-스택) · [소개 페이지](https://malburi.github.io/AX-NAVI-V2/) · [문서](https://malburi.github.io/AX-NAVI-V2/site/)

</div>

```
  ╭─────────╮   ▄▀█ ▀▄▀   █▄░█ ▄▀█ █░█ █
  │ ◉ ─── ◉ │   █▀█ █░█   █░▀█ █▀█ ▀▄▀ █
  │   ▁▁▁   │
  ╰──┬───┬──╯   ITO/SI/SM 레거시 코드베이스를 위한 AI 개발 내비게이터
  ═══╧═══╧═══   Claude Code 플러그인 · 19 에이전트 · 24 스킬
```

Claude Code 안에서 설치해 씁니다. 별도 실행 프로그램은 없습니다. 터미널 전용 실행기가 필요하면 [AX-NAVI-CLI](https://github.com/Malburi/AX-NAVI-CLI)를 보세요 — 에이전트 · 스킬 · 인덱서는 두 저장소가 같은 원본을 씁니다.

## 첫날 하는 질문, 그대로 물어보세요

| 이럴 때 | Claude Code 에서 |
|---|---|
| 코드베이스 지도를 만든다(처음 한 번) | `하네스 초기화 해줘` 또는 `인덱스만 만들어줘` |
| 기능이 어디 구현돼 있는지 모르겠다 | `/ax-navi:find 결제 승인 기능 찾아줘` |
| 버튼 하나 누르면 뭐가 도는지 모르겠다 | `/ax-navi:flow 수강신청 저장 버튼 누르면 뭐가 실행돼?` |
| 이거 고치면 어디가 터질지 모르겠다 | `/ax-navi:impact 이 쿼리 첫 컬럼을 빼면?` |
| 컨벤션을 모르는데 고쳐야 한다 | `/ax-navi:modify 승인 시각을 함께 저장하게 해줘` |
| 기존 패턴 그대로 새 기능을 붙여야 한다 | `/ax-navi:scaffold 공지사항 첨부파일 기능 추가` |
| 이 쿼리 괜찮은지 모르겠다 | `/ax-navi:sql 이 쿼리 성능 괜찮아?` |
| 업무 로직이 오라클 패키지에 있다 | `/plugin configure ax-navi@ax-navi` 로 DB 를 연결하고 `이 패키지 소스 보여줘` · `DB 덤프 받아줘` — [DB 까지 분석하기](#db-덤프까지-분석하기) |
| 백엔드 · 프론트 저장소를 함께 고친다 | `pair-init` 으로 연결한 뒤 `cross-repo-modify` |
| 인수인계 문서가 없다 | `/ax-navi:wiki` |

명령을 외우지 않아도 됩니다. **"하네스 초기화 해줘"** 처럼 말로 부탁하면 알맞은 스킬이 실행됩니다.

## 5분 체험

```bash
claude plugin marketplace add Malburi/AX-NAVI-V2
claude plugin install ax-navi@ax-navi --scope user

cd /path/to/레거시-프로젝트
claude
```

Claude Code 안에서 한 번만 합니다.

```text
하네스 초기화 해줘
```

1. **인덱싱**(AI 를 쓰지 않아 비용 0, 보통 수십 초) — 코드베이스를 전수 파싱해 지도를 만듭니다.
2. **견적** — 규모와 예상 토큰을 알려 주고 Full / Standard 를 고르게 합니다. 여기서 중단해도 인덱스는 남아 `/ax-navi:find` · `/ax-navi:impact` 가 바로 동작합니다.
3. **분석 · 하네스 생성** — 분석 리포트, 프로젝트 전용 `CLAUDE.md` · 도메인 에이전트 · 컨벤션 패턴이 만들어지고 점수로 검증됩니다.

이후 모든 작업이 이 프로젝트의 구조와 컨벤션에 맞춰 돕니다. 이 과정은 한 번만 하면 되고, 만들어진 `CLAUDE.md` · `.claude/` 를 커밋해 두면 팀원은 다시 초기화할 필요가 없습니다(인덱스만 수십 초에 다시 만듭니다, LLM 0).

## 다른 AI 코딩 도구와 무엇이 다른가요

- **지도를 먼저 만듭니다.** 심볼 · 호출 그래프 · SQL 사용처 · 트랜잭션 · 외부 통신 · DB 스키마를 전수 파싱해 인덱스로 둡니다. AI 가 파일을 더듬어 찾는 대신, 모든 답이 이 지도를 근거로 나옵니다.
- **"없는 것"까지 알려 줍니다.** 찾은 것 · 확인했는데 없는 것 · 확인하지 못한 것을 나눠 보고합니다. 그럴듯한 추측으로 메우지 않습니다.
- **고치기 전에 영향을 계산합니다.** 영향도 → 변경 → 컨벤션 · 검증 · 안전성 점검 순으로, 인덱스로 먼저 잡고 위험한 변경에서만 LLM 평가를 한 번 돌립니다.
- **분석이 얕으면 막습니다.** 인덱스 요약만 옮긴 리포트가 평가를 통과하던 구멍을 결정론적 깊이 게이트로 막고, 영역별 심층 분석으로 메웁니다.
- **SI 현장의 레거시를 압니다.** Spring · Struts · MyBatis 는 물론 Nexacro · PowerBuilder · Pro*C · PL/SQL 까지, EUC-KR 파일도 인코딩을 지키며 고칩니다.
- **업무 로직이 DB 에 있어도 끊기지 않습니다.** Oracle 은 플러그인 설정만으로 DB 에 읽기 전용으로 붙어 패키지 소스 · 컴파일러 기준 의존 · 배치 잡 · 한글 코멘트까지 읽고, MSSQL · MySQL · PostgreSQL 은 덤프를 넣으면 프로시저 · 트리거 · 뷰까지 같은 지도에 잇습니다.

<details>
<summary>그 밖의 장점</summary>

- **백엔드 · 프론트엔드를 함께 봅니다.** 짝 저장소(pair-init)를 연결하면 인덱스의 `impact` 가 저장소를 넘어 화면까지 한 번에 따라갑니다.
- **팀이 한 번만 초기화합니다.** 공유된 하네스를 받은 팀원은 전체 초기화 없이 인덱스 신선도만 확인합니다.
- **말로 부탁하면 됩니다.** 알맞은 스킬이 실행되고, 짧게 부르려면 `/ax-navi:find` 같은 별칭이 있습니다.
- **모델이 고정돼 있습니다.** 모든 에이전트가 `sonnet` 별칭을 쓰고 Opus 로 자동 승격하지 않습니다. 실제 모델은 조직 설정(`ANTHROPIC_DEFAULT_SONNET_MODEL`)을 따릅니다.

</details>

---

## 목차

- [설치](#설치)
- [사용법](#사용법)
- [DB 덤프까지 분석하기](#db-덤프까지-분석하기)
- [분석 깊이 게이트](#분석-깊이-게이트)
- [v2 에서 달라진 것](#v2-에서-달라진-것)
- [플러그인 훅](#플러그인-훅)
- [에이전트 · 스킬 목록](#에이전트--스킬-목록)
- [지원 스택](#지원-스택)
- [구성](#구성)

현재 버전 **0.3.13**

---

## 설치

### 요구 사항

| 항목 | 버전 | 용도 |
|---|---|---|
| **Claude Code** | `claude plugin` 을 지원하는 최신 버전 | 플러그인 설치 · 실행 |
| **Node.js** | 18 이상 | 결정론적 인덱서 · 견적 · 스키마 검증 (npm 의존성 없음) |
| git | 아무 버전 | 하네스 공유 · 변경 범위 표시 |
| **Python** | 3.10 이상 (필수) | 하네스 조립(CLAUDE.md · 스킬 · 패턴) · 검증 · 위키 생성 |
| Oracle Instant Client | 선택 | DB 도구로 thin 접속을 거부하는 DB 에 붙을 때만(thick 모드). Oracle 드라이버 자체는 DB 도구를 처음 쓸 때 npm 으로 자동 설치됩니다 |

Python 인터프리터 이름은 `python3` → `python` → `py` 순서로 찾습니다. Node 가 없으면 인덱서 대신 스택별 Python 추출기가 기본 인덱스만 만듭니다. Python 이 없거나 3.10 미만이면 하네스 초기화는 시작할 때 멈추고 설치 방법을 안내합니다(인덱스만 갱신은 그대로 진행).

Python 설치(Windows)는 다음 순서로 합니다.

1. [python.org](https://www.python.org/downloads/) 에서 3.10 이상을 받아 설치하고, 첫 화면에서 **Add python.exe to PATH** 를 체크합니다.
2. 설정 > 앱 > 고급 앱 설정 > 앱 실행 별칭에서 `python.exe` · `python3.exe` 를 끕니다(Microsoft Store 로 연결되는 가짜 실행 파일).
3. 새 터미널에서 `python --version` 이 3.10 이상으로 나오는지 확인하고 Claude Code 를 다시 실행합니다.

### 처음 설치

```bash
claude plugin marketplace add Malburi/AX-NAVI-V2
claude plugin install ax-navi@ax-navi --scope user
```

설치 뒤 새 Claude Code 세션을 시작하거나 `/reload-plugins` 를 실행하세요. Claude Code 대화창에서는 `/plugin marketplace add Malburi/AX-NAVI-V2` → `/plugin install ax-navi@ax-navi` 로도 됩니다.

### 이전 주소(Malburi/AX-NAVI)로 등록해 둔 경우

```bash
claude plugin uninstall ax-navi@ax-navi --scope user
claude plugin marketplace remove ax-navi
claude plugin marketplace add Malburi/AX-NAVI-V2
claude plugin install ax-navi@ax-navi --scope user
```

### 업그레이드

```bash
claude plugin marketplace update ax-navi
claude plugin update ax-navi@ax-navi
```

적용은 새 세션에서 됩니다. 새 판에서 달라진 점은 [변경 이력](docs/changelog.md)에 있습니다.

### GitHub 에 접속되지 않는 사내망

관리자가 이 저장소를 사내 공유폴더에 올려 두면 사용자는 `deploy\install.cmd` 를 실행하기만 하면 설치·갱신됩니다. 절차는 [사용자용 가이드](deploy/user-guide.html)와 [관리자용 가이드](deploy/admin-guide.html)에 있습니다. 설치한 뒤 잘 쓰는 방법은 [활용 가이드](deploy/usage-guide.html)(워크플로우 · 아키텍처 그림 원본은 `deploy/diagrams/*.drawio`)를 보세요. GitHub 에 접속되는 사람은 위 방법을 그대로 쓰면 됩니다.

### 설치 확인

Claude Code 에서 `/plugin list` 에 `ax-navi@ax-navi — enabled` 가 보이면 됩니다.

## 사용법

### 하네스 초기화

프로젝트를 전수 분석해 이후 작업의 근거가 되는 자산을 만듭니다. 프로젝트 루트에서 Claude Code 를 열고 말로 부탁합니다.

```text
하네스 초기화 해줘
```

```
프로젝트/
├── CLAUDE.md                ← 프로젝트 맞춤 컨텍스트 (인덱스 우선 작업 프로토콜 포함)
├── .claude/
│   ├── skills/              ← 이 프로젝트 전용 스킬 (trace · scaffolder · find-logic)
│   ├── agents/              ← 이 프로젝트 전용 도메인 에이전트
│   └── patterns/            ← 코드 컨벤션 프로필 (근거 파일 포함)
└── _workspace/
    ├── index/               ← 코드베이스 전수 인덱스 (심볼 · 호출 · SQL · 트랜잭션 · 스키마 …)
    ├── deep/                ← 영역별 심층 분석 (깊이 게이트가 요구했을 때)
    └── 0*_*.md              ← 단계별 분석 리포트 · 평가 리포트
```

분석 깊이는 두 가지입니다. 인덱싱 뒤 규모와 견적을 보여 주고 고르게 합니다.

| Tier | 언제 | 비용 |
|---|---|---|
| **Full** (기본) | 심층 분석 · 마이그레이션 · 대규모 수정 계획 | 기준 |
| **Standard** | 일상 유지보수 | Full 의 약 60% |

요청문에 `빠르게` · `간단히` 가 있으면 Standard, `깊게` · `심층` · `마이그레이션` · `레거시` 가 있으면 Full 로 바로 정해집니다. 견적 공식은 [Tier 와 토큰 비용](docs/site/getting-started/tier-and-cost.md).

### 단축 별칭

| 별칭 | 스킬 | 하는 일 |
|---|---|---|
| `/ax-navi:find` | `find-feature` | 기능 · 키워드로 코드 위치 탐색 |
| `/ax-navi:flow` | `trace-logic` | 처리 흐름 추적 (진입점부터 DB 까지) |
| `/ax-navi:impact` | `analyze-impact` | 변경 영향도 분석 |
| `/ax-navi:modify` | `safe-modify` | 안전 변경 (영향도 → 변경 → 검증) |
| `/ax-navi:scaffold` | `scaffold-feature` | 컨벤션 따라 신규 기능 생성 |
| `/ax-navi:sql` | `review-sql` | SQL 리뷰 |
| `/ax-navi:wiki` | `generate-wiki` | 산출물 → 위키 생성 |

### 인덱스를 직접 질의하기

스킬은 큰 인덱스를 통째로 읽지 않고 질의 스크립트로 좁힙니다. 직접 써도 됩니다.

```bash
# 신선도 확인(exit 0 = 최신, 1 = 오래됨) · 증분 재인덱싱
node <플러그인 루트>/agents/lib/build-index.mjs --root <프로젝트> --check-stale
node <플러그인 루트>/agents/lib/build-index.mjs --root <프로젝트> --mode incremental

# 질의
node <플러그인 루트>/agents/lib/query-index.mjs impact --root <프로젝트> --sql CATEGORY_TREE_S01 --column PARENT_NO
node <플러그인 루트>/agents/lib/query-index.mjs schema --root <프로젝트> --table TB_APPROVE
```

질의 종류: `impact` · `symbol` · `callers` · `callees` · `trace` · `sql` · `table` · `column` · `endpoint` · `transaction` · `schema` · `dispatch` · `dead` · `search` · `summary`. 코드를 고친 뒤에는 `--mode incremental` 로 갱신해 다음 작업이 최신 상태를 보게 합니다.

### 저장소가 여럿이면

백엔드 · 프론트엔드가 따로 있으면 `pair-init` 으로 연결합니다. 하네스 초기화에서 구성을 물을 때 **"서버·클라이언트 각각 초기화 후 연결 (1:1)"** 을 고르면 양쪽을 같은 규칙으로 분석한 뒤 자동으로 연결합니다. 백엔드 1개 + 클라이언트 여러 개(웹 · 모바일 · 관리자)는 허브형(1:N)입니다.

연결하고 나면 `impact` 가 저장소를 넘어 "이 컬럼을 빼면 어느 화면이 깨지는지"까지 한 번에 따라가고, `cross-repo-scaffold` · `cross-repo-modify` 로 양쪽을 함께 고칩니다. API 계약 드리프트는 `_workspace/reports/api_drift_report.md` 로 남습니다.

### 물어봐야 할 때는 물어봅니다

사람이 정할 일(프로젝트 구성, Tier, 선택 작업)은 선택지를 띄웁니다. 질문을 건너뛰면 그 값은 `unconfirmed` 로 기록돼 다음 실행에서 다시 묻습니다. 답할 사람이 없는 실행에서는 기본값으로 넘어가지 않고 멈춥니다.

---

## DB 덤프까지 분석하기

업무 로직이 오라클 패키지 · 프로시저에 몰려 있는 시스템은 소스 저장소만으로 분석이 끊깁니다. 수강신청 가능 여부 · 자동 수료 판정 같은 핵심 규칙이 `PR_APPLY_CHECK` 한 줄 호출 뒤에 숨어 있기 때문입니다. **DDL 과 프로시저 소스를 덤프로 프로젝트 안에 두면 같은 인덱스에 이어 붙습니다.**

**Oracle 이면 DB 에 바로 붙일 수 있습니다(권장).** `/plugin configure ax-navi@ax-navi` 에서 접속 정보(호스트 · 포트 · 서비스 · 읽기 전용 계정 · 비밀번호 · 스키마)를 넣으면 끝입니다. 비밀번호는 Claude Code 자격 증명 저장소(macOS 키체인, Windows·Linux 는 `~/.claude/.credentials.json` 평문)에 들어가 설정 파일·프로젝트에는 남지 않고, 드라이버는 처음 쓸 때 자동 설치됩니다.

- "이 패키지 소스 보여줘" · "이 테이블 쓰는 프로시저 · 트리거 · 배치 뭐 있어?" — Claude 가 DB 사전(ALL_SOURCE · ALL_DEPENDENCIES · 스케줄러 잡 · 코멘트)을 바로 봅니다.
- "DB 덤프 받아줘" 뒤 "인덱스만 갱신해줘" — 소스 · DDL 과 DB 사전이 인덱스에 들어가, 영향도 · 흐름 추적이 배치 잡과 컴파일러 기준 의존까지 잇습니다. 하네스 초기화도 정의 없는 프로시저가 있으면 받아 올지 묻습니다.
- 접속 시 `ORA-04088` · `ORA-20001`(허용되지 않는 클라이언트)이 나오면 DB 가 thin 접속을 거부하는 것입니다. 그 DB 가 요구하는 버전 이상의 Oracle Client 를 설치하고 `ORACLE_HOME` 을 설정하면(Windows 는 `ORACLE_HOME\bin` 에 `oci.dll` 이 있으면) 자동으로 thick 모드로 붙습니다. 다른 위치면 환경 변수 `AXNAVI_DB_CLIENT_LIB` 에 폴더를 지정합니다.
- 모든 조회는 읽기 전용 트랜잭션에서 돌고, 데이터 조회(`db_query`)는 SELECT 한 문장 · 200행까지입니다. 계정 자체를 읽기 전용(`CREATE SESSION` + `SELECT_CATALOG_ROLE`)으로 만드세요. 자세한 건 [인덱서 설정](docs/site/configuration/indexer-config.md).

손으로 덤프를 넣는 방법(다른 DB 포함)은 아래와 같습니다.

1. 덤프를 프로젝트 안에 둡니다(예: `db/dump/`). 객체별 파일이 가장 낫고(`PKG_X.pks` · `PKG_X.pkb` · `TB_Y.sql`), **데이터 행은 넣지 않습니다** — 개인정보 · 비밀번호가 섞입니다. 덤프에는 스키마와 업무 로직이 들어 있으니 저장소에 커밋하지 않는 편이 안전합니다.
2. `_workspace/indexer-config.json` 에 경로를 적습니다. `.pks` · `.pkb` · `.prc` · `.fnc` · `.trg` 확장자는 설정 없이도 읽습니다.
   ```json
   { "db_dump_paths": ["db/dump"] }
   ```
3. `인덱스만 갱신해줘`(`--mode incremental`)를 실행합니다.

| DB | 인식하는 것 |
|---|---|
| **Oracle** | `CREATE TABLE`(TABLESPACE · PARTITION 꼬리절 포함) · 인덱스 · 뷰 · 시퀀스 · 시노님 · 패키지 SPEC/BODY · 프로시저 · 함수 · 트리거 |
| **MSSQL (T-SQL)** | `GO` 경계, `[bracket]` 이름, `EXEC`, 트리거의 `inserted` · `deleted` |
| **MySQL / MariaDB** | `DELIMITER`, `/*!50003 … */` 조건부 주석, 인라인 `KEY` |
| **PostgreSQL** | `$$` 본문, `CREATE FUNCTION … RETURNS TRIGGER`, `CREATE OR REPLACE` |

방언은 파일 내용으로 자동 판별하고, 결과는 `schema.json` 의 `procedures` · `functions` · `triggers` · `views` · `sequences` · `synonyms` 에 들어갑니다. 각 단위가 읽고 쓰는 테이블, 부르는 프로시저, **그것을 부르는 Java · 화면 호출처**가 함께 이어집니다.

```bash
node <플러그인 루트>/agents/lib/query-index.mjs schema --root <프로젝트> --table TB_APPLY
#   → 이 테이블을 읽고 쓰는 프로시저 · 트리거 목록(accessed_by)
```

**소스에는 호출이 있는데 덤프에는 정의가 없는 프로시저**는 `_meta.json` 의 `db_source.undefined_procedures` 에 호출처 수 순으로 남습니다. 하네스 초기화는 이 목록의 상위를 보여 주고 어떤 덤프를 더 받아야 하는지 안내합니다.

> 한계: 동적 SQL(`EXECUTE IMMEDIATE` 변수) · 오버로드 · 중첩 로컬 프로시저는 근사입니다. 방언별 파서는 합성 샘플과 실제 프로젝트 하나(Oracle 호출 쪽)로 검증했고, 실제 DB 덤프로는 아직 충분히 시험하지 못했습니다. 덤프 경로의 파일은 32MB 까지 읽고, 그보다 크면 건너뛴 사실이 기록됩니다. 설정 전체는 [인덱서 설정](docs/site/configuration/indexer-config.md).

---

## 분석 깊이 게이트

LLM 이 인덱스 요약만 옮기고 `업무 규칙` · `업무별 흐름` 절을 "미수행"으로 비워도 평가가 통과하던 문제가 있었습니다(실측: 소스 2,737파일, 리포트 6KB, 84점). 그래서 평가 **전에** 결정론적으로(LLM 없이) 깊이를 잽니다.

| 신호 | 기준 | 결과 |
|---|---|---|
| 비어 있는 필수 절(업무 개요 · 업무별 흐름 · 업무 규칙 · 비동기/스케줄/이벤트 · 인증/인가 경로) | 2개 이상 | **FAIL** (1개는 WARN) |
| `파일:줄` 근거 수 | 하한의 25% 미만 | **FAIL** (하한 미만은 WARN) |
| 서술 분량 · "미수행" 표현 | 하한 미만 | WARN 만 |

FAIL 이면 **영역별 심층 분석**을 처방합니다. 영역 수는 파일 400개당 1개(1~7), 영역당 약 25만 토큰입니다. 견적이 30만 토큰 이하(영역 1개 — 작은 프로젝트)이면 묻지 않고 진행하고, 그 이상이면 사용자에게 확인합니다. 작은 프로젝트라고 분석을 덜 하지는 않습니다 — 같은 기준이 적용되고 처방이 작을 뿐입니다.

사용자가 심층 분석을 거절하면 `declined` 로 기록돼 평가가 총점 상한 없이 -5점만 매기고, 같은 일을 다시 시키지 않습니다. 하한이 맞지 않는 프로젝트는 `indexer-config.json` 의 `depth_gate` 로 조정하거나 끕니다([설정](docs/site/configuration/indexer-config.md)).

실제 Java/Struts LMS 한 곳에서: 서술 3.6KB → 316KB, `파일:줄` 근거 0 → 898건, 평가 84 → 96점.

> 한계: 하한은 프로젝트 둘의 실측으로 정한 경험값이고, 심층 분석은 AI 가 쓴 것이라 표본 검증만 했습니다. 영역 분할은 출발점이고, 작은 프로젝트에서의 동작은 합성 리포트로만 확인했습니다.

---

## v2 에서 달라진 것

v1 을 평범한 Claude Code 와 같은 과제로 비교해 보니 강점은 **다른 저장소까지의 영향도**, 약점은 **절차 비용**과 **지침에만 있던 안전장치**였습니다. v2 는 그 결과대로 고쳤습니다.

- **인덱스 2.0 — 코드에 안 보이는 연결.** 화면이 `TransData.do?worker=…&action=…` 처럼 문자열로 서버 메서드를 부르고 결과를 `rtInfo[1][2]` 처럼 위치로 읽는 구조를 설정 없이 찾아 백엔드 메서드 · SQL 컬럼 순서와 잇습니다. `query-index impact` 한 번으로 짝 저장소 화면까지 "이 컬럼을 빼면 어디가 깨지는지"가 나옵니다. 이런 메서드를 죽은 코드로 보지 않습니다.
- **가벼운 수정 절차.** safe-modify · cross-repo-modify 는 영향도를 인덱스로 먼저 잡고, 고친 뒤에는 결정적 검사(재영향도 · 검증 명령)가 기본입니다. LLM 재평가는 DDL · 트랜잭션 · 인증 · 데이터 변경 같은 위험한 변경에서만 한 번 돕니다.
- **0.3 대에서 더해진 것.** DB 덤프(Oracle · MSSQL · MySQL · PostgreSQL) 분석, 플러그인 내장 Oracle DB 도구(0.3.11 — 읽기 전용 접속 · DB 사전을 인덱스에 병합, 0.3.12 — thin 접속을 거부하는 DB 에 thick 모드), 분석 깊이 게이트와 영역별 심층 분석, 사전 견적 · 예산, 인덱스 스키마 검증. 판마다의 내용은 [변경 이력](docs/changelog.md).

**같은 과제 재측정 (방식마다 3회 평균, AX-NAVI CLI 실행기 기준)**

| 과제 | 평범한 Claude Code | v1 | **v2** |
|---|---|---|---|
| 실제 레거시: 쿼리 첫 컬럼을 빼면 어디가 깨지나 (정답 24곳) | 1/24 · $0.08 | 24/24 · $0.74 · 4분 34초 | **24/24 · $0.12 · 62초** |
| 실제 레거시: "안 쓰는 컬럼이니 빼줘" (실제로는 24곳이 위치로 읽음) | 3/3 화면 깨뜨림 | 2/3 화면 깨뜨림 | **0/3 — 24곳을 보여 주고 멈춤** |
| 공개 샘플: 등록 버튼부터 SQL 까지 (7단계) | 7단계 0/3 · $0.06 | 7단계 1/3 · $0.25 | **7단계 3/3 · $0.14** |
| 백 · 프론트 분리: 상세 화면에 수정 일시 추가 | 정답 · $0.30 | 정답 · $4.45 · 23분 | 정답 · $1.36 · 7분 |

한 저장소 안의 단순한 질문은 평범한 Claude Code 가 여전히 더 쌉니다. v2 의 쓸모는 **다른 저장소 · 문자열 호출 · 위치로 읽는 결과처럼 코드만 봐서는 안 보이는 영향**에 있습니다. 위 수치는 CLI 실행기로 잰 것이고 이 플러그인의 훅 경로로 다시 재지는 않았습니다. 측정 조건은 [AX-NAVI-CLI 변경 이력](https://github.com/Malburi/AX-NAVI-CLI/blob/main/docs/changelog.md)에 있습니다.

---

## 플러그인 훅

플러그인이 켜져 있으면 Claude Code 의 훅이 아래를 맡습니다(`hooks/hooks.json`).

| 시점 | 하는 일 |
|---|---|
| 세션 시작 | 인덱스가 있으면 신선도를 확인하고, 바뀐 저장소만 다시 만듭니다(AI 0원) |
| 질문 입력 | 영향도 · 수정 요청이면 인덱스로 계산한 사전 영향도를 맥락으로 넣습니다 |
| 셸 명령 실행 전 | 디스크 전체 검색(`find /`)을 막고, 평가 서브에이전트(change-safety 등)는 요청당 1번까지로 제한합니다. 환경변수 `AXNAVI_SHELL_WRITE_GUARD=1` 을 켜면 `python -c` · `sed -i` · 리다이렉트처럼 **셸로 소스를 쓰려 할 때 승인을 묻습니다**(기본은 꺼짐 — 소스를 건드리지 않는 명령에도 확인 창이 거듭 떠서) |
| 파일 읽기 · 쓰기 | EUC-KR 등 레거시 인코딩을 지킵니다 |
| 답이 끝날 때 | UTF-8 로 바뀐 EUC-KR 파일을 원래 인코딩으로 되돌려 쓰고, SELECT 순서를 바꿨는데 결과를 위치로 읽는 화면이 남았으면 **Claude 가 이어서 처리하게** 합니다 |

Edit · Write 승인은 Claude Code 의 권한 모드를 그대로 따릅니다. `axnavi` CLI 로 실행하면 CLI 가 같은 일을 하고 이 훅들은 비킵니다.

---

## 에이전트 · 스킬 목록

<details>
<summary><b>에이전트 19종</b></summary>

| 에이전트 | 역할 |
|---|---|
| `analyzer` | 코드베이스 전수 분석 → 구조 · 레이어 · 의존성 리포트, 영역별 심층(`deep`) 분석 |
| `writer` | 분석 결과 → CLAUDE.md · 도메인 에이전트 생성 |
| `pattern-extractor` | 코드 컨벤션 추출 → 근거 파일이 있는 패턴 프로필 |
| `validator` | 생성 산출물 검증 (파일 존재 · 트리거 품질 · 경로 교차 · 보안) |
| `qa` | 경계면 교차 비교 (Boundary 1~7) |
| `harness-evaluator` | 4차원 품질 채점 → 80점 미만 시 타겟 재생성 |
| `spec-clarifier` | 착수 전 명세 명확화 |
| `pipeline-runner` | 인덱싱 · 조립 · 검증 스크립트 실행 |
| `impact-analyzer` | 변경 대상의 직간접 영향 분석 |
| `change-safety` | 변경 안전성 판정 (GO / HOLD / STOP) |
| `pattern-conformance` | 변경이 프로젝트 컨벤션을 따르는지 |
| `migration-planner` | 스택 마이그레이션 계획 |
| `test-generator` | 테스트 생성 |
| `sql-reviewer` | SQL 리뷰 |
| `legacy-decoder` | 레거시 코드 해석 |
| `logic-tracer` | 처리 흐름 추적 |
| `feature-finder` | 기능 · 키워드로 코드 위치 탐색 |
| `doc-syncer` | 문서 동기화 |
| `api-bridge` | 백엔드↔프론트엔드 API 계약 추출 · 검증 · 스텁 생성 |

</details>

<details>
<summary><b>워크플로우 스킬 17종 + 단축 별칭 7종</b></summary>

**여러 에이전트를 지휘하는 스킬**

| 스킬 | 하는 일 |
|---|---|
| `harness-init` | 하네스 초기화 / 재초기화 (인덱싱 → 견적 → 분석 → 깊이 게이트 → 평가) |
| `safe-modify` | 안전 변경 (영향도 → 변경 → conformance · verify · safety 검증) |
| `scaffold-feature` | 컨벤션 따라 신규 기능 생성 |
| `pair-init` | 백엔드 · 프론트엔드 별도 저장소 연동 |
| `cross-repo-scaffold` | 전체 스택 기능 동시 생성 |
| `cross-repo-modify` | 기존 기능 개선을 양쪽 저장소에 동시 반영 |
| `plan-migration` | 스택 마이그레이션 계획 |
| `spec-gate` | 초기화 전 명세 명확화 |

**단일 에이전트 스킬**

| 스킬 | 별칭 | 하는 일 |
|---|---|---|
| `find-feature` | `/ax-navi:find` | 기능 · 키워드로 코드 위치 탐색 |
| `trace-logic` | `/ax-navi:flow` | 처리 흐름 추적 |
| `analyze-impact` | `/ax-navi:impact` | 변경 영향도 분석 |
| `review-sql` | `/ax-navi:sql` | SQL 리뷰 |
| `generate-wiki` | `/ax-navi:wiki` | 하네스 산출물 → 위키 |
| `publish-wiki` | | 위키를 중앙 허브 DB 에 발행 |
| `harness-clean` | | 하네스 전체 제거 |

**작업 방식**

| 스킬 | 하는 일 |
|---|---|
| `vibe` | 영향 · 안전 검토를 생략한 빠른 작업 (패턴 · 최소 검증은 유지) |
| `wiki-hub` | 여러 시스템 위키 통합 열람 · 검색 · 버전 관리 |

</details>

---

## 지원 스택

| 스택 | 수준 |
|---|---|
| Java / Spring · Struts · MyBatis | **FULL** — 심볼 · 호출 그래프 · SQL · 트랜잭션 · 스키마 |
| JavaScript / TypeScript (Vue · React) | FULL (일부 동적 패턴은 PARTIAL) |
| Python · Go · C#/.NET | FULL |
| SQL / DDL (Oracle · MSSQL · MySQL · PostgreSQL) | FULL — 테이블 · 인덱스 · 뷰 · 시퀀스 · 시노님 ([DB 덤프](#db-덤프까지-분석하기)) |
| ASP.NET Core · WinForms · Nexacro | 전용 어댑터로 보강 |
| WinForms Designer · DevExpress · XFDL · JSP/Struts XML | **PARTIAL** |
| 루틴: PL/SQL · T-SQL · MySQL · PL/pgSQL (패키지 · 프로시저 · 함수 · 트리거) | **PARTIAL** — 심볼 · 호출 · 정적 SQL · 읽고 쓰는 테이블 · Java `{call}` 연결 |
| Oracle Pro*C 배치 (`.pc`) | **PARTIAL** — C 함수 · 호출 · EXEC SQL · PL/SQL 프로시저 연결 |
| PowerBuilder 텍스트 내보내기 (`.srw` · `.srd` 등) | **PARTIAL** — 이벤트 · 함수 · 임베디드 SQL · DataWindow 연결 |

PARTIAL 대상은 에이전트가 원문을 직접 읽어 확인한 뒤 수정합니다. 읽을 수 없는 형식만 수정을 보류합니다. 스택별 탐지 시그니처와 마이그레이션 시나리오는 [지원 스택 매트릭스](docs/site/reference/stack-matrix.md).

---

## 구성

| 경로 | 내용 |
|---|---|
| `agents/` | 전문 에이전트 19종 (`agents/lib/` 결정론적 인덱서 · 질의 · 검증 스크립트) |
| `skills/` | 워크플로우 스킬 17종 + 단축 별칭 7종 |
| `hooks/hooks.json` | 위 표의 플러그인 훅 |
| `packages/` | 훅이 쓰는 런타임 모듈(쓰기 판정 · 턴 감사 · 고친 뒤 검증 · 인코딩 보존)과 DB 도구 MCP 서버(`packages/db-mcp/`). 실행기는 들어 있지 않습니다 |
| `docs/` | 소개 페이지(`docs/index.html`), 사용자 문서(`docs/site/`), 인덱스 스키마(`docs/index-schema/`), 변경 이력 |

0.3.7 부터 이 저장소가 플러그인 원본입니다. 플러그인 부품(에이전트 · 스킬 · 훅 · 런타임 모듈)은 여기서 고치고, [AX-NAVI-CLI](https://github.com/Malburi/AX-NAVI-CLI) 의 `scripts/build-plugin.mjs` 로 덮어쓰지 않습니다.

### 문서

사용자 문서는 [docs/site](docs/site/README.md)(웹: <https://malburi.github.io/AX-NAVI-V2/site/>)에 있습니다.

- 시작하기: [설치](docs/site/getting-started/install.md) · [10분 빠른 시작](docs/site/getting-started/quickstart.md) · [Tier 와 토큰 비용](docs/site/getting-started/tier-and-cost.md)
- 개념: [결정론적 인덱스](docs/site/concepts/deterministic-index.md) · [판정과 게이트](docs/site/concepts/gates.md)
- 설정: [인덱서 설정](docs/site/configuration/indexer-config.md) · [pair 설정](docs/site/configuration/pair-config.md)
- 튜토리얼: [첫날](docs/site/tutorials/onboarding-day1.md) · [DB 컬럼 변경](docs/site/tutorials/db-column-change.md) · [백엔드 · 프론트 함께 고치기](docs/site/tutorials/cross-repo-feature.md)
- 막혔을 때: [문제 해결](docs/site/troubleshooting.md) · [FAQ](docs/site/faq.md)

### 개발

```bash
node agents/lib/tests/run.js      # 인덱서 · 질의 · 깊이 게이트 테스트 (npm 의존성 없음)
```

판마다의 변경 · 사유 · 한계는 [docs/changelog.md](docs/changelog.md).

---

## 라이선스

MIT
