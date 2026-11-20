FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by multimodal.py
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tesseract-ocr \
        ffmpeg \
        antiword \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir \
        --trusted-host pypi.org \
        --trusted-host files.pythonhosted.org \
        -r requirements.txt \
    && python -c "\
import ssl; \
ssl._create_default_https_context = ssl._create_unverified_context; \
import nltk; \
nltk.download('stopwords', download_dir='/usr/local/nltk_data', quiet=True); \
nltk.download('wordnet', download_dir='/usr/local/nltk_data', quiet=True); \
nltk.download('punkt', download_dir='/usr/local/nltk_data', quiet=True); \
nltk.download('punkt_tab', download_dir='/usr/local/nltk_data', quiet=True); \
nltk.download('omw-1.4', download_dir='/usr/local/nltk_data', quiet=True); \
" \
    && curl -k -L -o /tmp/en_core_web_sm-3.7.1-py3-none-any.whl \
        https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl \
    && pip install --no-cache-dir /tmp/en_core_web_sm-3.7.1-py3-none-any.whl \
    && rm /tmp/en_core_web_sm-3.7.1-py3-none-any.whl

ENV NLTK_DATA=/usr/local/nltk_data

# Copy the full app
COPY app/ ./app

WORKDIR /app/app

# Build-time safety net for Stage 1 model
RUN if [ ! -f "models/ensemble_model.pkl" ] || [ ! -f "models/vectorizer.pkl" ]; then \
        echo "[build] Model artifacts missing — training now (this may take a few minutes)..."; \
        python train_model.py; \
    else \
        echo "[build] Model artifacts found — skipping training."; \
    fi

# Build-time safety net for Stage 2 model
RUN if [ ! -f "models/attack_type_model.pkl" ]; then \
        echo "[build] Stage 2 attack-type model missing — training now..."; \
        python train_attack_type_model.py; \
    else \
        echo "[build] Stage 2 attack-type model found — skipping training."; \
    fi

COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
