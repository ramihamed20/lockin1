FROM python:3.13.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system lockin && adduser --system --ingroup lockin lockin

COPY pyproject.toml README.md ./
COPY apps ./apps
COPY config ./config
COPY platform_core ./platform_core
COPY manage.py ./

RUN python -m pip install .

USER lockin
EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
