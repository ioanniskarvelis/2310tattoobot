from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert JSONL tattoo database to JSON array for web app.")
    parser.add_argument("--input", default="pipeline/tattoo_database.jsonl")
    parser.add_argument("--output", default="web/src/data/tattoo_database.json")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    records = []
    with input_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))

    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(records, fh, ensure_ascii=False)

    print(f"Wrote {len(records)} records to {output_path}")


if __name__ == "__main__":
    main()
