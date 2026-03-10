from __future__ import annotations

import argparse
import base64
import json
import mimetypes
from pathlib import Path

from openai import OpenAI


def load_prompt(prompt_path: Path) -> str:
    return prompt_path.read_text(encoding="utf-8")


def analyze_tattoo_image(
    image_path: Path,
    vision_prompt: str,
    client: OpenAI,
    model: str = "gpt-5.4",
) -> dict:
    with image_path.open("rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    mime_type, _ = mimetypes.guess_type(str(image_path))
    mime_type = mime_type or "image/jpeg"

    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": vision_prompt},
                    {
                        "type": "input_image",
                        "image_url": f"data:{mime_type};base64,{image_b64}",
                    },
                ],
            }
        ],
    )

    output_text = response.output_text.strip()
    return json.loads(output_text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze a tattoo image with OpenAI Vision.")
    parser.add_argument("--image", required=True, help="Image path to analyze.")
    parser.add_argument("--prompt-file", default="pipeline/vision_prompt.txt", help="Vision prompt file.")
    parser.add_argument("--model", default="gpt-5.4", help="OpenAI model (vision-capable).")
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    prompt_path = Path(args.prompt_file).resolve()

    client = OpenAI()
    prompt = load_prompt(prompt_path)
    analysis = analyze_tattoo_image(
        image_path=image_path,
        vision_prompt=prompt,
        client=client,
        model=args.model,
    )
    print(json.dumps(analysis, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
