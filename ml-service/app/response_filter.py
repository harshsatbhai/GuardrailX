"""
response_filter.py
-------------------
Stage 7: filters LLM-generated responses to redact sensitive data (PII, API
keys, tokens, card numbers) before returning them to the user.

Uses spaCy NER when available; always applies regex-based redaction for
structured secrets (API keys, tokens, card numbers, emails) regardless,
since regex is more reliable for those fixed-format patterns.

IMPORTANT (bug fix): the card-number and IBAN rules previously matched on
shape alone — ANY 13-19 digit number got redacted as a "card number", and
in Finance mode, almost any two-letter+two-digit+alphanumeric token (e.g.
a product code like "AB12XY9000") got redacted as an "IBAN". This is what
was causing ordinary words/numbers to disappear from responses. Both rules
now additionally validate against the real checksum algorithm used by that
identifier format (Luhn for card numbers, ISO 7064 mod-97-10 for IBANs)
before redacting, which is the standard way to tell "a 16-digit card
number" apart from "a 16-digit number that happens to appear in text."
"""

import re

_REGEX_RULES = [
    (re.compile(r"sk-[a-zA-Z0-9]{20,}"), "[KEY_REDACTED]"),
    (re.compile(r"gsk_[a-zA-Z0-9]{20,}"), "[KEY_REDACTED]"),
    (re.compile(r"AIza[0-9A-Za-z\-_]{20,}"), "[KEY_REDACTED]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9\-_\.]+", re.I), "[TOKEN_REDACTED]"),
    (re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), "[EMAIL_REDACTED]"),
    (re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"), "[PHONE_REDACTED]"),
]

# Card numbers are matched as a CANDIDATE shape first (13-19 digits, with
# optional space/dash separators the way cards are usually written), then
# validated with the Luhn checksum before being redacted. A bare number
# that happens to be 13-19 digits long (an ID, a tracking number, a big
# round number in a sentence) will fail Luhn with ~90% probability and is
# correctly left alone.
_CARD_CANDIDATE = re.compile(r"\b(?:\d[ -]?){13,19}\b")

_FINANCE_REGEX_RULES = [
    # US Social Security Numbers — context-free pattern, kept as-is since
    # XXX-XX-XXXX is a distinctive enough shape that false positives are rare.
    (re.compile(r"\b\d{3}[- ]\d{2}[- ]\d{4}\b"), "[SSN_REDACTED]"),
    # ABA routing numbers — gated on the word "routing" appearing right
    # before the digits, so an unrelated 9-digit number is never touched.
    (re.compile(r"(?:routing\s*(?:number|num|no|#)?\s*[:=]?\s*)(\d{9})\b", re.I), "[ROUTING_REDACTED]"),
    # Bank account numbers — gated on "account"/"checking"/"savings" context.
    (re.compile(
        r"(?:account\s*(?:number|num|no|#)?\s*[:=]?\s*)(\d{8,17})\b"
        r"|(?:checking|savings)\s+account\s+(\d{8,17})\b", re.I
    ), "[ACCOUNT_REDACTED]"),
    # Brokerage / trading account IDs — also context-gated.
    (re.compile(r"(?:brokerage|trading)\s+account\s*[:=]?\s*([A-Z0-9]{6,15})\b", re.I), "[BROKERAGE_ACCT_REDACTED]"),
]

# IBAN candidate shape (country code + 2 check digits + up to 30 alphanumeric),
# validated below with the real mod-97 checksum before redaction.
_IBAN_CANDIDATE = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b")

_nlp = None


def _luhn_valid(digits: str) -> bool:
    """Standard Luhn checksum — the actual algorithm card numbers are
    generated to satisfy. A random digit string of the same length passes
    by chance only ~10% of the time, which is what makes this a real
    filter rather than just a length check."""
    digits = re.sub(r"[ -]", "", digits)
    if not digits.isdigit() or not (13 <= len(digits) <= 19):
        return False
    total = 0
    reversed_digits = digits[::-1]
    for i, ch in enumerate(reversed_digits):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _iban_valid(candidate: str) -> bool:
    """ISO 7064 mod-97-10 checksum — the real IBAN validation algorithm.
    Move the first 4 characters to the end, convert letters to numbers
    (A=10 ... Z=35), and check the resulting number mod 97 == 1. This is
    what separates a real IBAN from a product code or reference number
    that happens to start with two letters and two digits."""
    candidate = candidate.upper()
    if not (15 <= len(candidate) <= 34):
        return False
    rearranged = candidate[4:] + candidate[:4]
    numeric = "".join(str(int(ch, 36)) if ch.isalpha() else ch for ch in rearranged)
    try:
        return int(numeric) % 97 == 1
    except ValueError:
        return False


def _redact_card_numbers(text):
    count = 0

    def repl(m):
        nonlocal count
        if _luhn_valid(m.group(0)):
            count += 1
            return "[CARD_REDACTED]"
        return m.group(0)  # not a real card number by checksum — leave untouched

    filtered = _CARD_CANDIDATE.sub(repl, text)
    return filtered, count


def _redact_ibans(text):
    count = 0

    def repl(m):
        nonlocal count
        if _iban_valid(m.group(1)):
            count += 1
            return "[IBAN_REDACTED]"
        return m.group(0)  # fails checksum — not a real IBAN, leave untouched

    filtered = _IBAN_CANDIDATE.sub(repl, text)
    return filtered, count


def _load_spacy():
    global _nlp
    if _nlp is None:
        try:
            import spacy
            _nlp = spacy.load("en_core_web_sm")
        except Exception:
            _nlp = False  # sentinel: spaCy/model unavailable, regex-only fallback
    return _nlp


def filter_response(text: str, domain: str = None) -> dict:
    """
    Filter/redact sensitive data from an LLM response.

    Parameters
    ----------
    text : str
        The raw LLM-generated response text.
    domain : str, optional
        Deployment domain.  When ``"finance"``, additional finance-specific
        PII redaction rules (SSNs, routing numbers, IBANs, bank account
        numbers) are applied on top of the generic rules.
    """
    if not text:
        return {"filtered_text": text, "redactions": []}

    redactions = []
    filtered = text

    # Regex pass (structured secrets) — always runs
    for pattern, tag in _REGEX_RULES:
        matches = pattern.findall(filtered)
        if matches:
            redactions.append({"type": tag.strip("[]"), "count": len(matches)})
            filtered = pattern.sub(tag, filtered)

    # Card numbers — Luhn-validated, not shape-only (see module docstring)
    filtered, card_count = _redact_card_numbers(filtered)
    if card_count:
        redactions.append({"type": "CARD_REDACTED", "count": card_count})

    # Finance-domain additional redaction pass
    if domain == "finance":
        for pattern, tag in _FINANCE_REGEX_RULES:
            matches = pattern.findall(filtered)
            if matches:
                redactions.append({"type": tag.strip("[]"), "count": len(matches)})
                filtered = pattern.sub(tag, filtered)

        # IBANs — mod-97 validated, not shape-only (see module docstring)
        filtered, iban_count = _redact_ibans(filtered)
        if iban_count:
            redactions.append({"type": "IBAN_REDACTED", "count": iban_count})

    # spaCy NER pass (named entities like PERSON) — best-effort, fail-safe:
    # any per-call spaCy error just skips this pass rather than crashing the
    # whole response filter (regex redactions above have already run).
    try:
        nlp = _load_spacy()
        if nlp:
            doc = nlp(filtered)
            for ent in doc.ents:
                if ent.label_ in ("PERSON",):
                    filtered = filtered.replace(ent.text, "[REDACTED]")
                    redactions.append({"type": "PERSON", "count": 1})
    except Exception as e:
        print(f"[response_filter] spaCy NER pass failed, skipping: {e}")

    return {"filtered_text": filtered, "redactions": redactions}


if __name__ == "__main__":
    sample = (
        "Sure, contact John Smith at john.smith@example.com or call "
        "555-123-4567. The API key is sk-abcd1234efgh5678ijkl9012. "
        "My real Visa card is 4111 1111 1111 1111, but my loyalty number "
        "9876543210123 and our Q3 revenue of 4500000000000 are not cards."
    )
    print("Generic:", filter_response(sample))

    finance_sample = (
        "The client's SSN is 123-45-6789, routing number 021000021, "
        "account number 987654321, IBAN GB29NWBK60161331926819. "
        "Our product code AB12XY9000Z and invoice REF34NUMBER are not IBANs."
    )
    print("Finance:", filter_response(finance_sample, domain="finance"))
