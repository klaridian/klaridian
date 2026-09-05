#!/usr/bin/env python3
"""Fix em-dash spacing in Markdown prose: ' — ' -> '—' (Microsoft Style Guide).

Skips fenced code blocks (```...```) and inline code spans (`...`) so
literal dashes inside code/commands are never touched. Idempotent.
"""
import re
import sys

EM_DASH_SPACED = re.compile(r"(?<!`) — (?!`)")


def fix_line_outside_code(line: str) -> str:
    """Replace ' — ' with '—' only in segments outside inline `code`.

    Also handles a trailing ' —' at end-of-line (soft-wrapped prose,
    common in Markdown) by treating the line boundary as implicit
    whitespace.
    """
    parts = line.split("`")
    for i in range(0, len(parts), 2):
        parts[i] = parts[i].replace(" — ", "—")
    line = "`".join(parts)
    # Trailing ' —' right before the newline (or end of string)
    line = re.sub(r" —(\n?)$", r"—\1", line)
    return line


def fix_file(path: str) -> int:
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()

    in_fence = False
    fence_marker = None
    changed = 0
    out = []
    for line in lines:
        stripped = line.lstrip()
        is_fence_line = stripped.startswith("```") or stripped.startswith("~~~")
        if is_fence_line:
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = None
            out.append(line)
            continue

        if in_fence:
            out.append(line)
            continue

        new_line = fix_line_outside_code(line)
        if new_line != line:
            changed += 1
        out.append(new_line)

    with open(path, "w", encoding="utf-8") as f:
        f.writelines(out)

    return changed


if __name__ == "__main__":
    total = 0
    for path in sys.argv[1:]:
        n = fix_file(path)
        print(f"{path}: {n} lines changed")
        total += n
    print(f"TOTAL: {total} lines changed across {len(sys.argv[1:])} files")
