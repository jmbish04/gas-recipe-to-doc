import json
import os
import sys
from pathlib import Path

def normalize_clasp_credentials():
    raw_secret = os.getenv("CLASPRC_JSON_RAW")
    
    if not raw_secret:
        print("❌ Error: CLASPRC_JSON_RAW environment variable is empty.")
        sys.exit(1)

    try:
        # Attempt to parse the JSON
        data = json.loads(raw_secret)
        
        # Flatten the nested "multi-profile" structure
        source = data.get("tokens", {}).get("default", {})
        
        if not source:
            print("❌ Error: Could not find 'tokens.default' path in the secret.")
            sys.exit(1)

        normalized = {
            "token": {
                "access_token": source.get("access_token"),
                "refresh_token": source.get("refresh_token"),
                "scope": "https://www.googleapis.com/auth/script.deployments "
                         "https://www.googleapis.com/auth/script.projects "
                         "https://www.googleapis.com/auth/script.webapp.deploy "
                         "https://www.googleapis.com/auth/drive.metadata.readonly "
                         "https://www.googleapis.com/auth/drive.file "
                         "https://www.googleapis.com/auth/service.management "
                         "https://www.googleapis.com/auth/logging.read "
                         "https://www.googleapis.com/auth/userinfo.email "
                         "https://www.googleapis.com/auth/userinfo.profile openid",
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

        # Paths for Clasp lookup
        home_path = Path.home() / ".clasprc.json"
        local_path = Path.cwd() / ".clasprc.json"

        for p in [home_path, local_path]:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                json.dump(normalized, f, indent=2)
            print(f"✅ Credentials written to {p}")

    except json.JSONDecodeError as e:
        print(f"❌ JSON Parsing Error: {e}")
        # Debugging: Show the start and end of the string to check for truncation
        clean_debug = raw_secret.strip()
        print(f"Debug - Secret Length: {len(clean_debug)} chars")
        print(f"Debug - Start: {clean_debug[:30]}...")
        print(f"Debug - End: ...{clean_debug[-30:]}")
        sys.exit(1)

if __name__ == "__main__":
    normalize_clasp_credentials()
