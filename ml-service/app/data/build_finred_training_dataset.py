"""Build a reproducible binary training set that includes FinRED.

FinRED consists exclusively of adversarial financial prompts.  This script
keeps the existing labeled safe/malicious corpus, maps every FinRED prompt to
the malicious class, and records the original FinRED category for auditability.

Run from this directory:
    python build_finred_training_dataset.py
"""

from pathlib import Path

import pandas as pd


DATA_DIR = Path(__file__).resolve().parent
BASE_DATASET = DATA_DIR / "dataset.csv"
FINRED_DIR = DATA_DIR / "finred"
OUTPUT_DATASET = DATA_DIR / "dataset_finred.csv"


def main():
    files = sorted(FINRED_DIR.glob("R*_prompts.csv"))
    if len(files) != 26:
        raise FileNotFoundError(
            f"Expected 26 FinRED CSV files in {FINRED_DIR}; found {len(files)}."
        )

    base = pd.read_csv(BASE_DATASET, usecols=["text", "label"])
    base["source"] = "existing_corpus"
    base["finred_category"] = pd.NA

    finred = pd.concat((pd.read_csv(file) for file in files), ignore_index=True)
    finred = finred.rename(columns={"prompt": "text", "category_prefix": "finred_category"})
    finred = finred[["text", "finred_category"]]
    finred["label"] = 1
    finred["source"] = "FinRED"

    merged = pd.concat([base, finred], ignore_index=True)
    merged = merged.dropna(subset=["text"]).drop_duplicates(subset=["text"]).sample(
        frac=1, random_state=42
    )
    merged.to_csv(OUTPUT_DATASET, index=False)

    print(f"Saved {len(merged)} rows to {OUTPUT_DATASET}")
    print(merged.groupby(["source", "label"]).size().to_string())
    print(f"FinRED categories retained: {finred.finred_category.nunique()}")


if __name__ == "__main__":
    main()
