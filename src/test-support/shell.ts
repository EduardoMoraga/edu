/**
 * Check commands for tests that behave the same under cmd.exe and sh. Node is always present while
 * the suite runs; POSIX tools (printf, test, true, sleep) are not on Windows unless Git's usr/bin is
 * on PATH. Scripts must not contain double quotes.
 */
export const nodeCommand = (script: string): string => `"${process.execPath}" -e "${script}"`;

/** Writes `text` to stdout without a newline, like `printf text`. */
export const printCommand = (text: string): string => nodeCommand(`process.stdout.write('${text}')`);
