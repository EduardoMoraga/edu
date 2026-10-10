# Feature: edu-v3 — your orchestrator

**Objective:** The standalone orchestrator directs agents with the user's own development framework:
playbook → visible spec with requirements and deterministic checks → human approval → delegation by
role → Edu-run verification → cross-vendor review → learning. Triggerable from inside any CLI.

**Problem / why:** Real run (2026-10-10, `edu run "Create a file hello.js…"` with Claude) worked but:
builder could not run tests (autonomy `auto` = acceptEdits blocks Bash); outcome `unverified_success`
because the lead prompt forbids proposing checks; planning is generic, not the user's method; no
visible spec/approval; not reachable from the plugin. User: "quiero que sea mi propio orquestador
desde mi perspectiva y conocimiento".

**Scope:** playbooks in the brain (default derived from ODD/SDD, Albert claim bands, AI Harness
Engineering H3), spec files `.edu/specs/<slug>.md`, spec approval gate, lead-proposed deterministic
checks (approved with the spec, run by Edu), builder autonomy that can run tests, `edu_orchestrate`
MCP tool + `/edu:run`, Windows standalone diagnosis.

## Tasks
| ID | Task | Route | Owner | Status |
|---|---|---|---|---|
| O1 | Orchestrator core: playbook loader, spec file, approval with spec, lead-proposed checks, verify→fix loop, autonomy | delegated (mora → codex) | backend | ✅ |
| O2 | `edu_orchestrate` MCP tool + `edu run --detach` as crew jobs, watchable | delegated (mora → codex) | backend | ✅ |
| O3 | Default playbook content, `/edu:run` skill/command, README "Your orchestrator" (en/es), TUI spec card | delegated (mora → claude) | frontend | ✅ |
| O4 | Real-LLM acceptance (Claude solo, Codex+Claude crew), Windows standalone check, release v0.3.0 | lead | lead | ✅ |

## Acceptance
- `edu run "Create hello.js that prints hello"` with real Claude ends `autonomous_verified_success`:
  spec file written, checks run by Edu pass, builder verified its own work.
- Editing `.edu/playbooks/default.md` changes how the lead plans (visible in the spec).
- From Claude Code `/edu:run <goal>` starts an orchestration and reports its outcome.

## Progress / evidence
- O1 core + O3 content by crew; O2 blocked on scope → O5 integration task (T-0028) wired CLI, detached
  orchestration, edu_orchestrate / edu_crew_approve. 478 tests.
- Windows standalone bugs fixed and shipped as hotfix v0.2.3 (cmd.exe shim bypass, prompts on stdin,
  JSON drift on Edu-owned keys only).
- Real-LLM acceptance (Claude): `edu run "Create a file hello.js that prints hello" --yes` → spec with
  R-1/R-2 and lead-proposed checks C-1/C-2, builder reproduce→attribute→fix→verify, Edu-run checks
  pass, outcome `autonomous_verified_success`. From inside Claude (`edu_orchestrate`, autoApprove):
  goodbye.js job → `autonomous_verified_success`, 3/3 checks, review pass.
