import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGuardDecision } from "../../../packages/core/src/safety/write-guard.mjs";

export async function test(register, assert) {
  register("셸 소스 쓰기 훅이 변수에 담긴 플러그인 경로를 풀고, 소스 쓰기는 계속 묻는다", () => {
    const base = mkdtempSync(join(tmpdir(), "ax-write-guard-"));
    try {
      const plugin = join(base, "plugin").replace(/\\/g, "/");
      const project = join(base, "project").replace(/\\/g, "/");
      mkdirSync(join(plugin, "agents", "lib"), { recursive: true });
      mkdirSync(project, { recursive: true });
      writeFileSync(join(plugin, "agents", "lib", "stack_precheck.py"), "open('x', 'w')\n", "utf8");
      const opts = { cwd: project, roots: [project], pluginRoot: plugin };
      const decide = (command) => writeGuardDecision("Bash", { command }, opts).hookSpecificOutput?.permissionDecision ?? "pass";

      /* SelfLearning harness-init 실측 — pipeline-runner 가 경로를 P 에 담아 불러 확인 창이 떴다. */
      const cases = [
        [`cd ${project}; P="${plugin}"\npython "$P/agents/lib/stack_precheck.py" --root . 2>&1 | tail -15\necho '{"a": 1}' > _workspace/indexer-config.json`, "pass"],
        [`P=${plugin} && node "\${P}/agents/lib/build-index.mjs" --root .`, "pass"],
        [`export P="${plugin}"; python "$P/agents/lib/stack_precheck.py"`, "pass"],
        [`T=src/Main.java; echo x > "$T"`, "ask"],
        [`P="${plugin}"; python "$P/agents/lib/../../evil.py"`, "ask"],
        [`P=$(pwd); echo x > "$P/src/a.java"`, "ask"],
        [`python "$Q/agents/lib/stack_precheck.py"`, "ask"],
        [`python -c "open('src/a.java','w').write('x')"`, "ask"],
      ];
      for (const [command, want] of cases) assert.equal(decide(command), want, command.split("\n")[0]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}
