import base64
import json
import os
import sys
from pathlib import Path

def load_secret() -> str:
    raw = os.getenv("CLASPRC_JSON_RAW", "")
    if not raw.strip():
        print("❌ Error: CLASPRC_JSON_RAW is empty.")
        sys.exit(1)

    raw = raw.strip()

    # Optional: support base64-encoded secrets to avoid YAML/newline/quote issues
    if raw.startswith("base64:"):
        b64 = raw[len("base64:") :].strip()
        try:
            return base64.b64decode(b64).decode("utf-8")
        except Exception as e:
            print(f"❌ Error: failed to base64 decode CLASPRC_JSON_RAW: {e}")
            sys.exit(1)

    return raw

def validate_clasprc(data: dict) -> None:
    # We don’t try to “fix” formats; we only sanity-check the common clasp format.
    # Typical modern clasp creds contain `token` and `oauth2ClientSettings`.
    if "token" in data:
        token = data.get("token") or {}
        if not token.get("refresh_token"):
            print("❌ Error: token.refresh_token missing in .clasprc.json")
            sys.exit(1)
    else:
        # If you store some other shape (older/newer), we allow it,
        # but at least ensure it’s an object.
        pass

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

    validate_clasprc(data)

    # Write exactly as provided (no transformation)
    targets = [Path.home() / ".clasprc.json", Path.cwd() / ".clasprc.json"]
    for p in targets:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"✅ Wrote credentials to {p}")

if __name__ == "__main__":
    main()
