"""Google Drive upload helper for the Sales Report's challan-file attachment
and the Business Pad Setup's letterhead image.

Uses OAuth as the business owner's *own* Google account — not a service
account. Service accounts have no storage quota of their own and cannot use
a personal Google Drive's quota either (Google only allows that inside a
paid Google Workspace "Shared Drive"), so for a normal personal/free Google
account, uploading has to happen as the real account.

One-time setup: run `python authorize_google_drive.py` locally to complete
a browser sign-in once; it saves a reusable token file
(`google_drive.oauth_token_path` in config.json, default 'drive_token.json')
so the app never has to ask again (access tokens refresh automatically using
the saved refresh token). See GOOGLE_DRIVE_SETUP.md for the full walkthrough.
"""
import io
import os
import tempfile

from database import load_config

SCOPES = ['https://www.googleapis.com/auth/drive.file']


def _resolve_path(path):
    if not path:
        return path
    if os.path.isabs(path):
        return path
    return os.path.join(os.path.dirname(__file__), path)


def _writable_token_cache_path():
    """Fallback location for a refreshed token when oauth_token_path isn't
    writable — e.g. on Render, config.json's google_drive.oauth_token_path
    points at /etc/secrets/drive_token.json, which is a read-only Secret
    File mount. Without this, every refresh crashes with
    `[Errno 30] Read-only file system`, which breaks both challan uploads
    and the pad_image_proxy (since both go through _get_drive_service())."""
    return os.path.join(tempfile.gettempdir(), 'jahan_drive_token_cache.json')


def _get_drive_service():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        raise ValueError(
            "Google Drive upload requires the 'google-api-python-client', 'google-auth' "
            "and 'google-auth-oauthlib' packages. Run: pip install -r requirements.txt"
        )

    config = load_config()
    drive_cfg = config.get('google_drive', {})

    folder_id = drive_cfg.get('challans_folder_id')
    if not folder_id:
        raise ValueError(
            "Google Drive folder is not configured — paste the shared folder's ID into "
            "'google_drive.challans_folder_id' in config.json. See GOOGLE_DRIVE_SETUP.md."
        )

    token_path = _resolve_path(drive_cfg.get('oauth_token_path', 'drive_token.json'))
    fallback_path = _writable_token_cache_path()
    # A previously-refreshed token cached in the fallback location is newer
    # than whatever's at token_path (which may be a stale, unwritable Secret
    # File), so prefer it if present.
    load_path = fallback_path if os.path.exists(fallback_path) else token_path
    if not os.path.exists(load_path):
        raise ValueError(
            "Google Drive isn't authorized yet — run 'python authorize_google_drive.py' once "
            "from the project folder to complete the one-time Google sign-in. See GOOGLE_DRIVE_SETUP.md."
        )

    creds = Credentials.from_authorized_user_file(load_path, SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            from google.auth.exceptions import RefreshError
            try:
                creds.refresh(Request())
            except RefreshError:
                # The saved refresh_token itself is no longer valid (revoked
                # from Google Account security settings, unused too long, or
                # too many tokens issued for this OAuth client) — refreshing
                # raises invalid_grant here rather than just leaving creds
                # invalid, so this needs its own re-authorize message.
                raise ValueError(
                    "Google Drive authorization has expired or was revoked — run "
                    "'python authorize_google_drive.py' again to re-authorize, then "
                    "update the drive_token.json Secret File on Render with the new "
                    "token. See GOOGLE_DRIVE_SETUP.md."
                )
            try:
                with open(token_path, 'w', encoding='utf-8') as f:
                    f.write(creds.to_json())
            except OSError:
                # token_path isn't writable (e.g. Render's /etc/secrets
                # mount) — cache the refreshed token in a writable spot
                # instead so later requests in this process reuse it rather
                # than re-refreshing (and failing to persist) every time.
                with open(fallback_path, 'w', encoding='utf-8') as f:
                    f.write(creds.to_json())
        else:
            raise ValueError(
                "Google Drive authorization has expired or was revoked — run "
                "'python authorize_google_drive.py' again to re-authorize. See GOOGLE_DRIVE_SETUP.md."
            )

    service = build('drive', 'v3', credentials=creds, cache_discovery=False)
    return service, folder_id


def upload_file_to_drive(file_bytes, filename, mime_type, make_public=False):
    """Uploads a file into the configured shared Drive folder, as the
    authorized user's own Google account.

    make_public=False (challans): the file lands in the business owner's own
    Drive folder — they can already see it directly as the owner, no need to
    widen access.

    make_public=True (letterhead pad image): the browser has to load this as
    a plain <img>/background-image for *any* logged-in staff member printing
    an invoice, which requires the file to be fetchable without a Google
    login — so we explicitly grant "anyone with the link, viewer" and return
    the direct-content URL format instead of the view-page link.
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
    """Uploads the business pad header image. Returns {"file_id": ..., "view_url": ...}.

    Also grants "anyone with the link, viewer" so the file can be opened
    directly in a browser tab if needed — but the app itself does NOT embed
    this URL directly as an <img>/background-image: Google sends
    `Cross-Origin-Resource-Policy: same-site` on the direct-content URL,
    which browsers enforce to block exactly that kind of cross-site
    embedding (confirmed by testing — the URL opens fine as a full page
    navigation but fails to load as an <img> src). Instead, the app stores
    just the file_id and streams the image through its own
    /api/letterhead/pad_image_proxy endpoint (see download_file_from_drive()
    below and app.py), which sidesteps the header entirely since the browser
    then only ever talks to our own origin for this image.
    """
    return upload_file_to_drive(file_bytes, filename, mime_type, make_public=True)


def download_file_from_drive(file_id):
    """Fetches a file's bytes + mime type server-side (no CORP/CORS
    restriction applies to server-to-server requests) for
    /api/letterhead/pad_image_proxy to stream back through our own origin."""
    service, _ = _get_drive_service()
    meta = service.files().get(fileId=file_id, fields='mimeType').execute()
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    from googleapiclient.http import MediaIoBaseDownload
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), meta.get('mimeType', 'image/jpeg')
