# DECLASSIFIED: ARSENAL

A fictional classified-dossier style military technology encyclopedia UI, built to scale to
2,500+ vehicle records. React frontend + a Python/Wikipedia data pipeline that feeds it.

## Project structure

```
declassified-arsenal/
├── .github/
│   └── workflows/
│       └── deploy.yml             ← builds + publishes to GitHub Pages on push to main
├── public/
│   ├── logo.png                   ← seal, used in the navbar + card watermark
│   ├── blueprint-bg.png           ← cyan tech/radar grid, global bg + Blueprint Mode
│   ├── hangar-placeholder.png     ← fallback image #1 for vehicles without a photo
│   ├── hangar-placeholder-alt.png ← fallback image #2 (alternates per vehicle id)
│   └── data/
│       └── vehicles.json          ← the dataset the app fetches at runtime (4 demo records)
├── src/
│   ├── DeclassifiedArsenal.jsx    ← the whole UI: filters, grid, Dossier modal
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css                  ← Tailwind entry point
├── scripts/
│   ├── extractor_bot.py           ← Wikipedia → vehicles.json pipeline
│   ├── test_extractor.py          ← offline sanity check, no network needed
│   └── requirements.txt
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
└── vite.config.js
```

## Run the frontend

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open the printed local URL. You should see the 4 demo vehicles (J-8A, M1A2 Abrams, Merkava
Mk4, Eurofighter Typhoon) loaded from `public/data/vehicles.json`, with working filters,
search, and the Dossier modal's Blueprint Mode toggle.

```bash
npm run build      # production build → dist/
npm run preview    # serve that build locally
```

## Deploy to GitHub Pages

A ready-to-go workflow lives at `.github/workflows/deploy.yml`. It builds the site and
publishes it to GitHub Pages on every push to `main` — no separate hosting account needed.

One-time setup after you push this repo to GitHub:

1. Go to the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or re-run the workflow from the **Actions** tab). The site publishes to
   `https://<username>.github.io/<repo-name>/`.

Why the extra `--base` flag in the workflow: GitHub Pages serves a repo (not a custom
domain) under a subpath, e.g. `/declassified-arsenal/`, rather than at the domain root.
Every asset path in `DeclassifiedArsenal.jsx` is built through a small `asset()` helper
that reads Vite's `import.meta.env.BASE_URL`, so the same code works unmodified whether
`base` is `/` (local dev, Vercel, a custom domain) or `/<repo-name>/` (GitHub Pages) — the
workflow sets it automatically from the repo name, so there's nothing to edit by hand even
if you rename the repo.

Prefer Vercel or Netlify instead? Just don't enable the Pages workflow (or delete the
`.github/workflows` folder) — `npm run build` with no flags already produces a root-path
build that both of those platforms expect.

## Grow the dataset with the extractor

The frontend already fetches whatever is in `public/data/vehicles.json` — replacing that
file with more records is the entire integration point, no code changes needed.

```bash
cd scripts
pip install -r requirements.txt

# From a plain text file of Wikipedia page titles, one per line:
python extractor_bot.py --input titles.txt

# Or crawl an entire Wikipedia category:
python extractor_bot.py --category "Main battle tanks" --limit 500
```

To have it write the "Layman's Brief" with Claude instead of the templated fallback:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python extractor_bot.py --input titles.txt
```

Run without a key, or pass `--no-llm`, and it fills that field with a plain templated
sentence instead of failing — the pipeline is written to survive missing keys and
individual failed records at 2,500-record scale (see the module docstring in
`extractor_bot.py` for the full contract, retry/backoff behavior, and resume support via
`--resume`).

Sanity-check the pipeline's parsing logic without hitting the network at all:

```bash
python test_extractor.py
```

## Notes

- The three source images were supplied for this build and are already dropped into
  `public/` under the filenames the component expects — no asset wiring needed.
- Wikipedia's own content is CC BY-SA / GFDL licensed. If you publish data pulled through
  `extractor_bot.py` beyond an internal/personal project, check that you're satisfying that
  license's attribution requirements for anything taken verbatim from an article.
- This repo has no LICENSE file yet — add one before making the repo public if you want to
  set terms for reuse of your own code.
