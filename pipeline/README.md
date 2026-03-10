# Pipeline

## 1) Install dependencies

```bash
pip install -r pipeline/requirements.txt
```

## 2) Set OpenAI key

```bash
set OPENAI_API_KEY=your_key_here
```

## 3) Optional dry run (parse only)

```bash
python pipeline/parse_conversations.py --inbox-dir inbox --output pipeline/parsed_pairs.jsonl
```

## 4) Build database

```bash
python pipeline/build_database.py --inbox-dir inbox --output pipeline/tattoo_database.jsonl
```

Useful flags:
- `--max-records 50` for testing
- `--rate-limit-seconds 1.0` to lower request rate
- `--owner-name "2310tattoo studio by Christina"` if account name changes
