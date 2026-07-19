FROM python:3.13.14-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml README.md ./
COPY apps ./apps
COPY config ./config
COPY platform_core ./platform_core
RUN python -m pip wheel --wheel-dir=/wheels .

FROM python:3.13.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/home/lockin/.local/bin:$PATH

RUN addgroup --system --gid 10001 lockin \
    && adduser --system --uid 10001 --ingroup lockin --home /home/lockin lockin

WORKDIR /app
COPY --from=builder /wheels /wheels
RUN python -m pip install --no-index --find-links=/wheels lockin-backend \
    && rm -rf /wheels

COPY --chown=lockin:lockin apps ./apps
COPY --chown=lockin:lockin config ./config
COPY --chown=lockin:lockin platform_core ./platform_core
COPY --chown=lockin:lockin manage.py ./
RUN mkdir -p /app/media /app/staticfiles \
    && chown -R lockin:lockin /app/media /app/staticfiles

USER 10001:10001
EXPOSE 8000

CMD ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"]
