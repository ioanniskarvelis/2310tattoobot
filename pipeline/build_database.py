from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI

from parse_conversations import parse_inbox
from vision_analyze import analyze_tattoo_image, load_prompt

_shutdown_requested = False


def _handle_signal(signum: int, frame: Any) -> None:
    global _shutdown_requested
    _shutdown_requested = True
    print("\nGraceful shutdown requested. Finishing current record...")


def setup_logger(log_path: Path) -> logging.Logger:
    logger = logging.getLogger("tattoo_pipeline")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(log_path, encoding="utf-8")
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.WARNING)
    console.setFormatter(formatter)
    logger.addHandler(console)
    return logger


def deep_get(data: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
        if current is None:
            return default
    return current


def flatten_vision_fields(vision: dict[str, Any]) -> dict[str, Any]:
    return {
        "color_present": deep_get(vision, ["ink_analysis", "color_present"], False),
        "natural_size_category": deep_get(vision, ["natural_size", "natural_size_category"], "medium"),
        "width_dominant": deep_get(vision, ["natural_size", "width_dominant"], False),
        "category_primary": deep_get(vision, ["style_category", "category_primary"], "other"),
        "category_secondary": deep_get(vision, ["style_category", "category_secondary"]),
        "tattoo_effort_score": deep_get(vision, ["tattoo_effort_score"], 50),
        "fill_density_per_area": deep_get(vision, ["fill_shading_analysis", "fill_density_per_area"], 0),
        "shading_density_per_area": deep_get(vision, ["fill_shading_analysis", "shading_density_per_area"], 0),
        "shading_scalability_score": deep_get(
            vision, ["fill_shading_analysis", "shading_scalability_score"], 0
        ),
        "micro_detail_score": deep_get(vision, ["detail_complexity", "micro_detail_score"], 0),
        "texture_density_score": deep_get(vision, ["detail_complexity", "texture_density_score"], 0),
        "line_density_score": deep_get(vision, ["line_analysis", "line_density_score"], 0),
        "edge_complexity_score": deep_get(vision, ["line_analysis", "edge_complexity_score"], 0),
        "line_thickness_category": deep_get(vision, ["line_analysis", "line_thickness_category"], "medium"),
        "has_text": deep_get(vision, ["text_features", "has_text"], False),
        "has_decorative_script": deep_get(vision, ["text_features", "has_decorative_script"], False),
        "overall_confidence": deep_get(vision, ["quality_control", "overall_confidence"], 0),
    }


def should_skip_vision_result(vision: dict[str, Any]) -> str | None:
    if vision.get("error") == "not_a_tattoo_reference":
        return "not_a_tattoo_reference"

    overall_conf = deep_get(vision, ["quality_control", "overall_confidence"], 1.0)
    if overall_conf < 0.50:
        return "low_confidence"

    qa_flags = deep_get(vision, ["quality_control", "qa_flags"], []) or []
    if "multiple_designs" in qa_flags:
        return "multiple_designs"

    return None


# ---------------------------------------------------------------------------
# Checkpoint: persists processed & permanently-skipped keys so restarts are
# instant and don't re-evaluate images that can never succeed.
# ---------------------------------------------------------------------------

def load_checkpoint(checkpoint_path: Path) -> dict[str, Any]:
    if not checkpoint_path.exists():
        return {"processed": [], "skipped_permanent": [], "version": 1}
    try:
        with checkpoint_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"processed": [], "skipped_permanent": [], "version": 1}


def save_checkpoint(checkpoint_path: Path, processed: list[str], skipped_permanent: list[str]) -> None:
    tmp = checkpoint_path.with_suffix(".tmp")
    data = {
        "version": 1,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "processed_count": len(processed),
        "skipped_permanent_count": len(skipped_permanent),
        "processed": processed,
        "skipped_permanent": skipped_permanent,
    }
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    tmp.replace(checkpoint_path)


# ---------------------------------------------------------------------------
# JSONL repair: remove an incomplete trailing line left by a mid-write crash.
# ---------------------------------------------------------------------------

def repair_jsonl(output_path: Path, logger: logging.Logger) -> None:
    if not output_path.exists() or output_path.stat().st_size == 0:
        return

    with output_path.open("r", encoding="utf-8") as fh:
        lines = fh.readlines()

    if not lines:
        return

    last_line = lines[-1]
    if not last_line.endswith("\n"):
        logger.warning("REPAIR: removed incomplete trailing line from %s", output_path)
        lines = lines[:-1]
        with output_path.open("w", encoding="utf-8") as fh:
            fh.writelines(lines)
            fh.flush()
            os.fsync(fh.fileno())
        return

    last_line = last_line.strip()
    if last_line:
        try:
            json.loads(last_line)
        except json.JSONDecodeError:
            logger.warning("REPAIR: removed corrupted trailing line from %s", output_path)
            lines = lines[:-1]
            with output_path.open("w", encoding="utf-8") as fh:
                fh.writelines(lines)
                fh.flush()
                os.fsync(fh.fileno())


# ---------------------------------------------------------------------------
# Atomic append: write a complete line then fsync before considering it done.
# ---------------------------------------------------------------------------

def append_record(out_fh: Any, record: dict[str, Any]) -> None:
    line = json.dumps(record, ensure_ascii=False) + "\n"
    out_fh.write(line)
    out_fh.flush()
    os.fsync(out_fh.fileno())


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

PERMANENT_SKIP_REASONS = {"missing_image_path", "image_not_found", "not_a_tattoo_reference", "multiple_designs"}


# ---------------------------------------------------------------------------
# Skipped-conversations tracker: plain txt with folder name + reason per line.
# ---------------------------------------------------------------------------

def load_skipped_conversations(path: Path) -> set[str]:
    if not path.exists():
        return set()
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            parts = line.strip().split(" | ", 1)
            if parts:
                seen.add(parts[0])
    return seen


def append_skipped_conversation(fh: Any, conversation_id: str, reason: str) -> None:
    fh.write(f"{conversation_id} | {reason}\n")
    fh.flush()


def build_database(
    inbox_dir: Path,
    owner_name: str,
    prompt_path: Path,
    output_path: Path,
    log_path: Path,
    checkpoint_path: Path,
    skipped_txt_path: Path,
    model: str,
    rate_limit_seconds: float,
    max_records: int | None,
) -> None:
    global _shutdown_requested

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger = setup_logger(log_path)

    print("Parsing conversations...")
    pairs = parse_inbox(inbox_dir=inbox_dir, owner_name=owner_name, lookahead_messages=10)
    total_candidates = len(pairs)
    logger.info("Parsed %s candidate image-price pairs.", total_candidates)
    print(f"Found {total_candidates} candidate image-price pairs.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    repair_jsonl(output_path, logger)

    checkpoint = load_checkpoint(checkpoint_path)
    seen_processed: set[str] = set(checkpoint.get("processed", []))
    seen_skipped: set[str] = set(checkpoint.get("skipped_permanent", []))
    seen_all = seen_processed | seen_skipped

    client = OpenAI()
    vision_prompt = load_prompt(prompt_path)
    processed = 0
    skipped = 0
    already_done = len(seen_all)
    start_time = time.time()

    if already_done:
        print(f"Resuming: {len(seen_processed)} processed + {len(seen_skipped)} permanently skipped from previous run.")

    already_logged_convos = load_skipped_conversations(skipped_txt_path)

    with output_path.open("a", encoding="utf-8") as out, \
         skipped_txt_path.open("a", encoding="utf-8") as skip_txt:

        def _record_skip(conv_id: str, reason: str) -> None:
            if conv_id not in already_logged_convos:
                append_skipped_conversation(skip_txt, conv_id, reason)
                already_logged_convos.add(conv_id)

        for pair_idx, pair in enumerate(pairs):
            if _shutdown_requested:
                print("Shutdown requested, saving progress...")
                break

            if max_records and processed >= max_records:
                break

            image_key = pair.image_path or pair.image_uri
            if image_key in seen_all:
                continue

            if not pair.image_path:
                skipped += 1
                seen_skipped.add(image_key)
                seen_all.add(image_key)
                _record_skip(pair.conversation_id, "missing_image_path")
                logger.info("SKIP missing_image_path | conversation=%s uri=%s", pair.conversation_id, pair.image_uri)
                continue

            image_path = Path(pair.image_path)
            if not image_path.exists():
                skipped += 1
                seen_skipped.add(image_key)
                seen_all.add(image_key)
                _record_skip(pair.conversation_id, "image_not_found")
                logger.info("SKIP image_not_found | path=%s", image_path)
                continue

            try:
                vision = analyze_tattoo_image(
                    image_path=image_path,
                    vision_prompt=vision_prompt,
                    client=client,
                    model=model,
                )
            except KeyboardInterrupt:
                _shutdown_requested = True
                print("\nInterrupted during API call, saving progress...")
                break
            except Exception as exc:
                skipped += 1
                _record_skip(pair.conversation_id, f"vision_error: {exc}")
                logger.info("SKIP vision_error | path=%s | error=%s", image_path, exc)
                continue

            skip_reason = should_skip_vision_result(vision)
            if skip_reason:
                skipped += 1
                _record_skip(pair.conversation_id, skip_reason)
                if skip_reason in PERMANENT_SKIP_REASONS:
                    seen_skipped.add(image_key)
                    seen_all.add(image_key)
                logger.info("SKIP %s | path=%s", skip_reason, image_path)
                continue

            flat = flatten_vision_fields(vision)
            record = {
                "record_id": str(uuid.uuid4()),
                "conversation_id": pair.conversation_id,
                "image_uri": pair.image_uri,
                "image_path": str(image_path),
                "price_low": pair.price_low,
                "price_high": pair.price_high,
                "final_price": pair.final_price,
                "owner_message": pair.owner_message,
                "image_message_timestamp_ms": pair.image_message_timestamp_ms,
                "price_message_timestamp_ms": pair.price_message_timestamp_ms,
                "vision_analysis": vision,
                "created_at": datetime.now(timezone.utc).isoformat(),
                **flat,
            }
            append_record(out, record)
            seen_processed.add(image_key)
            seen_all.add(image_key)
            processed += 1

            if processed % 10 == 0:
                save_checkpoint(checkpoint_path, list(seen_processed), list(seen_skipped))

            elapsed = time.time() - start_time
            total_done = len(seen_all)
            remaining = total_candidates - total_done
            rate = processed / elapsed if elapsed > 0 else 0
            eta_min = (remaining / rate / 60) if rate > 0 else 0
            print(
                f"\r[{total_done}/{total_candidates}] "
                f"processed={processed} skipped={skipped} "
                f"rate={rate:.1f}/s ETA={eta_min:.0f}min",
                end="",
                flush=True,
            )

            time.sleep(rate_limit_seconds)

    save_checkpoint(checkpoint_path, list(seen_processed), list(seen_skipped))
    elapsed_total = time.time() - start_time
    logger.info(
        "Done. processed=%s skipped=%s total_candidates=%s elapsed=%.1fs",
        processed, skipped, total_candidates, elapsed_total,
    )
    print(f"\nDone. Processed: {processed}, skipped: {skipped}, "
          f"candidates: {total_candidates}, elapsed: {elapsed_total:.0f}s")
    print(f"Database: {output_path}")
    print(f"Checkpoint: {checkpoint_path}")
    print(f"Skipped conversations: {skipped_txt_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build tattoo pricing database from Instagram exports.")
    parser.add_argument("--inbox-dir", default="inbox")
    parser.add_argument("--owner-name", default="2310tattoo studio by Christina")
    parser.add_argument("--prompt-file", default="pipeline/vision_prompt.txt")
    parser.add_argument("--output", default="pipeline/tattoo_database.jsonl")
    parser.add_argument("--log-file", default="pipeline/skips.log")
    parser.add_argument("--checkpoint", default="pipeline/checkpoint.json")
    parser.add_argument("--skipped-conversations", default="pipeline/skipped_conversations.txt")
    parser.add_argument("--model", default="gpt-5.4")
    parser.add_argument("--rate-limit-seconds", type=float, default=0.7)
    parser.add_argument("--max-records", type=int, default=None)
    args = parser.parse_args()

    build_database(
        inbox_dir=Path(args.inbox_dir).resolve(),
        owner_name=args.owner_name,
        prompt_path=Path(args.prompt_file).resolve(),
        output_path=Path(args.output).resolve(),
        log_path=Path(args.log_file).resolve(),
        checkpoint_path=Path(args.checkpoint).resolve(),
        skipped_txt_path=Path(args.skipped_conversations).resolve(),
        model=args.model,
        rate_limit_seconds=args.rate_limit_seconds,
        max_records=args.max_records,
    )


if __name__ == "__main__":
    main()
