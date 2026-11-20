"""
train_attack_type_model.py
----------------------------
Stage 2 of the two-level modeling system: attack-type classification.

Previously, "attack type" shown on the dashboard (Prompt Injection /
Jailbreak / Data Extraction / Role Manipulation) was NOT machine-learned —
it was a plain keyword/regex guess applied after the real ML decision
(see the old guess_attack_type() in classify.py). This script replaces
that with a genuinely trained multi-class classifier.

Honest methodology note (read this before citing results): the dataset
only has binary safe/malicious labels, not attack-type labels. To train a
real classifier, this script first bootstraps attack-type pseudo-labels
using the SAME keyword patterns the old system used (a standard technique
called weak supervision), then trains a proper ML model on top of those
labels. The resulting model generalizes beyond exact keyword matches
(e.g. recognizing a persona-style jailbreak that doesn't use any of the
literal trigger words) even though the labels it learned from originated
from keyword matching. This is a legitimate technique, but the honest
caveat belongs in any report/viva answer: label quality is bounded by
how good the original keyword patterns were.

Run (after train_model.py has produced vectorizer.pkl):
    python train_attack_type_model.py
Outputs (into app/models/):
    attack_type_model.pkl
    attack_type_labels.json
    attack_type_metrics.json
"""

import json
import os
import re

import joblib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split

from preprocess import preprocess
from features import extract_features_batch

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Keep Stage 2 aligned with Stage 1.  The FinRED merge is preferred whenever
# it is present, unless an explicit DATASET_PATH override is supplied.
FINRED_DATA_PATH = os.path.join(BASE_DIR, "data", "dataset_finred.csv")
DATA_PATH = os.environ.get(
    "DATASET_PATH",
    FINRED_DATA_PATH if os.path.exists(FINRED_DATA_PATH) else os.path.join(BASE_DIR, "data", "dataset.csv"),
)
MODELS_DIR = os.path.join(BASE_DIR, "models")

# Same keyword patterns the old system used for its keyword-only guess —
# reused here ONLY to bootstrap training labels (weak supervision), not as
# the final decision mechanism. Order matters: first match wins.
ATTACK_PATTERNS = [
    ("SQL Injection", re.compile(
        r"(\bor\b|\band\b)\s*['\"]?\s*\d\s*['\"]?\s*=\s*['\"]?\s*\d"
        r"|\bunion\b.{0,15}\bselect\b|\bdrop\s+table\b|\btruncate\s+table\b"
        r"|\bxp_cmdshell\b|\bsqlmap\b|\binformation_schema\b|'\s*--|'\s*#", re.I)),
    ("Jailbreak", re.compile(r"\b(dan|developer mode|jailbreak|no restrictions|unfiltered|no content policy)\b", re.I)),
    ("Prompt Injection", re.compile(r"\b(ignore (all|the|prior|previous)|disregard|system override|forget everything)\b", re.I)),
    ("Data Extraction", re.compile(r"\b(password|api key|credential|database|dump|env file|token|credit card)\b", re.I)),
    ("Role Manipulation", re.compile(r"\b(pretend you are|act as|roleplay|you are now)\b", re.I)),
]


def bootstrap_label(text: str) -> str:
    for label, pattern in ATTACK_PATTERNS:
        if pattern.search(text):
            return label
    return "Other"


def main():
    print("Loading dataset, isolating malicious examples for Stage 2...")
    df = pd.read_csv(DATA_PATH).dropna(subset=["text", "label"]).drop_duplicates(subset=["text"])

    # Merge in the SQL injection dataset too, if present, carrying its REAL
    # attack_category ground truth (not bootstrapped) for that subset.
    sqli_path = os.path.join(BASE_DIR, "data", "dataset_sql_injection.csv")
    real_labels = {}
    if os.path.exists(sqli_path):
        sqli_df = pd.read_csv(sqli_path)
        df = pd.concat([df, sqli_df[["text", "label"]]], ignore_index=True).drop_duplicates(subset=["text"])
        real_labels = dict(zip(sqli_df["text"], sqli_df["attack_category"]))

    malicious = df[df["label"] == 1].copy()
    print(f"  {len(malicious)} malicious examples")

    print("Labeling: real ground truth where available, weak supervision (keyword patterns) otherwise...")
    malicious["attack_type"] = malicious["text"].apply(
        lambda t: real_labels.get(t) if t in real_labels and real_labels.get(t) not in (None, "None") else bootstrap_label(t)
    )
    print(malicious["attack_type"].value_counts())

    malicious["clean_text"] = malicious["text"].astype(str).apply(preprocess)

    train_df, test_df = train_test_split(
        malicious, test_size=0.2, random_state=42, stratify=malicious["attack_type"]
    )

    print("\nBuilding features (reusing the Stage 1 fitted vectorizer)...")
    vec_data = joblib.load(os.path.join(MODELS_DIR, "vectorizer.pkl"))

    def combined_features(sub_df):
        # Support both old (single vectorizer) and new (dual word+char dict)
        # formats — this mismatch previously caused a hard crash at predict
        # time whenever Stage 1 was retrained with the dual vectorizer but
        # Stage 2 wasn't, since the two then disagreed on feature count.
        if isinstance(vec_data, dict):
            word_tfidf = vec_data["word_vec"].transform(sub_df["clean_text"])
            char_tfidf = vec_data["char_vec"].transform(sub_df["clean_text"])
            tfidf = hstack([word_tfidf, char_tfidf], format="csr")
        else:
            tfidf = vec_data.transform(sub_df["clean_text"])
        domain = csr_matrix(extract_features_batch(sub_df["text"]))
        return hstack([tfidf, domain], format="csr")

    X_train = combined_features(train_df)
    X_test = combined_features(test_df)
    y_train, y_test = train_df["attack_type"], test_df["attack_type"]

    print("Training Stage 2 multi-class classifier (Random Forest)...")
    clf = RandomForestClassifier(n_estimators=200, max_depth=None, class_weight="balanced", random_state=42, n_jobs=-1)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1_macro = f1_score(y_test, y_pred, average="macro")

    metrics = {
        "stage": "2 (attack-type classification, malicious prompts only)",
        "label_source": "weak supervision (bootstrapped from keyword patterns), then ML-trained on top",
        "classes": sorted(malicious["attack_type"].unique().tolist()),
        "accuracy": round(acc, 4),
        "f1_macro": round(f1_macro, 4),
        "train_rows": len(train_df),
        "test_rows": len(test_df),
    }

    print("\n=== Stage 2 measured performance ===")
    for k, v in metrics.items():
        print(f"  {k}: {v}")
    print("\n" + classification_report(y_test, y_pred))

    joblib.dump(clf, os.path.join(MODELS_DIR, "attack_type_model.pkl"))
    with open(os.path.join(MODELS_DIR, "attack_type_labels.json"), "w") as f:
        json.dump(sorted(malicious["attack_type"].unique().tolist()), f)
    with open(os.path.join(MODELS_DIR, "attack_type_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\nStage 2 done. Artifacts saved in {MODELS_DIR}")


if __name__ == "__main__":
    main()
