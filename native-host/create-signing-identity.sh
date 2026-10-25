#!/bin/bash
set -euo pipefail

# Create a self-signed code signing identity for local builds of Arclike, and trust it for code
# signing in your login keychain. Run it once; install-local.sh then signs with it.
#
# macOS ties the Accessibility permission to the app's signature. An ad hoc signature changes
# with every build, so the permission had to be granted again after each install. A fixed
# identity keeps it granted across rebuilds.
#
# Usage:
#   ./create-signing-identity.sh [NAME]      # NAME defaults to "Arclike Local Signing"
#
# macOS asks for your password once, to trust the certificate. To remove the identity later,
# delete the certificate named NAME in Keychain Access.

NAME="${1:-Arclike Local Signing}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# The system's LibreSSL writes a PKCS#12 file that the security tool can always read.
OPENSSL=/usr/bin/openssl

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
    echo "The identity \"$NAME\" already exists."
    exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF

echo "==> Creating a certificate and key for \"$NAME\"..."
"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$WORK/cert.cnf" \
    -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
PASSWORD=$("$OPENSSL" rand -hex 16)
"$OPENSSL" pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" \
    -passout "pass:$PASSWORD" -out "$WORK/identity.p12"

echo "==> Importing it into your login keychain (codesign may use the key without asking)..."
security import "$WORK/identity.p12" -k "$KEYCHAIN" -P "$PASSWORD" -T /usr/bin/codesign >/dev/null

echo "==> Trusting the certificate for code signing (macOS asks for your password)..."
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"

security find-identity -v -p codesigning | grep "\"$NAME\""
echo "==> Done. Run ./install-local.sh to build and sign Arclike with it."
