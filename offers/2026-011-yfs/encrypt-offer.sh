#!/usr/bin/env bash
# Re-encrypt the Yunari offer after editing the plain HTML.
# Usage:  ./encrypt-offer.sh            (uses default password)
#         ./encrypt-offer.sh "new-pass" (sets a new password)
# Requires Node.js (staticrypt is fetched automatically by npx).
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a          # export everything the .env defines
  source .env
  set +a
fi
 
if [ -z "${STATICRYPT_PASSWORD:-}" ] \
   || [ -z "${SRC:-}" ] \
   || [ -z "${OUT:-}" ]; then
  echo "ERROR: missing env variables (one of SRC, OUT, STATICRYPT_PASSWORD)." >&2
  exit 1
fi

# staticrypt only knows its own --template-* variables, so the custom
# {{SUBTITLE}} token is substituted into a temp copy of the template first
TPL=".template_resolved.html"
sed "s/{{SUBTITLE}}/${TEMPLATE_SUBTITLE:-}/" vibehuus_password_template.html > "$TPL"

npx staticrypt "$SRC" \
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
