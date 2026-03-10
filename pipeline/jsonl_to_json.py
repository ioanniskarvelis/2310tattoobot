from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def find_image(image_path: str, inbox_dir: Path) -> Path | None:
    src = Path(image_path)
    if src.exists():
        return src

    filename = src.name
    conv_id = src.parent.parent.name if src.parent.name == "photos" else None

    if conv_id:
        candidate = inbox_dir / conv_id / "photos" / filename
        if candidate.exists():
            return candidate

    for match in inbox_dir.rglob(filename):
        if match.is_file():
            return match

    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert JSONL tattoo database to JSON array for web app.")
    parser.add_argument("--input", default="pipeline/tattoo_database.jsonl")
    parser.add_argument("--output", default="web/src/data/tattoo_database.json")
    parser.add_argument("--images-dir", default="web/public/images")
    parser.add_argument("--inbox-dir", default="inbox")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    images_dir = Path(args.images_dir).resolve()
    inbox_dir = Path(args.inbox_dir).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    records = []
    with input_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))

    copied = 0
    skipped = 0
    for record in records:
        record_id = record.get("record_id")
        image_path = record.get("image_path")
        if not record_id or not image_path:
            skipped += 1
            continue

        src = find_image(image_path, inbox_dir)
        if not src:
            skipped += 1
            continue

        ext = src.suffix or ".jpg"
        dest = images_dir / f"{record_id}{ext}"
        if not dest.exists():
            shutil.copy2(src, dest)
            copied += 1

    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(records, fh, ensure_ascii=False)

    print(f"Wrote {len(records)} records to {output_path}")
    print(f"Copied {copied} new images ({skipped} skipped) to {images_dir}")


if __name__ == "__main__":
    main()
