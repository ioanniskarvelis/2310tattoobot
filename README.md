# Tattoo Pricing Prediction System

This project contains:
- `pipeline/`: Python pipeline to build a tattoo pricing dataset from Instagram exports.
- `web/`: Next.js web app for employees to upload a new tattoo and get a price suggestion.

## 1) Build the database (local)

1. Install Python dependency:
   - `pip install -r pipeline/requirements.txt`
2. Set your OpenAI API key:
   - Windows PowerShell: `$env:OPENAI_API_KEY="..."`
3. Run pipeline:
   - `python pipeline/build_database.py --inbox-dir inbox --output pipeline/tattoo_database.jsonl`
4. Convert JSONL to web JSON:
   - `python pipeline/jsonl_to_json.py --input pipeline/tattoo_database.jsonl --output web/src/data/tattoo_database.json`

## 2) Run web app (local)

1. Create env file:
   - `copy web/.env.example web/.env.local`
2. Set `OPENAI_API_KEY` in `web/.env.local`.
3. Install web dependencies:
   - `cd web && npm install`
4. Start dev server:
   - `npm run dev`

## 3) Deploy to Netlify

- Netlify config is in `netlify.toml` (base directory is `web`).
- In Netlify site settings, add environment variable:
  - `OPENAI_API_KEY`
- Optional:
  - `IMAGE_BASE_URL` if you host historical images and want thumbnails.
