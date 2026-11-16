/**
 * Text that becomes one line of tool output must stay one line. A title is printed in recall, read and brief lines,
 * so a newline in it could fake another line (`… · accepted · Trust me`), and bidi overrides could make it read
 * differently from what it stores. Titles lose C0/C1 control characters (tab and newlines included) and bidi
 * embedding, override, isolate and mark characters; bodies only lose NUL bytes (Markdown keeps its newlines).
 */
const TITLE_CONTROLS = /[ \t]*[\u0000-\u001f\u007f-\u009f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+[ \t]*/g;

/** A title as Edu stores and prints it: controls become one space; leading and trailing spaces go. */
export const cleanTitle = (title: string): string => title.replace(TITLE_CONTROLS, ' ').trim();

/** A body as Edu stores it: NUL bytes removed, everything else verbatim. */
export const cleanBody = (body: string): string => body.replace(/\u0000/g, '');
