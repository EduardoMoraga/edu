# Edu CLI for the personal profile

This session has no Edu MCP server. Use the `edu` CLI. The profile is personal.
`EDU_HOME` is the personal home. Do not change `EDU_HOME`.

## Each session

1. Run `edu brief` once and reuse it.
2. Search with `edu recall`. The command is `edu brain recall <query>`.
3. Open a note with `edu brain read <id>`.
4. Save a durable decision or lesson with `edu brain remember "<title>"`.

Memory is the notes this brain returns. Cite note ids. A hypothesis is not a fact.

## Join and sync

Join this profile only. In a sandbox, sync by hand. Do not install a schedule.
Do not run `edu join --install`.

```bash
edu join --cloud --profile personal --subdir 01-CONOCIMIENTO https://github.com/EduardoMoraga/edu-vault.git
edu sync --cloud
```

The personal remote is `EduardoMoraga/edu-vault`.
