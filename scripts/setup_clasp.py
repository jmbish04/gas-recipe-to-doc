import json
import os
import sys
from pathlib import Path

def normalize_clasp_credentials():
    raw_secret = os.getenv("CLASPRC_JSON_RAW", "").strip()
    
    if not raw_secret:
        print("❌ Error: CLASPRC_JSON_RAW is empty.")
        sys.exit(1)

    # --- SELF-HEALING LOGIC ---
    # If the secret ends with a quote but no braces, append them.
    if raw_secret.endswith('"') and not raw_secret.endswith('}'):
        print("⚠️ Warning: Malformed JSON detected (missing braces). Attempting auto-fix...")
        raw_secret += "\n    }\n  }\n}"

    try:
        data = json.loads(raw_secret)
        
        # Access the nested tokens structure
        source = data.get("tokens", {}).get("default", {})
        if not source:
            print("❌ Error: 'tokens.default' structure not found.")
            sys.exit(1)

        # Flatten into the format Clasp expects
        normalized = {
            "token": {
                "access_token": source.get("access_token"),
                "refresh_token": source.get("refresh_token"),
                "scope": "https://www.googleapis.com/auth/script.deployments https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.webapp.deploy https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/service.management https://www.googleapis.com/auth/logging.read https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid",
                "token_type": "Bearer",
                "expiry_date": 1744128000000
            },
            "oauth2ClientSettings": {
                "clientId": source.get("client_id"),
                "client_secret": source.get("client_secret"),
                "redirectUri": "http://localhost"
            },
            "isLocalCreds": False
        }

        # Write to both locations to ensure Clasp finds it
        paths = [Path.home() / ".clasprc.json", Path.cwd() / ".clasprc.json"]
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                json.dump(normalized, f, indent=2)
            print(f"✅ Credentials successfully written to {p}")

    except json.JSONDecodeError as e:
        print(f"❌ Critical JSON Error: {e}")
        print(f"Final character was: '{raw_secret[-1]}'")
        sys.exit(1)

if __name__ == "__main__":
    normalize_clasp_credentials()
