"""Run this once to authorize the app to upload files to your own Google
Drive. Opens a browser window for you to sign in and approve access, then
saves a reusable token file so the app never needs this again (until you
revoke access or delete the token file).

Usage:
    python authorize_google_drive.py

See GOOGLE_DRIVE_SETUP.md for the full setup walkthrough (creating the
OAuth client, enabling the Drive API, etc.) before running this.
"""
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
SCOPES = ['https://www.googleapis.com/auth/drive.file']


def main():
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("Missing dependency — run: pip install -r requirements.txt")
        return

    with open(CONFIG_PATH, encoding='utf-8') as f:
        config = json.load(f)
    drive_cfg = config.get('google_drive', {})

    client_secret_path = drive_cfg.get('oauth_client_secret_path', 'oauth_client_secret.json')
    if not os.path.isabs(client_secret_path):
        client_secret_path = os.path.join(os.path.dirname(__file__), client_secret_path)

    token_path = drive_cfg.get('oauth_token_path', 'drive_token.json')
    if not os.path.isabs(token_path):
        token_path = os.path.join(os.path.dirname(__file__), token_path)

    if not os.path.exists(client_secret_path):
        print(f"Could not find the OAuth client file at:\n  {client_secret_path}\n")
        print("Download it from Google Cloud Console (APIs & Services > Credentials >")
        print("your OAuth 2.0 Client ID > Download JSON), rename it to match")
        print("'google_drive.oauth_client_secret_path' in config.json, and place it")
        print("in this project folder. See GOOGLE_DRIVE_SETUP.md.")
        return

    print("Opening your browser to sign in with Google and approve access...")
    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    creds = flow.run_local_server(port=0)

    with open(token_path, 'w', encoding='utf-8') as f:
        f.write(creds.to_json())

    print(f"\nAuthorization complete! Saved to: {token_path}")
    print("You can now use the Upload Challan button and the Business Pad image upload.")


if __name__ == '__main__':
    main()
