These fixtures are synthetic, secret-free examples shaped to the documented headless JSONL formats. They were not captured from live model calls or installed vendor CLIs.

`<cli>.jsonl` is a successful run. `<cli>-error.jsonl` is a failed run shaped like the CLI's real failure output (an auth, quota or rate-limit error): every adapter must end it with `ok: false` and the CLI's error text, never as a success.
