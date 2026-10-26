# Crew output artifacts

Crew job metadata holds a bounded, sanitized result preview. Final summaries and worker output are available as local artifacts through the MCP edu_crew_artifact tool. That tool accepts a job ID, artifact kind, and optional paging limits. A truncated response includes a next offset for the next page.

Output is filtered before it is persisted. The filter covers common private keys, bearer tokens, credential assignments, provider tokens, and known credential environment values. Long lines are omitted. This is a best-effort filter; unusual or split secrets and other private content may still remain. Existing artifacts are not retroactively sanitized.

If persistence fails, the job moves to a failed state rather than falling back to raw metadata. Worker MCP sessions block Edu memory writes and recursive Edu dispatch, but this guard does not control native CLI tools or other integrations. Pane output can include only the portion supplied by the pane API.
