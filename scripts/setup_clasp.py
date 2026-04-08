import json
import os
import sys
from pathlib import Path

def heal_json(raw_str):
    """Magic: Repairs truncated JSON by closing open braces."""
    raw_str = raw_str.strip()
    open_braces = raw_str.count('{')
    close_braces = raw_str.count('}')
    
    if open_braces > close_braces:
        # If it ends mid-string, close the quote first
        if raw_str.endswith('"') and not raw_str.endswith('}"'):
             pass # Already has a quote
        elif not raw_secret.endswith('"'):
             raw_str += '"' # Add missing quote if needed
             
        # Add missing braces
        missing = open_braces - close_braces
        raw_str += ("\n" + "  " * missing + "}") * missing
        print(f"🪄 Magic: Appended {missing} missing braces to heal JSON.")
    return raw_str

def normalize():
    raw_secret = os.getenv("CLASPRC_JSON_RAW", "")
    if not raw_secret:
        print("❌ Error: CLASPRC_JSON_RAW is empty.")
        sys.exit(1)

    # Apply healing magic
    healed_json = heal_json(raw_secret)

    try:
        data = json.loads(healed_json)
        normalized = {}

        # Mode A: Service Account Detected
        if data.get("type") == "service_account":
            print("🤖 Mode: Service Account detected.")
            normalized = {
                "token": {
                    "access_token": "", # Clasp will fetch this using the private key
                    "refresh_token": "service_account",
                    "expiry_date": 0
                },
                "oauth2ClientSettings": {
                    "clientId": data.get("client_id"),
                    "client_secret": data.get("private_key"),
                    "redirectUri": "http://localhost"
                },
                "isLocalCreds": False
            }
            print("⚠️ Note: Ensure your Script is shared with the Service Account email.")

        # Mode B: Nested OAuth (tokens.default)
        elif "tokens" in data and "default" in data["tokens"]:
            print("🔑 Mode: Nested OAuth detected.")
            source = data["tokens"]["default"]
            normalized = {
                "token": {
                    "access_token": source.get("access_token"),
                    "refresh_token": source.get("refresh_token"),
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
        
        # Mode C: Already Flattened
        else:
            print("✅ Mode: Standard Flattened JSON detected.")
            normalized = data

        # Write to Clasp's standard locations
        paths = [Path.home() / ".clasprc.json", Path.cwd() / ".clasprc.json"]
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                json.dump(normalized, f, indent=2)
            print(f"🚀 Credentials ready at {p}")

    except Exception as e:
        print(f"❌ Magic failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    normalize()
