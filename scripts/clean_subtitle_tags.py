"""Clean [n1] / [#1] tags from translated subtitle segments."""
import sqlite3
import re

conn = sqlite3.connect("data/library.db")
rows = conn.execute(
    "SELECT id, translated_text FROM subtitle_segments WHERE translated_text LIKE '%[n%'"
).fetchall()
print(f"Found {len(rows)} segments with [n] tags")

updated = 0
for row_id, text in rows:
    cleaned = re.sub(r"^\[(?:n|#)?\d+\]\s*", "", text.strip(), flags=re.IGNORECASE)
    if cleaned != text:
        conn.execute(
            "UPDATE subtitle_segments SET translated_text = ? WHERE id = ?",
            (cleaned, row_id),
        )
        updated += 1
        print(f"  #{row_id}: {text[:50]!r} -> {cleaned[:50]!r}")

conn.commit()
conn.close()
print(f"Cleaned {updated} segments")
