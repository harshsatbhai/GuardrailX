"""
train_model.py
---------------
Stage 1 of the two-level modeling system: binary safe/malicious classifier.

Feature representation = dual TF-IDF (25k word n-grams + 25k char n-grams)
combined with hand-engineered domain-specific features (features.py).

The three base classifiers (tuned Logistic Regression, Random Forest, SVM)
are combined via a stacking meta-learner.

For Stage 2 (attack-type classification, run only on prompts Stage 1 flags
as malicious), see train_attack_type_model.py.

Run:
    python train_model.py
Outputs (into app/models/):
    vectorizer.pkl          <- dict {"word_vec": ..., "char_vec": ...}
    ensemble_model.pkl      <- Stage 1 binary classifier (stacking ensemble)
    metrics.json            <- real measured metrics from THIS training run
"""

import json
import os
import time

import joblib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier, StackingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report,
                              confusion_matrix, f1_score, precision_score,
                              recall_score)
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC

from preprocess import preprocess
from features import extract_features_batch

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FINRED_DATA_PATH = os.path.join(BASE_DIR, "data", "dataset_finred.csv")
DATA_PATH = os.environ.get(
    "DATASET_PATH",
    FINRED_DATA_PATH if os.path.exists(FINRED_DATA_PATH) else os.path.join(BASE_DIR, "data", "dataset.csv"),
)
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)


def build_combined_features(word_vec, char_vec, raw_texts, clean_texts, fit=False):
    """Dual TF-IDF (word + char n-grams on cleaned text) horizontally stacked
    with domain-specific features (on raw text)."""
    if fit:
        word_tfidf = word_vec.fit_transform(clean_texts)
        char_tfidf = char_vec.fit_transform(clean_texts)
    else:
        word_tfidf = word_vec.transform(clean_texts)
        char_tfidf = char_vec.transform(clean_texts)
    domain_feats = csr_matrix(extract_features_batch(raw_texts))
    return hstack([word_tfidf, char_tfidf, domain_feats], format="csr")


def main():
    print("Loading dataset...")
    df = pd.read_csv(DATA_PATH)
    df = df.dropna(subset=["text", "label"]).drop_duplicates(subset=["text"])

    print("Loading PII dataset and merging...")
    pii_path = os.path.join(BASE_DIR, "data", "pii_masking_200k", "english_pii_43k.jsonl")
    if os.path.exists(pii_path):
        target_labels = {
            "ACCOUNTNUMBER", "BIC", "CREDITCARDNUMBER", "CREDITCARDCVV",
            "IBAN", "PASSWORD", "PIN", "SSN",
        }
        def has_financial_pii(mask):
            return any(entity.get("label") in target_labels for entity in mask)

        pii_df = pd.read_json(pii_path, lines=True)
        pii_df["label"] = pii_df["privacy_mask"].apply(has_financial_pii).astype(int)
        pii_df = pii_df[["source_text", "label"]].dropna().drop_duplicates(subset=["source_text"])
        pii_df = pii_df.rename(columns={"source_text": "text"})

        # Only keep rows that CONTAIN financial PII (label=1).
        # The PII-safe rows (normal sentences) have a very different distribution
        # from the original safe prompts and add noise that hurts accuracy.
        pii_df = pii_df[pii_df["label"] == 1]
        print(f"  PII dataset: keeping {len(pii_df)} positive (financial PII) rows only")

        df = pd.concat([df, pii_df], ignore_index=True)
        df = df.drop_duplicates(subset=["text"])

    print("Loading SQL injection dataset and merging...")
    sqli_path = os.path.join(BASE_DIR, "data", "dataset_sql_injection.csv")
    if os.path.exists(sqli_path):
        sqli_df = pd.read_csv(sqli_path)[["text", "label"]]
        before = len(df)
        df = pd.concat([df, sqli_df], ignore_index=True).drop_duplicates(subset=["text"])
        print(f"  SQL injection dataset: added {len(df) - before} new rows "
              f"({(sqli_df.label==1).sum()} malicious, {(sqli_df.label==0).sum()} safe)")

    print(f"  {len(df)} rows loaded  (safe={sum(df.label==0)}, malicious={sum(df.label==1)})")

    print("Preprocessing text...")
    df["clean_text"] = df["text"].astype(str).apply(preprocess)

    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df["label"]
    )
    y_train, y_test = train_df["label"], test_df["label"]

    print("Fitting dual TF-IDF (word + char n-grams) + domain features...")
    # Word-level: captures whole-word patterns, instructions, jailbreak phrases
    word_vec = TfidfVectorizer(
        analyzer="word",
        ngram_range=(1, 3),
        max_features=25000,
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
    )
    # Char-level: captures obfuscated tokens, partial PII, l33t-speak, typos
    char_vec = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(3, 5),
        max_features=25000,
        min_df=3,
        sublinear_tf=True,
    )

    X_train = build_combined_features(word_vec, char_vec, train_df["text"], train_df["clean_text"], fit=True)
    X_test  = build_combined_features(word_vec, char_vec, test_df["text"],  test_df["clean_text"],  fit=False)
    n_domain = X_train.shape[1] - 50000
    print(f"  Combined feature matrix: {X_train.shape[1]} columns "
          f"(25000 word TF-IDF + 25000 char TF-IDF + {n_domain} domain features)")

    print("Training Logistic Regression (tuned), Random Forest, SVM -> stacking ensemble...")
    lr  = LogisticRegression(C=10.0, class_weight="balanced", solver="liblinear", max_iter=2000, random_state=42)
    rf  = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1, max_features="sqrt")
    svm = CalibratedClassifierCV(LinearSVC(C=1.0, max_iter=5000, random_state=42), cv=3)

    ensemble = StackingClassifier(
        estimators=[("lr", lr), ("rf", rf), ("svm", svm)],
        final_estimator=LogisticRegression(C=5.0, max_iter=1000),
        cv=3,
        passthrough=False,
        stack_method="predict_proba",
    )

    t0 = time.time()
    ensemble.fit(X_train, y_train)
    train_time = time.time() - t0

    print("Evaluating Stage 1 (binary safe/malicious)...")
    t0 = time.time()
    y_pred = ensemble.predict(X_test)
    infer_time_ms = (time.time() - t0) * 1000 / max(len(y_test), 1)

    metrics = {
        "stage": "1 (binary safe/malicious)",
        "ensemble_method": "stacking (logistic-regression meta-learner, 3-fold)",
        "feature_representation": "word TF-IDF (25000, 1-3grams) + char TF-IDF (25000, 3-5grams) + domain features",
        "dataset_path": os.path.abspath(DATA_PATH),
        "accuracy": round(accuracy_score(y_test, y_pred), 4),
        "precision": round(precision_score(y_test, y_pred), 4),
        "recall": round(recall_score(y_test, y_pred), 4),
        "f1_score": round(f1_score(y_test, y_pred), 4),
        "false_positive_rate": None,
        "train_time_sec": round(train_time, 2),
        "avg_inference_time_ms": round(infer_time_ms, 3),
        "train_rows": len(train_df),
        "test_rows": len(test_df),
    }

    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()
    metrics["false_positive_rate"] = round(fp / (fp + tn), 4) if (fp + tn) else 0.0
    metrics["confusion_matrix"] = {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}

    print("\n=== Stage 1 measured performance (real, from this training run) ===")
    for k, v in metrics.items():
        print(f"  {k}: {v}")
    print("\n" + classification_report(y_test, y_pred, target_names=["safe", "malicious"]))

    print("Saving Stage 1 artifacts...")
    # Save both vectorizers together so classify.py can load them
    joblib.dump({"word_vec": word_vec, "char_vec": char_vec}, os.path.join(MODELS_DIR, "vectorizer.pkl"))
    joblib.dump(ensemble, os.path.join(MODELS_DIR, "ensemble_model.pkl"))
    with open(os.path.join(MODELS_DIR, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\nStage 1 done. Artifacts saved in {MODELS_DIR}")
    print("Now run train_attack_type_model.py for Stage 2 (attack-type classification).")


if __name__ == "__main__":
    main()
