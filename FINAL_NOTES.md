# Final package notes

This zip contains the complete project with every fix and addition from the review pass.
The UI now uses the Orange + White theme (see the "UI theme" section below); functionality is unchanged.

## What is included
- Stage 2 crash fix (`train_attack_type_model.py` now uses the dual word+char vectorisers)
- SQL-injection detection: new feature in `features.py`, synthetic set
  `data/dataset_sql_injection.csv` (+ builder script), new "SQL Injection" Stage 2 category
- Redaction fix in `response_filter.py` (Luhn for cards, mod-97 for IBANs instead of shape-only rules)
- Dashboard fix: removed the stale hover-cursor rectangle and added `overflow-hidden` to chart cards (a bug fix, separate from the theme)
- Whitespace-normalised regex matching (OCR/document line breaks no longer defeat patterns)
- `ml-service/evaluation/` : `paper_evaluation.py` regenerates every number in the paper
- `docs/` : updated IEEE paper (DOCX + PDF) and detailed fix notes (`FIXES_DETAIL.md`)

## IMPORTANT: models are not included - train once before first use
Adding the SQL-injection feature changed the feature count (9 -> 10 domain features), so the old
95.48% model files are incompatible and were removed. Training could not be completed in the
sandbox used to prepare this zip (it took 76 s on your machine before).

Option A - Docker (trains automatically during the image build):
    docker compose up --build
Option B - manual:
    cd ml-service/app
    python train_model.py
    python train_attack_type_model.py
Then (optional, refreshes the paper numbers):
    cd ml-service && python evaluation/paper_evaluation.py     # writes evaluation/results.json
Send `results.json` back to update the paper's tables and abstract.

## Known open items
- Rate limiting already exists (10 requests/min per user/IP, backoff, IP ban) - unchanged.
- "Wrong prompt text in dashboard logs": current code logs the original prompt; could not reproduce.
  Re-check after retraining.
- Accuracy target 97-98%: current false-positive rate is 6.85% on the original corpus; see paper Sec. V-D / VI.

## UI theme (added)
The Orange + White theme is applied (light and dark modes). Details: docs/THEME_CHANGES.md.
Optional black sidebar: set data-sidebar="dark" in frontend/index.html.
