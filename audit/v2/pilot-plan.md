# Pre-registered behavioral transfer pilot (not a native-harness cost benchmark)

Purpose: exercise the new session-close learning path with actual Codex and Claude models, not a scripted Engine. The models access the real Edu MCP server through a development stdio bridge (`scripts/mcp-call.mjs`). This does NOT validate native plugin discovery/cache reload.

Two independent teacher sessions solve three synthetic service-policy cases, observe an external oracle, and close via MCP with at most three inferred candidate lessons. A fresh student session per family/arm answers ten held-out cases. Both arms receive identical source policy and inputs; source-only can obtain all facts legitimately without memory. The warm arm additionally gets the teacher's persisted brain snapshot. No previous model conversation/history is passed to students.

Arms are named `source-only` and `edu-memory`, NOT `native-clean`: all jobs retain Cloudroom's outer instructions. This is a content-availability ablation, not clean installation/uninstallation or a full plugin A/B. One trajectory per family/arm is a small functional pilot, not an estimate of general improvement; ten cases in one trajectory are not ten independent model replications.

External grading: exact JSON output over cache-key normalization, TTL, retry conditions and retention, evaluated by `scripts/pilot-oracle.mjs`. Students may read the policy but may not inspect/run the oracle or read other arm/teacher directories. The oracle remains external to their outputs. Teachers may run it on seed cases (maximum two correction rounds), derive useful observations, then call real `edu_session_close` with structured lessons. No correctness claim from the model is accepted as the grade.

Known limitations: shared filesystem task boundaries are instructions, not adversarial isolation; model/provenance labels are launch metadata; native memory/plugin auto-discovery is not exercised; usage/billed cost may not be exposed by the harness. Missing cost/usage is `null`, not zero. Wall-clock completion includes scheduling/queue effects and is not a defensible speed comparison.

Report all arms, errors, stored lesson counts and external grades, even if source-only wins or they tie. No financial-efficiency claim; do not coerce these arms into the production eval contract's clean-native/measured-cost categories. Raw fixture data and outputs are synthetic, without personal/work memory or credentials. No new agent CLI is launched except Cloudroom child threads.
