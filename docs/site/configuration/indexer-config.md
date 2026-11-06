# 인덱서 설정 (indexer-config.json)

`_workspace/indexer-config.json`은 결정론적 인덱서 `build-index.mjs`가 어느 경로를 어떤 워크스페이스로 읽을지 정하는 유일한 설정 파일입니다. harness-init의 `block: index` 단계가 `_workspace/00_init_scope.md`의 값을 기계적으로 옮겨 자동 생성하므로 평소에는 손댈 일이 없고, 인덱싱 범위나 제외 규칙을 바꾸고 싶을 때만 직접 편집합니다. 이 페이지의 키 목록은 `agents/lib/build-index.mjs`의 `loadConfig()`가 실제로 읽는 것만 적었습니다.

## 파일 위치와 로딩 규칙

| 항목 | 값 |
|------|-----|
| 기본 경로 | `[프로젝트 루트]/_workspace/indexer-config.json` |
| 다른 경로 지정 | `build-index.mjs --config <json>` (상대경로는 루트 기준) |
| 파일이 없을 때 | 빈 설정으로 간주하고 루트 전체를 `single-root`로 인덱싱 |
| 인코딩 | UTF-8. PowerShell로 만든 JSON의 BOM은 인덱서가 벗겨 읽음 |
| 생성 주체 | pipeline-runner `block: index` Step B (판단 없는 기계 변환) |

`--check-stale` 판정도 같은 파일을 읽어 `include_paths`를 적용하므로, 설정을 바꾸면 소스 지문이 달라져 다음 검사에서 재인덱싱이 필요하다고 나옵니다.

## 키 목록

| 키 | 타입 | 기본값 | 의미 |
|----|------|--------|------|
| `init_layout` | 문자열 | 아래 유추 규칙 | `single-root` / `monorepo` / `paired-roots` / `selected-paths` 중 하나. 허용 값이 아니면 무시하고 유추함 |
| `workspace_mode` | 불리언 | `false` | 모노레포처럼 여러 워크스페이스를 한 루트에서 인덱싱할 때 `true`. 복잡도 점수의 `multi_module` 신호에도 반영 |
| `workspaces[]` | 배열 | `[{id:"root", path:"", kind, stack}]` | 워크스페이스 정의. 파일이 어느 워크스페이스에 속하는지는 `path` 접두사가 가장 긴 항목으로 결정 |
| `workspaces[].id` | 문자열 | `"root"` | 인덱스 레코드의 `workspace` 필드에 기록되는 식별자 |
| `workspaces[].path` | 문자열 | `""` | 루트 기준 상대경로. `./` 접두사와 끝 `/`는 정규화 |
| `workspaces[].kind` | 문자열 | `"unknown"` | 역할 표기(backend·frontend 등). 인덱서는 값으로 분기하지 않음 |
| `workspaces[].stack` | 문자열 | `"unknown"` | 스택 이름. 복잡도 점수의 `db_or_orm`(sql·jpa·mybatis·ibatis 등)과 `legacy_stack`(struts·ibatis·jsp·egov) 판정에 정규식으로 사용 |
| `workspaces[].calls_backend_api` | 불리언 | `false` | 클라이언트 워크스페이스가 백엔드 API를 호출하는지 표시 |
| `include_paths[]` | 배열 | `[""]` (루트 전체) | 인덱싱할 상대경로 목록. `.`은 루트, `..`이나 `../`로 시작하는 값은 버림 |
| `kind` / `stack` | 문자열 | `"unknown"` | `workspaces`가 없을 때 기본 `root` 워크스페이스에 쓰는 값 |
| `vendor_exclude` | 불리언 | 켜짐 | `false`를 두면 벤더·미니파이 소스 제외를 전부 끔 |
| `test_exclude` | 불리언 | 켜짐 | `false`를 두면 테스트 디렉터리·테스트 파일명 제외를 끔 |
| `db_dump_paths[]` | 배열 | `[]` | DB 덤프(DDL·패키지·프로시저 소스)가 든 폴더의 상대경로. 이 폴더는 `include_paths`·벤더·테스트 제외와 무관하게 읽고, 파일당 크기 상한이 4MB에서 32MB로 넓어짐. 루트 밖·절대경로는 버림 |
| `depth_gate` | 객체 | 아래 기본값 | 분석 리포트 깊이 게이트(`report-depth.mjs`)의 조정. 아래 "분석 깊이 게이트" 참조 |

### 분석 깊이 게이트

harness-init 은 분석 리포트가 인덱스 요약만 옮기고 절을 비웠는지 측정한다. **규모와 무관한 신호만 막고, 규모에 비례하는 경험값은 알리기만 한다.**

| 신호 | 기준 | 결과 |
|---|---|---|
| 비어 있는 필수 절(업무 개요·업무별 흐름·업무 규칙·비동기/스케줄/이벤트·인증/인가 경로) | 2개 이상 | **FAIL** (1개는 WARN) |
| `파일:줄` 근거 수 | 하한의 25% 미만 | **FAIL** (하한 미만은 WARN). 하한은 `clamp(소스 파일 수/60, 8, 120)` |
| 서술 분량 | 하한 미만 | WARN 만. 하한은 `clamp(소스 파일 수×6, 3KB, 60KB)` — 프로젝트 둘의 실측으로 정한 경험값 |

작은 프로젝트도 똑같이 막는다. 분석은 규모와 무관하게 있어야 하고, 작은 시스템의 처방은 영역 1개라 비용이 작다.

FAIL 이면 심층 패스(영역별 분석)를 처방한다. 영역 수는 파일 400개당 1개(1~7), 견적은 영역당 약 25만 토큰이다. **견적이 30만 토큰 이하(영역 1개)이면 묻지 않고 진행**하고, 그 이상이면 사용자에게 확인한다. 거절하면 `declined`로 기록되어 평가가 총점 상한 없이 -5점만 매기고 Phase 4 가 같은 일을 다시 시키지 않는다.

```json
{ "depth_gate": { "enabled": false } }
```

| 키 | 기본값 | 의미 |
|---|---|---|
| `enabled` | `true` | `false`면 게이트를 끈다(`SKIPPED`) |
| `narrative_bytes` · `citations` | 규모 비례 | 하한을 직접 지정. 숫자가 아닌 값·음수는 무시 |
| `small_project_files` | `0` (꺼짐) | 옵트인. 소스가 이 파일 수 미만이면 FAIL 을 WARN 으로 낮춤. 기본은 작은 프로젝트도 똑같이 막고, 처방이 영역 1개로 작게 나온다 |
| `min_stub_sections` | `2` | 비어 있는 필수 절이 이 개수 이상이면 FAIL |
| `auto_proceed_tokens` | `300000` | 심층 패스 견적이 이 이하면 확인 없이 진행 |

결과는 `_workspace/report_depth.json`에 남는다(판정·지표·하한·처방). 하한이 맞지 않는 프로젝트를 만나면 이 파일의 지표를 보고 조정한다.

**DB 에서 바로 받기 (Oracle, 권장).** 플러그인에 DB 도구가 들어 있다. `/plugin configure ax-navi@ax-navi` 에서 호스트·포트·서비스·계정·비밀번호·분석할 스키마를 넣으면(비밀번호는 Claude Code 자격 증명 저장소에 보관 — Windows·Linux 는 `~/.claude/.credentials.json` 평문이라 계정을 읽기 전용으로 만드는 것이 실제 안전장치다) Claude 가 DB 도구를 쓸 수 있다. 프로젝트마다 DB 가 다르면 프로젝트 `.env` 에 `ORACLE_HOST`·`ORACLE_PORT`·`ORACLE_SERVICE`·`ORACLE_USER`·`ORACLE_PASSWORD`·`ORACLE_OWNERS` 를 두면 그쪽이 우선한다.

- "DB 덤프 받아줘"(`db_export`) — `db/dump/` 에 객체별 PL/SQL 소스·테이블 DDL과 `_catalog.json`(DB 사전: 객체 상태·암호화 여부·컴파일러 의존·트리거·배치 잡·한글 코멘트·제약)을 쓰고 `db_dump_paths` 에 등록한다. 이어서 "인덱스만 갱신해줘". 다시 받으면 바뀐 객체만 쓴다.
- 인덱스에는 정규식 결과에 더해 `db_references`(컴파일러 기준 참조, 파서가 못 본 테이블은 `not_in_source_parse`), `scheduled_by`(어느 배치 잡이 부르나 — call_graph `scheduler` 엣지), `db_status`·`wrapped`, 테이블·컬럼 `comment` 가 붙는다.
- 질문에는 Claude 가 바로 DB 를 본다 — `db_source`(패키지 멤버 구간), `db_dependencies`, `db_table`(트리거·배치 잡까지), `db_objects`(한글 코멘트 검색). 데이터 값 확인은 `db_query`(SELECT/WITH 한 문장, 최대 200행).
- **계정은 읽기 전용으로.** 모든 접속은 `SET TRANSACTION READ ONLY` 로 열고 SQL 사전 검사도 하지만, 진짜 보증은 계정 권한이다. 예: `CREATE USER axnavi_ro IDENTIFIED BY ...; GRANT CREATE SESSION, SELECT_CATALOG_ROLE TO axnavi_ro;` (다른 스키마 소스를 보려면 카탈로그 권한이 필요하다). `db_query` 로 업무 데이터를 보려면 필요한 테이블에만 `SELECT` 를 준다.
- 드라이버(`oracledb`, Instant Client 불필요)는 첫 DB 도구 호출 때 자동 설치된다. 사내망에서 npm 이 막혀 실패하면 도구가 수동 설치 명령을 알려 준다. 연결 확인은 "DB 연결 상태 확인해줘"(`db_status`).

**DB 덤프 넣는 법(손으로).** 업무 로직이 오라클 패키지·프로시저에 있는 시스템은 소스 저장소만으로는 분석이 끊긴다. 덤프를 프로젝트 안(예: `db/dump/`)에 두고 `"db_dump_paths": ["db/dump"]`를 설정한다.

- **DDL만으로는 부족하다.** 테이블 DDL 외에 패키지 스펙+바디(`.pks`·`.pkb`) 소스가 있어야 프로시저가 읽고 쓰는 테이블과 호출 관계가 잡힌다. `DBMS_METADATA.GET_DDL` 또는 `ALL_SOURCE`(PACKAGE·PACKAGE BODY·PROCEDURE·FUNCTION·TRIGGER)로 뽑는다.
- **객체별로 나눠 받는 편이 좋다.** 한 파일이 32MB를 넘으면 `_meta.excluded_sources`에 `too-large`로 기록되고 읽지 않는다(4MB 초과 파일은 설정이 없어도 같은 방식으로 기록). 큰 파일일수록 인덱싱이 선형보다 느리게 늘어난다(실측: 5.6MB 약 4초, 18MB 약 24초).
- **데이터 행은 넣지 않는다.** 구조와 소스만 읽는다. 개인정보가 든 INSERT 덤프는 제외한다.
- **확장자.** `.sql`·`.ddl`(DDL), `.pks`·`.pkb`·`.pck`·`.spc`·`.bdy`·`.prc`·`.fnc`·`.trg`·`.pls`(PL/SQL). 이 중 `.ddl`과 PL/SQL 전용 확장자는 **`db_dump_paths` 없이도** 벤더·테스트 제외와 4MB 상한에서 풀려 읽힌다. `.sql`은 마이그레이션·테스트 스크립트일 수도 있어, 제외 폴더나 큰 파일은 `db_dump_paths`로 지정할 때만 풀린다.
- **무엇이 읽혔나.** 인덱싱 결과 `_meta.json`의 `db_source`에 읽은 객체 수(테이블·뷰·패키지·프로시저·함수·트리거)와 `undefined_procedures`(자바·XML이 부르는데 소스가 없는 프로시저, 호출 많은 순)가 남는다. harness-init은 이를 견적 화면과 최종 보고에 보여 주고, 어떤 프로시저 소스를 내보내야 하는지 알려 준다.
- **하네스 재초기화.** `indexer-config.json`의 `db_dump_paths`·`vendor_exclude`·`test_exclude`·`dispatch_rules`는 보존된다. 덤프를 추가한 뒤에는 `--mode init`이 아니라 `incremental`("인덱스만 갱신해줘")로 반영한다.

### 지원하는 DB 방언

방언은 **설정 없이** 파일 내용에서 판별한다(`_meta.json`의 `db_source.dialects`, `schema.json`의 `_meta.dialect`·객체별 `dialect`). 판별할 수 없는 `.sql`은 예전처럼 Oracle로 읽는다.

| DB | 테이블·뷰·시퀀스·시노님·인덱스 | 프로시저·함수·트리거 | 호출로 인식하는 모양 | 덤프에서 알아 두기 |
|---|---|---|---|---|
| Oracle | 지원(`DBMS_METADATA` 꼬리절 포함) | 지원(패키지 스펙+바디 포함) | `{call PKG.PROC}` · `begin PKG.PROC; end;` · PL/SQL 본문의 `PKG.PROC(` | 확장자 `.pks`·`.pkb`·`.prc`·`.fnc`·`.trg` |
| MSSQL | 지원(`[dbo].[x]`·`CLUSTERED`·`WITH CHECK ADD`·`GO`) | 지원(`CREATE PROCEDURE`·`FUNCTION`·`TRIGGER ... ON t AFTER ...`) | `EXEC [dbo].[usp_x] @a` · 자바의 `EXEC usp_x ?` | `GO`로 구분된 `.sql`. 가상 테이블 `inserted`·`deleted`는 제외 |
| MySQL / MariaDB | 지원(백틱·`ENGINE=`·인라인 `KEY`·`/*!50001 */` 뷰) | 지원(`DELIMITER`·`/*!50003 */`로 감싼 `mysqldump` 출력) | `CALL proc(...)` | `mysqldump --routines --triggers --no-data` 출력 |
| PostgreSQL | 지원(`character varying`·`ALTER TABLE ONLY`·`USING btree`) | 지원(`$$ ... $$` 본문, `EXECUTE FUNCTION` 트리거) | `PERFORM fn(...)` · `CALL proc(...)` · 자바의 `{? = call fn(?)}` | `pg_dump --schema-only` 출력 |

한계(전 방언 공통): 동적 SQL(`EXEC(@sql)`·`EXECUTE format(...)`·`EXECUTE IMMEDIATE 변수`)과 오버로드는 따라가지 않는다. PostgreSQL의 `SELECT fn(...)`은 내장 함수와 구분할 수 없어 호출로 잡지 않는다. 정규식 기반의 근사이며, 실제 DB가 낸 덤프가 아니라 각 도구가 내는 형식을 따른 픽스처로 검증했다.

`init_layout`을 지정하지 않으면 `workspace_mode`가 `true`일 때 `monorepo`, `include_paths`에 비어 있지 않은 값이 있으면 `selected-paths`, 그 외에는 `single-root`로 유추합니다. `hub-roots`는 harness-init의 구성 이름이지만 인덱서 설정에서는 허용 값이 아니므로 유추 규칙을 탑니다.

## 예시

단일 프로젝트의 기본 생성값입니다.

```json
{
  "init_layout": "single-root",
  "include_paths": ["."],
  "workspace_mode": false,
  "workspaces": [
    {"id": "root", "path": "", "kind": "unknown", "stack": "unknown"}
  ]
}
```

모노레포에서 백엔드와 프론트엔드를 함께 인덱싱하는 예시입니다.

```json
{
  "init_layout": "monorepo",
  "workspace_mode": true,
  "include_paths": ["server", "web"],
  "workspaces": [
    {"id": "backend", "path": "server", "kind": "backend", "stack": "spring-boot-mybatis"},
    {"id": "frontend", "path": "web", "kind": "frontend", "stack": "vue3", "calls_backend_api": true}
  ]
}
```

특정 폴더만 인덱싱하고 테스트 코드까지 그래프에 넣는 예시입니다.

```json
{
  "init_layout": "selected-paths",
  "include_paths": ["src/main/java/com/example/order", "src/main/resources/mapper"],
  "test_exclude": false
}
```

## 제외 규칙과 이스케이프 해치

인덱서는 기본적으로 두 종류의 소스를 인덱싱하지 않습니다. 제외된 파일은 `_meta.json`의 `excluded_sources`에 `count`·`by_reason`·`bytes`와 파일 목록(최대 100건)으로 남습니다.

| 제외 대상 | 판정 기준 | `by_reason` 값 | 끄는 키 |
|-----------|-----------|----------------|---------|
| 벤더·미니파이 | 라이브러리 배포 디렉터리명, `*.min.js`·`*.bundle.js` 같은 파일명, `jquery-1.5.2.js`처럼 버전이 박힌 이름, 앞 64KB 줄당 평균 250자 이상 | `vendor-path`·`vendor-filename`·`vendor-versioned`·`minified` | `"vendor_exclude": false` |
| 테스트 코드 | `test`/`tests`/`__tests__`/`spec`/`specs` 디렉터리(세그먼트 완전 일치), `*Test.java`·`*_test.go`·`test_*.py`·`*.test.ts`·`*Tests.cs` | `test-path`·`test-filename` | `"test_exclude": false` |

파일명 접두사(`jquery.add.js` 같은 것)로는 판정하지 않습니다. 라이브러리 이름을 접두사로 쓴 업무 코드가 잘리는 실측 사례가 있었기 때문입니다. 자세한 배경은 [결정론적 인덱스](/concepts/deterministic-index.md)를 참고하세요.

## 언제 손으로 고치는가

| 상황 | 고칠 키 | 이후 할 일 |
|------|---------|-----------|
| 초기화 때 고른 폴더 외에 모듈을 하나 더 인덱싱하고 싶다 | `include_paths`에 상대경로 추가 | "인덱스만 갱신해줘" 또는 `build-index.mjs --mode init` |
| 모노레포에 워크스페이스가 추가됐다 | `workspaces[]` 항목 추가, 필요하면 `include_paths`도 | 같음 |
| 업무 코드가 벤더로 오인돼 빠진다 | `"vendor_exclude": false` (전체를 끄는 방식이라 노드가 크게 늘 수 있음) | 재인덱싱 후 `_meta.excluded_sources`로 확인 |
| 테스트 코드의 호출 관계도 보고 싶다 | `"test_exclude": false` | 재인덱싱. `call_graph.json`이 커지고 데드코드 후보가 늘 수 있음 |
| 복잡도 점수가 스택을 못 잡는다 | `workspaces[].stack`에 실제 스택 이름 기입 | 재인덱싱 후 `_meta.json`의 tier 추천값 확인 |

편집 후에는 반드시 재인덱싱해야 반영됩니다. `include_paths`를 바꾸면 인덱스 소스 지문이 달라져 `--check-stale`이 `소스가 변경됨`을 돌려주므로, 팀원과 인덱스를 공유하고 있다면 설정 파일도 함께 커밋하세요.

## 주의사항

- `include_paths`는 루트 안쪽만 허용합니다. 루트 밖 경로를 넣으면 조용히 버려지므로 결과 인덱스의 `_meta.include_paths`로 반영 여부를 확인하세요.
- `init_layout`은 인덱서 동작을 바꾸지 않고 `_meta.json`에 기록되는 표기값입니다. 실제 범위는 `include_paths`와 `workspaces`가 결정합니다.
- 기존 인덱스의 `_meta.generator`가 `deterministic-indexer`가 아닐 때는 `--mode incremental` 대신 `--mode init`으로 다시 만들어야 합니다. 생성기마다 노드 id 체계가 달라 섞이면 안 됩니다.
- 파일을 지우면 다음 인덱싱은 루트 전체를 단일 워크스페이스로 처리합니다.

## 관련 문서

- [결정론적 인덱스](/concepts/deterministic-index.md)
- [인덱스 갱신](/configuration/index-refresh.md)
- [크로스 리포 설정](/configuration/pair-config.md)
- [인덱스 파일 스펙](/reference/index-spec.md)
- [harness-init](/skills/harness-init.md)
