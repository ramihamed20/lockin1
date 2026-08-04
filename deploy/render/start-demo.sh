#!/bin/sh
set -eu

: "${PORT:=10000}"

python manage.py migrate --noinput
python manage.py collectstatic --noinput

if [ "${LOCKIN_DEMO_SEED:-true}" = "true" ]; then
  python manage.py seed_demo
fi

envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
nginx
exec gunicorn --config config/gunicorn.py config.wsgi:application
