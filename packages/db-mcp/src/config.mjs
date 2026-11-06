/*
 * DB 접속 설정 — 플러그인 설정(userConfig → AXNAVI_DB_* 환경 변수)과 프로젝트 `.env`(ORACLE_*)를 합친다.
 *
 * 프로젝트마다 DB 가 다를 수 있어 프로젝트 `.env` 가 플러그인 설정보다 우선한다(wikihub_db 와 같은 키).
 * 플러그인 설정을 비워 두면 Claude Code 가 `${user_config.x}` 를 빈 값이나 글자 그대로 넘길 수 있어 둘 다 빈 값으로 본다.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `${user_config.x}` 가 풀리지 않고 그대로 온 값, 공백뿐인 값은 설정하지 않은 것이다. */
function clean(/** @type {string | undefined} */ value) {
  const text = String(value ?? "").trim();
  return !text || /^\$\{[^}]*\}$/.test(text) ? "" : text;
}

/** `<root>/.env` 의 KEY=VALUE. 따옴표는 벗기고 `#` 주석 줄은 건너뛴다. */
export function readEnvFile(/** @type {string} */ root) {
  /** @type {Record<string, string>} */
  const values = {};
  const path = join(root, ".env");
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    values[m[1] ?? ""] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

/**
 * @typedef {{ type: "none" | "oracle", host: string, port: string, service: string, user: string, password: string,
 *   owners: string[], source: string, problems: string[] }} DbConfig
 */

/** @returns {DbConfig} */
export function loadDbConfig(/** @type {string} */ root, env = process.env) {
  const file = readEnvFile(root);
  const fromFile = Boolean(clean(file["ORACLE_HOST"]) && clean(file["ORACLE_USER"]));
  const pick = (/** @type {string} */ fileKey, /** @type {string} */ envKey) => (fromFile ? clean(file[fileKey]) : clean(env[envKey]));
  /* 지금은 Oracle 만 다룬다. 플러그인 설정은 호스트가 채워져 있으면 켜진 것으로 본다. */
  const type = fromFile || clean(env["AXNAVI_DB_HOST"]) ? "oracle" : "none";
  const config = {
    type: /** @type {"none" | "oracle"} */ (type),
    host: pick("ORACLE_HOST", "AXNAVI_DB_HOST"),
    port: pick("ORACLE_PORT", "AXNAVI_DB_PORT") || "1521",
    service: pick("ORACLE_SERVICE", "AXNAVI_DB_SERVICE"),
    user: pick("ORACLE_USER", "AXNAVI_DB_USER"),
    password: pick("ORACLE_PASSWORD", "AXNAVI_DB_PASSWORD"),
    owners: pick("ORACLE_OWNERS", "AXNAVI_DB_OWNERS").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
    source: fromFile ? `${join(root, ".env")} (ORACLE_*)` : "플러그인 설정 (/plugin configure ax-navi@ax-navi)",
    problems: /** @type {string[]} */ ([]),
  };
  if (config.type === "none") return config;
  for (const [key, label] of [["host", "호스트"], ["service", "서비스 이름"], ["user", "계정"]]) {
    if (!config[/** @type {"host"} */ (key)]) config.problems.push(`${label} 값이 비어 있습니다.`);
  }
  if (!config.password) {
    config.problems.push(fromFile && clean(file["ORACLE_PASSWORD_ENC"])
      ? "`.env` 의 ORACLE_PASSWORD_ENC(암호화 비밀번호)는 DB 도구가 읽지 못합니다. 플러그인 설정에 비밀번호를 넣거나 ORACLE_PASSWORD 를 쓰세요."
      : "비밀번호가 비어 있습니다.");
  }
  return config;
}

/** 비밀번호를 뺀 설정 요약 — 사용자에게 보여 줄 때 쓴다. */
export function describeConfig(/** @type {DbConfig} */ config) {
  if (config.type === "none") return "DB 연결이 설정되지 않았습니다. `/plugin configure ax-navi@ax-navi` 에서 Oracle 접속 정보를 넣거나, 프로젝트 `.env` 에 ORACLE_HOST·ORACLE_PORT·ORACLE_SERVICE·ORACLE_USER·ORACLE_PASSWORD(·ORACLE_OWNERS)를 두세요.";
  return `oracle ${config.user}@${config.host}:${config.port}/${config.service} · 대상 스키마 ${config.owners.join(", ") || `(계정 기본: ${config.user.toUpperCase()})`} · 출처 ${config.source}`;
}
