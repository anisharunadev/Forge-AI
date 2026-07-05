#!/usr/bin/env bash
# scripts/rotate-secrets.sh — rotate JWT signing key, LiteLLM master key,
# DB password, Keycloak client secret. Writes the new values to a
# timestamped sibling of infra/env/<env>.env so the existing deploy
# pipeline (scripts/deploy.sh) picks them up on the next deploy.
#
# Usage:
#   scripts/rotate-secrets.sh --env=staging [--no-keycloak] [--no-db]
#
# Overlap window: the script also writes the OLD jwt_secret to
# JWT_SECRET_PREVIOUS in the new env file. The backend's decode_token
# (app/core/security.py) tries primary then previous, so tokens minted
# before rotation remain valid for the lifetime of the overlap window
# (default 5 minutes; configurable via --overlap-seconds=<N>).
#
# References: SC-7.2; risk row 3 of phase-7.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV=""
ROTATE_KEYCLOAK=1
ROTATE_DB=1
ROTATE_LITELLM=1
ROTATE_JWT=1
OVERLAP_SECONDS=300  # 5 min — matches brief's risk row 3
NOW="$(date -u +'%Y%m%dT%H%M%SZ')"

usage() {
    cat <<EOF
Usage: $0 --env=<dev|staging|prod> [options]

Options:
  --env=NAME              target environment (required)
  --no-keycloak           skip Keycloak client secret rotation
  --no-db                 skip DB password rotation
  --no-litellm            skip LiteLLM master key rotation
  --no-jwt                skip JWT signing key rotation
  --overlap-seconds=N     JWT overlap window (default 300)
  -h, --help              show this help
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)         ENV="${arg#*=}" ;;
        --no-keycloak)   ROTATE_KEYCLOAK=0 ;;
        --no-db)         ROTATE_DB=0 ;;
        --no-litellm)    ROTATE_LITELLM=0 ;;
        --no-jwt)        ROTATE_JWT=0 ;;
        --overlap-seconds=*) OVERLAP_SECONDS="${arg#*=}" ;;
        -h|--help)       usage; exit 0 ;;
        *)               echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

[[ -n "$ENV" ]] || { echo "--env is required" >&2; usage; exit 2; }
case "$ENV" in
    dev|staging|prod) ;;
    *) echo "invalid --env=$ENV (expected dev|staging|prod)" >&2; exit 2 ;;
esac

log()  { printf '\033[1;34m[rotate:%s]\033[0m %s\n' "$ENV" "$*"; }
warn() { printf '\033[1;33m[rotate:%s]\033[0m %s\n' "$ENV" "$*" >&2; }
fail() { printf '\033[1;31m[rotate:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

ENV_FILE="infra/env/${ENV}.env"
mkdir -p "$(dirname "$ENV_FILE")"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE (copy from .env.example)"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# Snapshot current values (to write into JWT_SECRET_PREVIOUS for overlap)
# ---------------------------------------------------------------------------
PREV_JWT_SECRET="${JWT_SECRET:-}"
[[ -n "$PREV_JWT_SECRET" ]] || fail "JWT_SECRET not set in $ENV_FILE"

OUT_FILE="${ENV_FILE}.rotated.${NOW}"
cp "$ENV_FILE" "$OUT_FILE"
log "wrote $OUT_FILE (will become $ENV_FILE on next deploy)"

# ---------------------------------------------------------------------------
# 1. JWT signing key
# ---------------------------------------------------------------------------
if (( ROTATE_JWT )); then
    log "rotating JWT signing key (overlap ${OVERLAP_SECONDS}s)"
    NEW_JWT="$(openssl rand -base64 48)"
    sed -i.bak \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT}|" \
        -e "s|^JWT_SECRET_PREVIOUS=.*|JWT_SECRET_PREVIOUS=${PREV_JWT_SECRET}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    log "  new JWT_SECRET: ${NEW_JWT:0:8}..."
    log "  JWT_SECRET_PREVIOUS (for overlap): ${PREV_JWT_SECRET:0:8}..."
fi

# ---------------------------------------------------------------------------
# 2. LiteLLM master key
# ---------------------------------------------------------------------------
if (( ROTATE_LITELLM )); then
    log "rotating LiteLLM master key"
    NEW_LITELLM="sk-litellm-$(openssl rand -hex 24)"
    sed -i.bak \
        -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=${NEW_LITELLM}|" \
        -e "s|^LITELLM_API_KEY=.*|LITELLM_API_KEY=${NEW_LITELLM}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    log "  new LITELLM_MASTER_KEY: ${NEW_LITELLM:0:14}..."
fi

# ---------------------------------------------------------------------------
# 3. DB password
# ---------------------------------------------------------------------------
if (( ROTATE_DB )); then
    log "rotating DB password"
    NEW_DB_PW="$(openssl rand -base64 32 | tr -d '+/' | head -c 40)"
    sed -i.bak \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_DB_PW}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    # Apply live: ALTER USER on the running Postgres.
    if command -v psql >/dev/null 2>&1; then
        PGHOST="${POSTGRES_HOST:-localhost}"
        PGPORT="${POSTGRES_PORT:-5432}"
        PGUSER="${POSTGRES_ADMIN_USER:-postgres}"
        export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD}}"
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
            -c "ALTER USER ${POSTGRES_USER:-forge} WITH PASSWORD '${NEW_DB_PW}';" \
            || fail "ALTER USER failed; old password still active"
        log "  ALTER USER applied to ${POSTGRES_USER:-forge}"
    else
        warn "psql not on PATH; skipped live ALTER USER"
    fi
fi

# ---------------------------------------------------------------------------
# 4. Keycloak client secret
# ---------------------------------------------------------------------------
if (( ROTATE_KEYCLOAK )); then
    log "rotating Keycloak client secret (forge-backend)"
    NEW_KC_SECRET="$(openssl rand -base64 48 | tr -d '+/' | head -c 64)"
    if command -v curl >/dev/null 2>&1; then
        ADMIN_TOKEN="$(curl -fsS \
            -d "username=${KEYCLOAK_ADMIN:-admin}" \
            -d "password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" \
            -d "grant_type=password" \
            -d "client_id=admin-cli" \
            "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
            | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")"
        INTERNAL_ID="$(curl -fsS \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM:-forge}/clients?clientId=forge-backend" \
            | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"
        curl -fsS -X PUT \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"secret\":\"${NEW_KC_SECRET}\"}" \
            "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM:-forge}/clients/${INTERNAL_ID}" \
            || fail "Keycloak secret rotation failed; reverting"
        sed -i.bak \
            -e "s|^FORGE_BACKEND_CLIENT_SECRET=.*|FORGE_BACKEND_CLIENT_SECRET=${NEW_KC_SECRET}|" \
            -e "s|^KEYCLOAK_BACKEND_SECRET=.*|KEYCLOAK_BACKEND_SECRET=${NEW_KC_SECRET}|" \
            "$OUT_FILE"
        rm -f "${OUT_FILE}.bak"
        log "  new FORGE_BACKEND_CLIENT_SECRET: ${NEW_KC_SECRET:0:8}..."
    else
        warn "curl not on PATH; skipped live Keycloak PUT"
    fi
fi

# ---------------------------------------------------------------------------
# Done — operator must run scripts/deploy.sh to apply
# ---------------------------------------------------------------------------
log "rotation complete. Next steps:"
echo "  1. Review $OUT_FILE"
echo "  2. Run scripts/deploy.sh --env=$ENV to roll the new values out"
echo "  3. After ${OVERLAP_SECONDS}s the JWT_SECRET_PREVIOUS overlap window closes;"
echo "     unset it on the next deploy by re-running with --overlap-seconds=0"
echo
echo "OVERLAP_SECONDS=${OVERLAP_SECONDS}" >> "$OUT_FILE"
log "wrote $OUT_FILE"
