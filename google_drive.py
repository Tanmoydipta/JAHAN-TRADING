"""Google Drive upload helper for the Sales Report's challan-file attachment.

Uses a service account (not per-user OAuth) so uploads work headlessly from
the Flask app with no browser consent step. See GOOGLE_DRIVE_SETUP.md for the
one-time setup: create the Google Cloud project, enable the Drive API,
generate the service-account JSON key, and share the destination folder with
the service account's email address.
"""
import io
import os

from database import load_config


def _get_drive_service():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        raise ValueError(
            "Google Drive upload requires the 'google-api-python-client' and "
            "'google-auth' packages. Run: pip install -r requirements.txt"
        )

    config = load_config()
    drive_cfg = config.get('google_drive', {})
    key_path = drive_cfg.get('service_account_key_path')
    if not key_path:
        raise ValueError(
            "Google Drive is not configured yet — set 'google_drive.service_account_key_path' "
            "in config.json. See GOOGLE_DRIVE_SETUP.md."
        )

    resolved = key_path
    if not os.path.isabs(resolved):
        resolved = os.path.join(os.path.dirname(__file__), resolved)
    if not os.path.exists(resolved):
        raise FileNotFoundError(
            f"Google service account key not found at '{resolved}'. Follow "
            f"GOOGLE_DRIVE_SETUP.md to create one, then place the downloaded JSON "
            f"key file there (or update 'google_drive.service_account_key_path' in config.json)."
        )

    folder_id = drive_cfg.get('challans_folder_id')
    if not folder_id:
        raise ValueError(
            "Google Drive challans folder is not configured — paste the shared "
            "folder's ID into 'google_drive.challans_folder_id' in config.json. "
            "See GOOGLE_DRIVE_SETUP.md."
        )

    creds = service_account.Credentials.from_service_account_file(
        resolved, scopes=['https://www.googleapis.com/auth/drive']
    )
    service = build('drive', 'v3', credentials=creds, cache_discovery=False)
    return service, folder_id


def upload_challan_to_drive(file_bytes, filename, mime_type):
    """Uploads a challan photo/scan to the shared Challans Drive folder.
    Returns {"file_id": ..., "view_url": ...}."""
    from googleapiclient.http import MediaIoBaseUpload

    service, folder_id = _get_drive_service()
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=False)
    file_metadata = {'name': filename, 'parents': [folder_id]}
    created = service.files().create(
        body=file_metadata, media_body=media, fields='id, webViewLink'
    ).execute()
    return {"file_id": created['id'], "view_url": created.get('webViewLink')}
