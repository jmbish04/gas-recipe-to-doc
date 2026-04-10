import base64
import json
import os
import sys
from pathlib import Path

def mask_sensitive(value: str) -> str:
    """Masks a string, showing only the first and last 4 characters."""
    if not value or not isinstance(value, str):
        return "N/A"
    if len(value) <= 8:
        return "[REDACTED]"
    return f"{value[:4]}...{value[-4:]}"

def load_secret() -> str:
    raw = os.getenv("CLASPRC_JSON_RAW", "")
    if not raw.strip():
        print("❌ Error: CLASPRC_JSON_RAW is empty.")
        sys.exit(1)

    raw = raw.strip()

    if raw.startswith("base64:"):
        b64 = raw[len("base64:") :].strip()
        try:
            return base64.b64decode(b64).decode("utf-8")
        except Exception as e:
            print(f"❌ Error: failed to base64 decode CLASPRC_JSON_RAW: {e}")
            sys.exit(1)

    return raw

def transform_and_validate(data: dict) -> dict:
    """
    Transforms raw clasp login exports into the flattened format required for CI.
    Ensures 'token' is at the root and 'isLocalCreds' is False.
    """
    transformed = {}
    
    # 1. Handle Flattening (Move .tokens.default to .token)
    if "tokens" in data and "default" in data["tokens"]:
        print("🔄 Detected nested credentials; flattening for CI/CD...")
        token_data = data["tokens"]["default"]
        transformed["token"] = token_data
        
        # Extract client settings
        if "client_id" in token_data and "client_secret" in token_data:
            transformed["oauth2ClientSettings"] = {
                "clientId": token_data["client_id"],
                "clientSecret": token_data["client_secret"],
                "redirectUri": "http://localhost"
            }
    elif "token" in data:
        transformed["token"] = data["token"]
    else:
        print("❌ Error: Could not find 'token' or 'tokens.default' in secret.")
        # Diagnostic: Print the keys found to help debug the structure
        print(f"Found keys: {list(data.keys())}")
        sys.exit(1)

    # 2. Redacted Diagnostic Output
    token_obj = transformed.get("token", {})
    print("\n🔍 --- Token Diagnostic (Redacted) ---")
    print(f"   Access Token:  {mask_sensitive(token_obj.get('access_token'))}")
    print(f"   Refresh Token: {mask_sensitive(token_obj.get('refresh_token'))}")
    print(f"   Expiry:        {token_obj.get('expiry_date', 'N/A')}")
    print(f"   Scopes:        {token_obj.get('scope', 'N/A')}")
    print("---------------------------------------\n")

    # 3. Finalize CI Structure
    if "oauth2ClientSettings" in data:
        transformed["oauth2ClientSettings"] = data["oauth2ClientSettings"]
    
    transformed["isLocalCreds"] = False
    return transformed

def main():
    secret_text = load_secret()

    try:
        data = json.loads(secret_text)
    except json.JSONDecodeError as e:
        print(f"❌ Error: CLASPRC_JSON_RAW is not valid JSON: {e}")
        sys.exit(1)

    if not isinstance(data, dict):
        print("❌ Error: CLASPRC_JSON_RAW must be a JSON object.")
        sys.exit(1)

    final_data = transform_and_validate(data)

    targets = [Path.home() / ".clasprc.json", Path.cwd() / ".clasprc.json"]
    for p in targets:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(final_data, indent=2), encoding="utf-8")
        print(f"✅ Wrote flattened credentials to {p}")

if __name__ == "__main__":
    main()
