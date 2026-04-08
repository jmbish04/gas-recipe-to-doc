import json
import os
from pathlib import Path

def normalize_clasp_credentials():
    # 1. Retrieve the raw secret from environment variable
    raw_secret = os.getenv("CLASPRC_JSON_RAW")
    if not raw_secret:
        print("Error: CLASPRC_JSON_RAW environment variable is empty.")
        exit(1)

    try:
        data = json.loads(raw_secret)
        
        # 2. Extract nested data from your specific structure
        # Expected: {"tokens": {"default": {...}}}
        source = data.get("tokens", {}).get("default", {})
        
        if not source:
            print("Error: Could not find 'tokens.default' in the provided JSON.")
            exit(1)

        # 3. Construct the flattened clasp schema
        # Note: We include standard GAS scopes required for clasp operations
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
                "expiry_date": 1744128000000  # Default future expiry
            },
            "oauth2ClientSettings": {
                "clientId": source.get("client_id"),
                "client_secret": source.get("client_secret"),
                "redirectUri": "http://localhost"
            },
            "isLocalCreds": False
        }

        # 4. Define paths (Global Home and Local Project)
        home_path = Path.home() / ".clasprc.json"
        local_path = Path.cwd() / ".clasprc.json"

        # 5. Write credentials to both locations for redundancy
        for path in [home_path, local_path]:
            with open(path, "w") as f:
                json.dump(normalized, f, indent=2)
            print(f"Successfully wrote credentials to {path}")

    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        exit(1)

if __name__ == "__main__":
    normalize_clasp_credentials()
