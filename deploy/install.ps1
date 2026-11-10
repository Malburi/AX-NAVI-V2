# 공유폴더에 올라온 ax-navi 를 이 PC 로 복사해 마켓플레이스로 등록하고 플러그인을 설치·갱신한다.
#
# 사용자는 install.cmd 를 실행하기만 하면 된다. 다시 실행하면 새 판으로 갱신한다.
# 공유폴더를 바로 등록하지 않고 로컬로 복사하는 이유: Claude Code 는 네트워크 경로 마켓플레이스를 기본으로 거부하고,
# 등록하더라도 플러그인을 그 폴더에서 바로 실행하는데 Node 가 UNC 경로의 DB 도구(.mjs)를 띄우지 못한다.
# 공유폴더에 deploy\oracle-driver\node_modules\oracledb 가 있으면 DB 드라이버도 같이 복사한다(폐쇄망용).
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Plugin = "ax-navi@ax-navi"
$Source = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd("\")
$Local = Join-Path $env:LOCALAPPDATA "ax-navi\marketplace"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say ""; Say "[실패] $text" "Red"; exit 1 }
function Invoke-Claude([string[]] $argv) {
  # stderr 를 오류 객체로 바꿔 멈추지 않게 하고, JSON 을 읽을 수 있도록 stdout 과 나눠 둔다.
  $ErrorActionPreference = "Continue"
  $all = & claude @argv 2>&1
  $out = ($all | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] }) | Out-String
  if ($LASTEXITCODE -ne 0) { Fail "claude $($argv -join ' ') 가 실패했습니다.`n$($all | Out-String)" }
  return $out
}

Say "AX-NAVI 플러그인 설치" "Cyan"
Say "원본 폴더: $Source"

# 1. 원본과 필요한 프로그램 확인
$manifest = Join-Path $Source ".claude-plugin\plugin.json"
if (-not (Test-Path (Join-Path $Source ".claude-plugin\marketplace.json")) -or -not (Test-Path $manifest)) {
  Fail "원본 폴더에 .claude-plugin\marketplace.json 이 없습니다. 공유폴더에 저장소 전체가 올라가 있는지 관리자에게 확인하세요."
}
$version = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
Say "올라와 있는 판: $version"
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Fail "claude 명령을 찾지 못했습니다. Claude Code 를 먼저 설치하고 새 창에서 다시 실행하세요."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "node 명령을 찾지 못했습니다. Node.js 18 이상을 먼저 설치하고 새 창에서 다시 실행하세요(플러그인 도구가 Node 로 돈다)."
}

# 2. 공유폴더 → 이 PC 로 복사(바뀐 파일만, 원본에 없는 파일은 지운다)
Say ""
Say "[1/4] 이 PC 로 복사: $Local" "Cyan"
& robocopy $Source $Local /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP /XD .git (Join-Path $Source "deploy\oracle-driver") | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "공유폴더를 복사하지 못했습니다(robocopy 코드 $LASTEXITCODE). 열려 있는 Claude Code 를 닫고 다시 실행하세요." }
Say "  복사했습니다."

# 3. 마켓플레이스 등록. 같은 이름이 다른 곳(GitHub 등)을 가리키면 지우고 이 PC 의 복사본으로 다시 등록한다.
Say ""
Say "[2/4] 마켓플레이스 등록" "Cyan"
$existing = (Invoke-Claude @("plugin", "marketplace", "list", "--json") | ConvertFrom-Json) | Where-Object { $_.name -eq "ax-navi" }
if ($existing -and $existing.path -and ([IO.Path]::GetFullPath($existing.path).TrimEnd("\") -ieq $Local)) {
  Invoke-Claude @("plugin", "marketplace", "update", "ax-navi") | Out-Null
  Say "  이미 등록돼 있어 목록만 새로 읽었습니다."
} else {
  if ($existing) {
    Say "  기존 ax-navi 마켓플레이스($($existing.source))를 지우고 이 PC 의 복사본으로 바꿉니다."
    Invoke-Claude @("plugin", "marketplace", "remove", "ax-navi") | Out-Null
  }
  Invoke-Claude @("plugin", "marketplace", "add", $Local) | Out-Null
  Say "  등록했습니다."
}

# 4. 플러그인 설치 또는 갱신(사용자 범위 — 모든 프로젝트에서 쓴다)
Say ""
Say "[3/4] 플러그인 설치" "Cyan"
$installed = (Invoke-Claude @("plugin", "list", "--json") | ConvertFrom-Json) | Where-Object { $_.id -eq $Plugin -and $_.scope -eq "user" }
if ($installed) {
  Invoke-Claude @("plugin", "update", $Plugin, "--scope", "user") | Out-Null
  if ($installed.version -eq $version) { Say "  이미 최신판($version)입니다." } else { Say "  $($installed.version) 에서 $version 으로 갱신했습니다." }
} else {
  Invoke-Claude @("plugin", "install", $Plugin, "--scope", "user") | Out-Null
  Say "  설치했습니다."
}

# 5. DB 드라이버(선택). 공유폴더에 준비돼 있을 때만 복사한다. 없으면 처음 DB 도구를 쓸 때 npm 으로 받는다.
Say ""
Say "[4/4] Oracle DB 드라이버" "Cyan"
$driverSrc = Join-Path $PSScriptRoot "oracle-driver\node_modules\oracledb"
$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$dataDir = Join-Path $configDir "plugins\data\ax-navi-ax-navi"
$driverDst = Join-Path $dataDir "node_modules\oracledb"
if (-not (Test-Path $driverSrc)) {
  Say "  공유폴더에 드라이버가 없어 건너뜁니다(DB 도구를 처음 쓸 때 npm 으로 받습니다)."
} else {
  $srcVer = (Get-Content (Join-Path $driverSrc "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $dstPkg = Join-Path $driverDst "package.json"
  $dstVer = if (Test-Path $dstPkg) { (Get-Content $dstPkg -Raw -Encoding UTF8 | ConvertFrom-Json).version } else { "" }
  if ($srcVer -eq $dstVer) {
    Say "  oracledb $srcVer 가 이미 있습니다."
  } else {
    New-Item -ItemType Directory -Force (Join-Path $dataDir "node_modules") | Out-Null
    if (Test-Path $driverDst) { Remove-Item -Recurse -Force $driverDst }
    Copy-Item -Recurse $driverSrc $driverDst
    $pkg = Join-Path $dataDir "package.json"
    if (-not (Test-Path $pkg)) { '{ "name": "ax-navi-data", "private": true }' | Out-File -Encoding ascii $pkg }
    Say "  oracledb $srcVer 를 복사했습니다."
  }
}

Say ""
Say "완료: ax-navi $version" "Green"
Say "열려 있는 Claude Code 를 모두 닫고 다시 실행하세요."
Say "DB 를 쓰려면 Claude Code 에서 /plugin configure ax-navi@ax-navi 로 접속 정보를 넣으세요."
