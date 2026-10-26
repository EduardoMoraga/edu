# Windows note-lock reliability

Edu 3.0.0-rc.1 retries transient contention while acquiring a note lock on Windows. It does not treat EPERM as proof that a lock is stale. The new deterministic tests cover the retry behavior and a concurrent case that failed on the earlier baseline. This is a reliability fix, not a general performance claim.
