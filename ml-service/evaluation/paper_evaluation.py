"""
paper_evaluation.py
--------------------
Regenerates every number used in the research paper from the CURRENT trained
models, so the paper can be refreshed after any retraining.

It reproduces the exact held-out test split used by train_model.py
(same data assembly, same random_state=42 stratified 80/20 split), loads
the saved vectorizers + stacking ensemble, and writes:
  evaluation/results.json   - confusion matrix, metrics, ROC-AUC, threshold sweep,
                              per-source breakdown, deployed ALLOW/WARN/BLOCK matrix,
                              held-out SQL-injection test
  evaluation/curves.npz     - ROC / PR curve arrays (for plotting)

Usage (from ml-service/):
    python evaluation/paper_evaluation.py
Options:
    --app-dir   folder containing features.py / preprocess.py / models/  (default ../app)
    --no-sqli   do not merge dataset_sql_injection.csv (use for models trained before SQLi was added)
"""
import argparse, json, os, re, sys
import numpy as np, pandas as pd, joblib
from scipy.sparse import csr_matrix, hstack
from sklearn.model_selection import train_test_split
from sklearn.metrics import (confusion_matrix, roc_auc_score, average_precision_score,
                             roc_curve, precision_recall_curve)

ap = argparse.ArgumentParser()
ap.add_argument("--app-dir", default=os.path.join(os.path.dirname(__file__), "..", "app"))
ap.add_argument("--no-sqli", action="store_true")
ap.add_argument("--out-dir", default=os.path.dirname(__file__))
args = ap.parse_args()
APP = os.path.abspath(args.app_dir)
sys.path.insert(0, APP)
from preprocess import preprocess
from features import extract_features_batch, extract_features

DATA = os.path.join(APP, "data")
MODELS = os.path.join(APP, "models")

# ---- 1. rebuild the dataset exactly as train_model.py does -----------------
df = pd.read_csv(os.path.join(DATA, "dataset_finred.csv")).dropna(subset=["text", "label"]).drop_duplicates(subset=["text"])
pii = pd.read_json(os.path.join(DATA, "pii_masking_200k", "english_pii_43k.jsonl"), lines=True)
T = {"ACCOUNTNUMBER", "BIC", "CREDITCARDNUMBER", "CREDITCARDCVV", "IBAN", "PASSWORD", "PIN", "SSN"}
pii["label"] = pii["privacy_mask"].apply(lambda m: any(e.get("label") in T for e in m)).astype(int)
pii = pii[["source_text", "label"]].dropna().drop_duplicates(subset=["source_text"]).rename(columns={"source_text": "text"})
pii = pii[pii.label == 1].assign(source="PII", finred_category=np.nan)
df = pd.concat([df, pii], ignore_index=True).drop_duplicates(subset=["text"])
sqli_path = os.path.join(DATA, "dataset_sql_injection.csv")
if os.path.exists(sqli_path) and not args.no_sqli:
    sq = pd.read_csv(sqli_path)[["text", "label"]].assign(source="SQLi_synthetic", finred_category=np.nan)
    df = pd.concat([df, sq], ignore_index=True).drop_duplicates(subset=["text"])
tr, te = train_test_split(df, test_size=0.2, random_state=42, stratify=df["label"])
print(f"dataset {len(df)} rows | train {len(tr)} | test {len(te)}")

# ---- 2. score the test set --------------------------------------------------
vec = joblib.load(os.path.join(MODELS, "vectorizer.pkl"))
model = joblib.load(os.path.join(MODELS, "ensemble_model.pkl"))

def feats(texts, clean):
    w = vec["word_vec"].transform(clean); c = vec["char_vec"].transform(clean)
    return hstack([w, c, csr_matrix(extract_features_batch(texts))], format="csr")

p = model.predict_proba(feats(te["text"], te["text"].astype(str).apply(preprocess)))[:, 1]
y = te["label"].values
te = te.assign(p=p)

def at(th):
    pr = (p >= th).astype(int)
    tp = int(((pr == 1) & (y == 1)).sum()); fp = int(((pr == 1) & (y == 0)).sum())
    fn = int(((pr == 0) & (y == 1)).sum()); tn = int(((pr == 0) & (y == 0)).sum())
    return dict(threshold=th, accuracy=(tp + tn) / len(y), precision=tp / max(tp + fp, 1), recall=tp / max(tp + fn, 1),
                fpr=fp / max(fp + tn, 1), f1=2 * tp / max(2 * tp + fp + fn, 1), tp=tp, fp=fp, fn=fn, tn=tn)

res = {"n_train": len(tr), "n_test": len(te), "n_safe_total": int((df.label == 0).sum()), "n_malicious_total": int((df.label == 1).sum()),
       "headline_at_0.5": at(0.5), "sweep": [at(t) for t in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)],
       "roc_auc": float(roc_auc_score(y, p)), "avg_precision": float(average_precision_score(y, p))}
res["per_source"] = {s: dict(n=int(len(g)), n_malicious=int(g.label.sum()), accuracy=float(((g.p.values >= .5) == g.label.values).mean()))
                     for s, g in te.groupby("source")}
act = np.where(p >= .7, "BLOCK", np.where(p >= .4, "WARN", "ALLOW"))
res["deployed_actions"] = {lab: {a: int(((y == v) & (act == a)).sum()) for a in ("ALLOW", "WARN", "BLOCK")} for lab, v in (("safe", 0), ("malicious", 1))}

# ---- 3. held-out SQL-injection test (strings NOT in dataset_sql_injection.csv)
ho_path = os.path.join(os.path.dirname(__file__), "sqli_heldout.json")
if os.path.exists(ho_path):
    ho = json.load(open(ho_path)); texts = ho["mal"] + ho["safe"]; n = len(ho["mal"])
    s = model.predict_proba(feats(texts, [preprocess(t) for t in texts]))[:, 1]
    res["sqli_heldout"] = dict(n_malicious=n, n_safe=len(ho["safe"]),
        detect_flag=float((s[:n] >= .4).mean()), detect_block=float((s[:n] >= .7).mean()),
        false_flag=float((s[n:] >= .4).mean()), false_block=float((s[n:] >= .7).mean()))

fpr, tpr, _ = roc_curve(y, p); prc, rec, _ = precision_recall_curve(y, p)
np.savez(os.path.join(args.out_dir, "curves.npz"), fpr=fpr, tpr=tpr, prc=prc, rec=rec)
json.dump(res, open(os.path.join(args.out_dir, "results.json"), "w"), indent=2)
h = res["headline_at_0.5"]
print(f"acc {h['accuracy']:.4f} prec {h['precision']:.4f} rec {h['recall']:.4f} f1 {h['f1']:.4f} fpr {h['fpr']:.4f} | AUC {res['roc_auc']:.4f}")
print("confusion matrix [[tn fp],[fn tp]]:", [[h['tn'], h['fp']], [h['fn'], h['tp']]])
print("per-source:", {k: round(v['accuracy'], 4) for k, v in res["per_source"].items()})
print("saved results.json + curves.npz")
