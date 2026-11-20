# What changed in this pass, and what you need to do next

## 1. CRITICAL bug fixed: Stage 2 was crashing on every malicious prompt

**Root cause:** Stage 1 was upgraded to dual word+char TF-IDF (50,009
features), but `train_attack_type_model.py` was never updated to match —
it still expected the old single-vectorizer format (5,009 features).
Every classification of a malicious prompt crashed with:
`ValueError: X has 50009 features, but RandomForestClassifier is
expecting 5009 features`.

This is almost certainly why the dashboard showed "Unclassified" so
often, and may explain inconsistent attack-type displays.

**Fixed in:** `ml-service/app/train_attack_type_model.py` — now correctly
loads the `{word_vec, char_vec}` dict format, matching `classify.py`.

## 2. SQL injection — confirmed real gap, now fixed

Tested live before any fix: `' OR '1'='1'`, `'; DROP TABLE users; --`,
UNION-based payloads all scored **0.003–0.042 risk and were ALLOWED**.

**Fixed via three additions:**
- `features.py` — new `has_sql_injection_pattern` domain feature (regex,
  generalizes beyond exact training examples: auth-bypass, UNION SELECT,
  destructive DDL/DML, time-based blind, comment-based evasion, etc.)
- `data/build_sql_injection_dataset.py` — 67 synthetic examples (52
  malicious payloads + natural-language SQLi requests, 15 safe SQL
  questions as counter-examples). **Documented as synthetic, built from
  well-known public OWASP-style patterns — not claimed as an external
  benchmark.**
- `train_attack_type_model.py` — "SQL Injection" added as a real, labeled
  Stage 2 category (using actual ground truth from the new dataset, not
  just weak-supervision bootstrapping, for that subset)

Retested after the fix (reduced-scale verification): same payloads now
score **0.98–0.99 and correctly BLOCK**, with the real ML model (not a
keyword fallback) correctly labeling them `"SQL Injection"`.

## 3. Over-redaction bug fixed ("words get redacted")

**Root cause:** `response_filter.py`'s card-number rule matched ANY
13-19 digit number — no validation. Similarly, the Finance-mode IBAN rule
matched almost any 2-letter+2-digit+alphanumeric token (e.g. a product
code like `AB12XY9000`).

**Fixed:** both now validate against the REAL checksum algorithm for that
identifier type before redacting — Luhn for card numbers, ISO 7064
mod-97-10 for IBANs. A random 13-19 digit number now passes the filter
correctly; a real card/IBAN still gets redacted. Verified with test cases
including a 13-digit "loyalty number" and a 13-digit revenue figure that
were previously wrongly redacted and now correctly pass through.

## 4. Dashboard rendering bug (the bleeding colored rectangle)

Visible in two of your screenshots — a colored overlay bleeding across
chart boundaries into unrelated cards below. Likely cause: the Risk Score
Distribution bar chart's hover-cursor highlight combined with the
dashboard's 10-second auto-refresh — a re-render while the cursor overlay
is active can leave Recharts with a stale/oversized highlight rectangle.

**Fixed:** removed the cursor highlight (`cursor={false}`), and added
`overflow: hidden` to every chart card as defense-in-depth, so even an
unrelated future rendering quirk gets clipped to its own card instead of
bleeding into the page.

## 5. "Wrong prompt text in dashboard logs" — investigated, code looks correct now

Checked `pipelineShared.js` closely: it logs `promptTextForLLM` (the real
original prompt), never the display message. I could not find a current
code path that would produce this bug. It's most likely either an
artifact from before fix #1 (a crash earlier in the pipeline's history),
or test data from manually resubmitting a bot response as a new prompt
during exploration. **Please re-verify this specifically after retraining
with the fix below — if it still happens, send me a fresh screenshot and
I'll dig further with real reproduction steps.**

## 6. Rate limiting — confirmed already implemented, untouched

10 requests/minute, sliding-window violations, exponential backoff,
auto IP-ban after 5 violations in a 60s window. No changes made. Tell me
if you want the limit value changed or made visible in the UI.

---

## What you MUST do before using this build

**Adding the new SQL-injection feature changed the feature vector size
(9 → 10 domain features), which makes the existing 95.48% model
incompatible.** The system's own self-healing correctly detected this
during testing and auto-triggered a retrain — which is the system working
as designed, but it means a fresh training run is required; there is no
way around this given a new feature column was added.

**This sandbox is too slow to complete the full-scale training** (it
completed in 76 seconds on your machine previously; it timed out here
after several minutes). Run these two commands on your own machine:

```bash
cd ml-service/app
python train_model.py              # Stage 1 — now includes SQL injection data
python train_attack_type_model.py  # Stage 2 — now fixed, trains without crashing
```

This will produce real, fresh `vectorizer.pkl`, `ensemble_model.pkl`,
`attack_type_model.pkl`, `metrics.json`, and `attack_type_metrics.json` —
send me the new `metrics.json` once it finishes and I'll update the
research paper with the real numbers (including the honest FPR trade-off
discussion — see below).

## On "increase accuracy to 97-98%" — needs a decision from you first

Your current real FPR is **6.85%** (up from near-zero in an earlier
version) — meaning roughly 1 in 15 safe prompts get wrongly flagged. If I
push accuracy higher by brute-force (more features/trees) without
addressing this, FPR will likely get worse, not better, which is a bad
trade for a security tool reviewers will question. Before I touch this: do
you want (a) higher accuracy even if FPR holds steady or rises slightly,
or (b) accuracy improved specifically by *reducing* FPR (fewer false
alarms), which may land around 96-97% rather than 98% but is the more
defensible result in a viva?
