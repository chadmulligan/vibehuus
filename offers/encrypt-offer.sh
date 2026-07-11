#!/usr/bin/env bash
# Re-encrypt the Yunari offer after editing the plain HTML.
# Usage:  ./encrypt-offer.sh            (uses default password)
#         ./encrypt-offer.sh "new-pass" (sets a new password)
# Requires Node.js (staticrypt is fetched automatically by npx).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <subfolder>" >&2
  exit 1
fi
 
SUBFOLDER="${1%/}"   # strip a trailing slash if present
ENV_FILE="$SUBFOLDER/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: no .env file found in '$SUBFOLDER'." >&2
  exit 1
fi

set -a          # export everything the env file defines
source "$ENV_FILE"
set +a
 
if [ -z "${STATICRYPT_PASSWORD:-}" ] \
   || [ -z "${SRC:-}" ] \
   || [ -z "${OUT:-}" ]; then
  echo "ERROR: missing env variables (one of SRC, OUT, STATICRYPT_PASSWORD)." >&2
  exit 1
fi

# SRC/OUT are plain filenames relative to the subfolder.
SRC_FILE="$SUBFOLDER/$SRC"
OUT="$SUBFOLDER/$OUT"

# staticrypt only knows its own --template-* variables, so the custom
# {{SUBTITLE}} token is substituted into a temp copy of the template first
TPL=".template_resolved.html"
sed "s/{{SUBTITLE}}/${TEMPLATE_SUBTITLE:-}/" vibehuus_password_template.html > "$TPL"

npx staticrypt "$SRC_FILE" \
  -p "$STATICRYPT_PASSWORD" \
  --remember 30 \
  -t "$TPL" \
  --template-title "$TEMPLATE_TITLE" \
  --template-instructions "Enter the password shared with you to see the offer." \
  --template-button "Unlock" \
  --template-placeholder "password" \
  --template-error "Wrong password — try again" \
  --template-remember "Remember me on this device"

mv "encrypted/$SRC" "$OUT"
rmdir encrypted 2>/dev/null || true
rm -f .staticrypt.json "$TPL"

echo "Done: $OUT  (password: $STATICRYPT_PASSWORD)"
