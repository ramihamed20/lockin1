# Layer order is deliberate: a release that changes only application code must
# reuse every dependency layer byte for byte, so the host pulling it downloads
# the application and nothing else. Dependencies are therefore resolved from the
# dependency list alone, in stages that never see the source tree, and the
# runtime image installs them before any application file is copied.
#
# scripts/ci/image-layer-stability.sh proves this on every change: it rebuilds
# after a source-only edit and after a dependency edit, and asserts which
# layers stay identical.

# The dependency list, and nothing else from pyproject.toml. Editing tool
# configuration (ruff, mypy, pytest) rewrites this file with identical content,
# and BuildKit keys the COPY that consumes it by content, so the wheels below
# are not rebuilt for it.
FROM python:3.13.14-slim AS dependency-metadata

WORKDIR /metadata
COPY pyproject.toml ./
RUN python -c "import pathlib, tomllib; dependencies = tomllib.loads(pathlib.Path('pyproject.toml').read_text())['project']['dependencies']; pathlib.Path('requirements.txt').write_text(''.join(f'{item}\n' for item in dependencies))"

# Third-party wheels. This stage's only input is requirements.txt, which is what
# lets the runtime install below stay cached across source-only releases.
FROM python:3.13.14-slim AS dependency-wheels

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY --from=dependency-metadata /metadata/requirements.txt ./
RUN python -m pip wheel --wheel-dir=/wheels --requirement requirements.txt

# The application's own wheel, built without its dependencies. It changes with
# every release, and it is small.
FROM python:3.13.14-slim AS project-wheel

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml README.md ./
COPY apps ./apps
COPY config ./config
COPY platform_core ./platform_core
RUN python -m pip wheel --no-deps --wheel-dir=/wheels .

FROM python:3.13.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/home/lockin/.local/bin:$PATH

RUN addgroup --system --gid 10001 lockin \
    && adduser --system --uid 10001 --ingroup lockin --home /home/lockin lockin

WORKDIR /app

# Wheels are mounted for the install, never copied: a copied wheel directory
# stays in the image as its own layer even after a later `rm`, which shipped
# about 36 MB of archives nothing ever read.
RUN --mount=type=bind,from=dependency-wheels,source=/wheels,target=/tmp/wheels \
    --mount=type=bind,from=dependency-metadata,source=/metadata/requirements.txt,target=/tmp/requirements.txt \
    python -m pip install --no-index --find-links=/tmp/wheels --requirement /tmp/requirements.txt

# Writable directories do not depend on the source, so they are created before
# it and stay cached.
RUN mkdir -p /app/media /app/staticfiles \
    && chown -R lockin:lockin /app/media /app/staticfiles

# The installed distribution, as before; dependencies are already present.
# Installed by name from a local index rather than by wheel path, so pip records
# the same metadata the previous single install did (no file:// origin).
RUN --mount=type=bind,from=project-wheel,source=/wheels,target=/tmp/project-wheel \
    python -m pip install --no-index --no-deps --find-links=/tmp/project-wheel lockin-backend

COPY --chown=lockin:lockin apps ./apps
COPY --chown=lockin:lockin config ./config
COPY --chown=lockin:lockin platform_core ./platform_core
COPY --chown=lockin:lockin manage.py ./

USER 10001:10001
EXPOSE 8000

CMD ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"]
