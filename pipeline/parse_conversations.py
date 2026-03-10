from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

EURO_MOJIBAKE = "\u00e2\u0082\u00ac"

PRICE_EURO_REGEX = re.compile(r"(\d+(?:[.,]\d+)?)\s*€")
PRICE_EURO_WORD_REGEX = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:ευρώ|ευρω|euro|euros)", re.IGNORECASE)
PRICE_RANGE_REGEX = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:[-–—]|με|εως|έως|to|until)\s*(\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


@dataclass
class PricePair:
    conversation_id: str
    image_uri: str
    image_path: str | None
    price_low: float
    price_high: float
    final_price: float
    image_message_timestamp_ms: int | None
    price_message_timestamp_ms: int | None
    owner_message: str


def _normalize_euro(text: str) -> str:
    return text.replace(EURO_MOJIBAKE, "€")


def extract_price(text: str) -> tuple[float | None, float | None]:
    text = _normalize_euro(text or "")

    matches = PRICE_EURO_REGEX.findall(text)
    if not matches:
        matches = PRICE_EURO_WORD_REGEX.findall(text)

    if matches:
        values = [float(m.replace(",", ".")) for m in matches]
        if len(values) == 1:
            return values[0], values[0]
        return min(values), max(values)

    range_matches = PRICE_RANGE_REGEX.findall(text)
    if range_matches:
        all_values: list[float] = []
        for low_str, high_str in range_matches:
            low_val = float(low_str.replace(",", "."))
            high_val = float(high_str.replace(",", "."))
            if 20 <= low_val <= 2000 and 20 <= high_val <= 2000:
                all_values.extend([low_val, high_val])
        if all_values:
            return min(all_values), max(all_values)

    return None, None


_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"]


def _resolve_photo_path(conversation_dir: Path, inbox_dir: Path, uri: str) -> Path | None:
    normalized = (uri or "").replace("\\", "/")
    uri_path = Path(normalized)
    base_candidates = [
        conversation_dir / uri_path,
        inbox_dir / uri_path,
        conversation_dir / "photos" / uri_path.name,
    ]
    for candidate in base_candidates:
        if candidate.exists():
            return candidate.resolve()
        if not candidate.suffix:
            for ext in _IMAGE_EXTENSIONS:
                with_ext = candidate.with_suffix(ext)
                if with_ext.exists():
                    return with_ext.resolve()
    return None


def _iter_message_files(conversation_dir: Path) -> Iterable[Path]:
    for message_file in sorted(conversation_dir.glob("message_*.json")):
        if message_file.is_file():
            yield message_file


def parse_conversation_file(
    message_file: Path,
    inbox_dir: Path,
    owner_name: str,
    lookahead_messages: int = 10,
) -> list[PricePair]:
    with message_file.open("r", encoding="utf-8") as fh:
        conversation = json.load(fh)

    thread_path = conversation.get("thread_path") or f"inbox/{message_file.parent.name}"
    conversation_id = Path(thread_path).name
    messages = sorted(conversation.get("messages", []), key=lambda m: m.get("timestamp_ms", 0))
    conversation_dir = message_file.parent
    pairs: list[PricePair] = []

    for idx, message in enumerate(messages):
        photos = message.get("photos") or []
        sender = (message.get("sender_name") or "").strip()
        if not photos or sender == owner_name:
            continue

        price_low = price_high = None
        price_timestamp = None
        owner_message = ""
        for followup in messages[idx + 1 : idx + 1 + lookahead_messages]:
            if (followup.get("sender_name") or "").strip() != owner_name:
                continue
            low, high = extract_price(followup.get("content", ""))
            if low is None or high is None:
                continue
            price_low, price_high = low, high
            price_timestamp = followup.get("timestamp_ms")
            owner_message = followup.get("content", "")
            break

        if price_low is None or price_high is None:
            continue

        for photo in photos:
            uri = photo.get("uri", "")
            resolved_path = _resolve_photo_path(conversation_dir, inbox_dir, uri)
            final_price = round((price_low + price_high) / 2.0, 2)
            pairs.append(
                PricePair(
                    conversation_id=conversation_id,
                    image_uri=uri,
                    image_path=str(resolved_path) if resolved_path else None,
                    price_low=price_low,
                    price_high=price_high,
                    final_price=final_price,
                    image_message_timestamp_ms=message.get("timestamp_ms"),
                    price_message_timestamp_ms=price_timestamp,
                    owner_message=owner_message,
                )
            )

    return pairs


def parse_inbox(
    inbox_dir: Path,
    owner_name: str,
    lookahead_messages: int = 10,
) -> list[PricePair]:
    all_pairs: list[PricePair] = []
    for conversation_dir in sorted(inbox_dir.iterdir()):
        if not conversation_dir.is_dir():
            continue
        for message_file in _iter_message_files(conversation_dir):
            try:
                all_pairs.extend(
                    parse_conversation_file(
                        message_file=message_file,
                        inbox_dir=inbox_dir,
                        owner_name=owner_name,
                        lookahead_messages=lookahead_messages,
                    )
                )
            except Exception:
                # Keep parsing robust for malformed exports.
                continue
    return all_pairs


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract (image, price) pairs from Instagram inbox JSON.")
    parser.add_argument("--inbox-dir", default="inbox", help="Path to inbox directory.")
    parser.add_argument(
        "--owner-name",
        default="2310tattoo studio by Christina",
        help="Exact sender_name used by the studio account.",
    )
    parser.add_argument("--lookahead", type=int, default=10, help="Messages to scan after a client photo.")
    parser.add_argument("--output", default="pipeline/parsed_pairs.jsonl", help="Output JSONL path.")
    args = parser.parse_args()

    inbox_dir = Path(args.inbox_dir).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    pairs = parse_inbox(
        inbox_dir=inbox_dir,
        owner_name=args.owner_name,
        lookahead_messages=args.lookahead,
    )
    with output_path.open("w", encoding="utf-8") as fh:
        for pair in pairs:
            fh.write(json.dumps(asdict(pair), ensure_ascii=False) + "\n")

    print(f"Saved {len(pairs)} parsed pairs to {output_path}")


if __name__ == "__main__":
    main()
