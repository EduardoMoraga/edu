# Edu CLI for the cheil profile

This session is the cheil profile and has no Edu MCP server. Use the `edu` CLI.
`EDU_HOME` is the cheil home. Do not change `EDU_HOME`.
Do not read or write the personal vault.

## Each session

1. Run `edu brief` once and reuse it.
2. Search with `edu recall`. The command is `edu brain recall <query>`.
3. Open a note with `edu brain read <id>`.
4. Save a durable decision or lesson with `edu brain remember "<title>"`.

Memory is the notes this brain returns. Cite note ids. A hypothesis is not a fact.

## Join and sync

Join this profile only. In a sandbox, sync by hand. Do not install a schedule.
Do not run `edu join --install`.
Do not join the personal vault.

```bash
edu join --cloud --profile cheil --subdir _CONOCIMIENTO https://github.com/EduardoMCheil/cheil-vault.git
edu sync --cloud
```

The cheil remote is `EduardoMCheil/cheil-vault`.
