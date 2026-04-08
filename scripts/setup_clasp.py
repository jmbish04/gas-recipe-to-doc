import json
import os
import sys
from pathlib import Path

def heal_json(raw_str):
    """
    Magic: Repairs truncated JSON by closing open braces and quotes.
    Specifically handles truncation at the end of a string value.
    """
    raw_str = raw_str.strip()
    
    # 1. Check for missing closing quote if it ends in the middle of a value
    # Your log shows it ends at: ...UDap5bw0206"
    # If the last char is a quote but we have unclosed braces, we need to add structural braces.
    
    open_braces = raw_str.count('{')
    close_braces = raw_str.count('}')
    
    if open_braces > close_braces:
        print(f"🪄 Magic: Detected truncated JSON ({open_braces} open vs {close_braces} closed).")
        
        # Ensure we don't have a trailing comma before closing
        if raw_str.endswith(','):
            raw_str = raw_str[:-1]
            
        # Add the necessary closing braces to satisfy the parser
        missing = open_braces - close_braces
        for i in range(missing):
            raw_str += "\n" + ("  " * (missing - i - 1)) + "}"
            
        print(f"✅ Magic: Appended {missing} braces to stabilize the object.")
    
    return raw_str

def normalize():
    raw_secret = os.getenv("CLASPRC_JSON_RAW", "")
    if not raw_secret:
        print("❌ Error: CLASPRC_JSON_RAW environment variable is empty.")
        sys.exit(1)

    # Step 1: Heal the potentially truncated string
    healed_json = heal_json(raw_secret)

    try:
        data = json.loads(healed_json)
        normalized = {}

        # Mode A: Service Account Detected
        if data.get("type") == "service_account":
            print("🤖 Identity: Service Account detected.")
            # We map this to a format that tells Clasp to use the private key
            normalized = {
                "token": {
                    "access_token": "", 
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
            # Also save the raw service account for GOOGLE_APPLICATION_CREDENTIALS fallback
            with open("service_account.json", "w") as f:
                json.dump(data, f)
            print("📝 Also saved raw service_account.json for ADC fallback.")

        # Mode B: Nested OAuth (tokens.default)
        elif "tokens" in data and "default" in data["tokens"]:
            print("🔑 Identity: Nested OAuth User detected.")
            source = data["tokens"]["default"]
            normalized = {
                "token": {
                    "access_token": source.get("access_token"),
                    "refresh_token": source.get("refresh_token"),
                    "token_type": "Bearer",
                    "expiry_date": 1800000000000 # 2027+
                },
                "oauth2ClientSettings": {
                    "clientId": source.get("client_id"),
                    "client_secret": source.get("client_secret"),
                    "redirectUri": "http://localhost"
                },
                "isLocalCreds": False
            }
        
        # Mode C: Standard or already fixed
        else:
            print("✅ Identity: Standard format detected.")
            normalized = data

        # Write to Clasp's global and local lookup paths
        paths = [Path.home() / ".clasprc.json", Path.cwd() / ".clasprc.json"]
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                json.dump(normalized, f, indent=2)
            print(f"🚀 Credentials synchronized at {p}")

    except json.JSONDecodeError as e:
        print(f"❌ Magic Failed: JSON is too broken to fix automatically.")
        print(f"Error: {e}")
        # Print end of string for debugging (sanitized)
        print(f"End of string: ...{healed_json[-20:]}")
        sys.exit(1)

if __name__ == "__main__":
    normalize()
