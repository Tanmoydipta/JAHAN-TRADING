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


def upload_file_to_drive(file_bytes, filename, mime_type, make_public=False):
    """Uploads a file into the configured shared Drive folder.

    make_public=False (challans): the folder is already shared with the
    business owner's own Google account (they created it), so a plain
    webViewLink is enough for them to open it manually — no need to widen
    access beyond that.

    make_public=True (letterhead pad image): the browser has to load this
    as a plain <img>/background-image for *any* logged-in staff member
    printing an invoice, which requires the file to be fetchable without a
    Google login — so we explicitly grant "anyone with the link, viewer"
    and return the direct-content URL format instead of the view-page link.
    """
    from googleapiclient.http import MediaIoBaseUpload

    service, folder_id = _get_drive_service()
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=False)
    file_metadata = {'name': filename, 'parents': [folder_id]}
    created = service.files().create(
        body=file_metadata, media_body=media, fields='id, webViewLink'
    ).execute()
    file_id = created['id']
    view_url = created.get('webViewLink')

    if make_public:
        service.permissions().create(
            fileId=file_id, body={'type': 'anyone', 'role': 'reader'}
        ).execute()
        view_url = f"https://drive.google.com/uc?export=view&id={file_id}"

    return {"file_id": file_id, "view_url": view_url}


def upload_challan_to_drive(file_bytes, filename, mime_type):
    """Uploads a challan photo/scan to the shared Challans Drive folder.
    Returns {"file_id": ..., "view_url": ...}."""
    return upload_file_to_drive(file_bytes, filename, mime_type, make_public=False)


def upload_letterhead_pad_image(file_bytes, filename, mime_type):
    """Uploads the business pad header image so it can be embedded as a
    background-image in the invoice/quotation pads for any logged-in user.
    Returns {"file_id": ..., "view_url": ...} — view_url is a direct-content
    link (drive.google.com/uc?export=view), not the Drive viewer page."""
    return upload_file_to_drive(file_bytes, filename, mime_type, make_public=True)
