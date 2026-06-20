#!/usr/bin/env bash
# Detached HTTP server for the docs-site dist
exec python3 -m http.server 8080 --bind 0.0.0.0 --directory "$(dirname "$0")/dist"
