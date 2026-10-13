#!/bin/sh
# Check real Nginx responses in both supported production images.
set -eu
origin="${1:?origin is required}"
public_host="${2:?public host is required}"
probe_dir="$(mktemp -d)"
trap 'rm -f "$probe_dir/headers" "$probe_dir/body"; rmdir "$probe_dir"' EXIT INT TERM
insecure=""
if [ "${LOCKIN_SEARCH_INSECURE:-0}" = "1" ]; then insecure="--insecure"; fi

fetch_page() {
    # The optional flag is a fixed literal, never credential or user input.
    # shellcheck disable=SC2086
    curl $insecure --silent --show-error --fail --max-time 15 \
        --header "Host: $public_host" --header "X-Forwarded-Proto: https" \
        --user-agent "$2" --dump-header "$probe_dir/headers" \
        --output "$probe_dir/body" "$origin$1"
}

for agent in Googlebot Bingbot OAI-SearchBot PerplexityBot Claude-SearchBot; do
    for page in about medicine dentistry features/notes features/active-study features/review features/questions help help/start-active-study; do
        fetch_page "/$page/" "$agent"
        grep -Eiq '^Content-Type: text/html' "$probe_dir/headers"
        grep -Eiq '^X-Robots-Tag: index, follow' "$probe_dir/headers"
        if grep -Eiq '^X-Robots-Tag:.*noindex' "$probe_dir/headers"; then
            printf 'Public page carries noindex: %s %s\n' "$agent" "$page" >&2
            exit 1
        fi
        grep -Eiq '^Content-Security-Policy:' "$probe_dir/headers"
        grep -Eiq '^X-Content-Type-Options: nosniff' "$probe_dir/headers"
        grep -Fq "href=\"https://lockin.ly/$page/\"" "$probe_dir/body"
        grep -Fq '<h1 itemprop="name">' "$probe_dir/body"
        grep -Fq 'itemtype="https://schema.org/Organization"' "$probe_dir/body"
    done
done

for asset in /public-search.css /public-search-tokens.css; do
    fetch_page "$asset" Googlebot
    grep -Eiq '^Content-Type: text/css' "$probe_dir/headers"
done

fetch_page "/sitemap.xml" Googlebot
grep -Eiq '^Content-Type: application/xml' "$probe_dir/headers"
[ "$(grep -o '<loc>' "$probe_dir/body" | wc -l | tr -d ' ')" = "63" ]
if grep -Eq '/api/|/profile|/materials|#' "$probe_dir/body"; then exit 1; fi

fetch_page "/robots.txt" OAI-SearchBot
grep -Fq 'User-agent: OAI-SearchBot' "$probe_dir/body"
grep -Fq 'Sitemap: https://lockin.ly/sitemap.xml' "$probe_dir/body"

for page in / /settings /about/private; do
    fetch_page "$page" Googlebot
    grep -Eiq '^X-Robots-Tag: noindex' "$probe_dir/headers"
    grep -Fq 'name="robots" content="noindex' "$probe_dir/body"
done

for page in about medicine dentistry features/notes features/active-study features/review features/questions help help/start-active-study; do
    # shellcheck disable=SC2086
    redirect="$(curl $insecure --silent --show-error --max-time 15 \
        --header "Host: $public_host" --output /dev/null \
        --write-out '%{http_code}' "$origin/$page")"
    [ "$redirect" = "308" ]
done
printf 'Public search HTML, headers, redirects and sitemap pass; private SPA stays noindex.\n'
