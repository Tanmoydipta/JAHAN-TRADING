from flask import Flask, jsonify, request, send_from_directory, Response
import os
import sys
import subprocess
import webbrowser
import threading
from datetime import datetime
from database import (
    init_db, load_config,
    save_entry, save_multi_item_entry, execute_report, get_invoice_data,
    authenticate_user, create_user, get_all_users,
    get_next_chalan, list_products, list_customers,
    list_inventory, get_dashboard,
    authorize_entry, list_pending_transactions,
    delete_entry, delete_user, update_user, update_record,
    adjust_entry, list_invoice_refs,
    list_modifiable_refs, get_editable_record, update_multi_item_entry,
    create_session_token, verify_session_token, revoke_session_token,
    get_letterhead_settings, save_letterhead_settings,
    list_quotation_refs, get_quotation_data, approve_quotation,
    save_challan_upload
)
from google_drive import upload_challan_to_drive, upload_letterhead_pad_image, download_file_from_drive


def get_base_dir():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = get_base_dir()
STATIC_DIR = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='/static')
app.json.sort_keys = False  # preserve SELECT-clause column order in report data

init_db()

# Endpoints reachable without a session token. Everything else requires
# "Authorization: Bearer <token>" — enforced centrally so a route added
# later is locked down by default instead of relying on remembering to
# opt each one in individually.
# pad_image_proxy is public because it's loaded as a plain CSS
# background-image URL (no way to attach an Authorization header to that),
# and the content itself — a company letterhead image — isn't sensitive.
PUBLIC_PATHS = {'/', '/api/config', '/api/login', '/api/letterhead/pad_image_proxy'}


@app.before_request
def _enforce_auth():
    if request.path in PUBLIC_PATHS or request.path.startswith('/static/'):
        return None
    auth_header = request.headers.get('Authorization', '')
    token = auth_header[7:] if auth_header.startswith('Bearer ') else None
    user = verify_session_token(token)
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    request.current_user = user
    request.current_token = token


def _default_client_id(cid=None):
    if cid:
        return cid
    return load_config()['system'].get('default_client_id', 'CLI-001')


def _scoped_client_id(requested_cid):
    """Resolve which client_id this request may act on. Regular users are
    pinned to their own client_id no matter what they pass in; only roles
    with can_view_all_clients may cross into another client's data.
    Returns None if the request should be rejected as forbidden."""
    user = request.current_user
    role_def = load_config().get('roles', {}).get(user['role'], {})
    if role_def.get('can_view_all_clients'):
        return _default_client_id(requested_cid)
    if requested_cid and requested_cid != user['client_id']:
        return None
    return user['client_id']


def _forbidden():
    return jsonify({"status": "error", "message": "Forbidden: cannot access another client's data"}), 403


@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/api/config', methods=['GET'])
def api_get_config():
    # Never expose raw database_config to the browser — it contains the
    # live DB host/user/password. The frontend only needs to know which
    # engine is active (to show "MySQL Connected" vs "SQLite Connected").
    config = load_config()
    public_config = {k: v for k, v in config.items() if k != 'database_config'}
    public_config['database_config'] = {
        'mode': config.get('database_config', {}).get('mode', 'sqlite')
    }
    public_config['letterhead'] = get_letterhead_settings()
    return jsonify(public_config)


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({"status": "error", "message": "Username and password required"}), 400

    user = authenticate_user(username, password)
    if not user:
        return jsonify({"status": "error", "message": "Invalid username or password"}), 401

    config = load_config()
    roles = config.get('roles', {})
    user_role_def = roles.get(user['role'], {
        "title": user['role'],
        "allowed_entry_points": [],
        "allowed_report_points": [],
        "can_manage_users": False
    })

    token = create_session_token(user)

    return jsonify({
        "status": "success",
        "user": user,
        "role_permissions": user_role_def,
        "token": token
    })


@app.route('/api/logout', methods=['POST'])
def api_logout():
    revoke_session_token(request.current_token)
    return jsonify({"status": "success"})


@app.route('/api/users', methods=['GET', 'POST'])
def api_manage_users():
    if request.current_user['role'] != 'admin':
        return jsonify({"status": "error", "message": "Only an admin can manage user accounts"}), 403

    if request.method == 'GET':
        try:
            return jsonify(get_all_users())
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 400

    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    full_name = data.get('full_name', username)
    role = data.get('role', 'employee')
    client_id = data.get('client_id', 'CLI-001')

    if not username or not password:
        return jsonify({"status": "error", "message": "Username and Password required"}), 400
    try:
        return jsonify(create_user(username, password, full_name, role, client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/dashboard', methods=['GET'])
def api_get_dashboard():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    try:
        return jsonify(get_dashboard(client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/next_chalan', methods=['GET'])
def api_next_chalan():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    return jsonify({"chalan_no": get_next_chalan(client_id)})


@app.route('/api/products', methods=['GET'])
def api_products():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    return jsonify(list_products(client_id))


@app.route('/api/inventory', methods=['GET'])
def api_inventory():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    return jsonify(list_inventory(client_id))


@app.route('/api/customers', methods=['GET'])
def api_customers():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    ctype = request.args.get('type')
    return jsonify(list_customers(client_id, ctype))


@app.route('/api/entry/<entry_id>', methods=['POST'])
def api_save_entry(entry_id):
    try:
        data = request.json or {}
        client_id = _scoped_client_id(data.get('client_id'))
        if client_id is None:
            return _forbidden()
        created_by = request.current_user['username']
        return jsonify(save_entry(entry_id, data, client_id=client_id, created_by=created_by))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/entry/<entry_id>/multi', methods=['POST'])
def api_save_multi_entry(entry_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    created_by = request.current_user['username']
    shared = data.get('shared', {})
    line_items = data.get('line_items', [])
    try:
        return jsonify(save_multi_item_entry(entry_id, shared, line_items, client_id=client_id, created_by=created_by))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/modify_refs', methods=['GET'])
def api_modify_refs():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    table_name = request.args.get('table', 'sales')
    try:
        return jsonify(list_modifiable_refs(table_name, client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/entry_record', methods=['GET'])
def api_entry_record():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    table_name = request.args.get('table', 'sales')
    reference_no = request.args.get('reference_no')
    try:
        res = get_editable_record(table_name, reference_no, client_id=client_id)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    if not res:
        return jsonify({"status": "error", "message": "Record not found"}), 404
    return jsonify(res)


@app.route('/api/entry/<entry_id>/modify', methods=['POST'])
def api_modify_multi_entry(entry_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    requested_by = request.current_user['username']
    original_ref = data.get('original_ref')
    shared = data.get('shared', {})
    line_items = data.get('line_items', [])
    try:
        return jsonify(update_multi_item_entry(
            entry_id, original_ref, shared, line_items,
            client_id=client_id, requested_by=requested_by
        ))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/pending', methods=['GET'])
def api_pending_transactions():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    try:
        return jsonify(list_pending_transactions(client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/authorize/<table_name>/<int:record_id>', methods=['POST'])
def api_authorize_entry(table_name, record_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    authorized_by = request.current_user['username']
    try:
        return jsonify(authorize_entry(table_name, record_id, authorized_by, client_id))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/report/<report_id>', methods=['GET'])
def api_get_report(report_id):
    try:
        client_id = _scoped_client_id(request.args.get('client_id'))
        if client_id is None:
            return _forbidden()
        date_from = request.args.get('from') or None
        date_to = request.args.get('to') or None
        customer = request.args.get('customer') or None
        txn_type = request.args.get('txn_type') or None
        record_mode = request.args.get('record_mode') or None
        res = execute_report(report_id, client_id=client_id,
                             date_from=date_from, date_to=date_to,
                             customer=customer, txn_type=txn_type,
                             record_mode=record_mode)
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/invoice/<invoice_id>', methods=['GET'])
def api_get_invoice(invoice_id):
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    res = get_invoice_data(invoice_id, client_id=client_id)
    if not res:
        return jsonify({"status": "error", "message": "Invoice not found"}), 404
    return jsonify(res)


@app.route('/api/record/<table_name>/<int:record_id>', methods=['DELETE'])
def api_delete_record(table_name, record_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    requested_by = request.current_user['username']
    try:
        return jsonify(delete_entry(table_name, record_id, requested_by, client_id))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/record/<table_name>/<int:record_id>', methods=['PUT'])
def api_update_record(table_name, record_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    requested_by = request.current_user['username']
    try:
        return jsonify(update_record(table_name, record_id, data, requested_by, client_id))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/record/<table_name>/<int:record_id>/adjust', methods=['POST'])
def api_adjust_record(table_name, record_id):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    requested_by = request.current_user['username']
    payment_due_date = data.get('payment_due_date') or None
    additional_advance = data.get('additional_advance')
    additional_advance = None if additional_advance in (None, "") else additional_advance
    try:
        return jsonify(adjust_entry(
            table_name, record_id, requested_by,
            payment_due_date=payment_due_date,
            additional_advance=additional_advance,
            client_id=client_id
        ))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/invoice_refs', methods=['GET'])
def api_invoice_refs():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    ref_type = request.args.get('type', 'sales')
    try:
        return jsonify(list_invoice_refs(ref_type, client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def api_delete_user(user_id):
    if request.current_user['role'] != 'admin':
        return jsonify({"status": "error", "message": "Only an admin can delete user accounts"}), 403
    try:
        return jsonify(delete_user(user_id, request.current_user['username']))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/users/<int:user_id>', methods=['PUT'])
def api_update_user(user_id):
    if request.current_user['role'] != 'admin':
        return jsonify({"status": "error", "message": "Only an admin can edit user accounts"}), 403
    data = request.json or {}
    new_username = (data.get('username') or '').strip() or None
    new_password = data.get('password') or None
    try:
        return jsonify(update_user(user_id, request.current_user['username'], new_username, new_password))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/quotation_refs', methods=['GET'])
def api_quotation_refs():
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    try:
        return jsonify(list_quotation_refs(client_id))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/quotation/<quotation_no>', methods=['GET'])
def api_get_quotation(quotation_no):
    client_id = _scoped_client_id(request.args.get('client_id'))
    if client_id is None:
        return _forbidden()
    res = get_quotation_data(quotation_no, client_id=client_id)
    if not res:
        return jsonify({"status": "error", "message": "Quotation not found"}), 404
    return jsonify(res)


@app.route('/api/quotation/<quotation_no>/approve', methods=['POST'])
def api_approve_quotation(quotation_no):
    data = request.json or {}
    client_id = _scoped_client_id(data.get('client_id'))
    if client_id is None:
        return _forbidden()
    requested_by = request.current_user['username']
    try:
        return jsonify(approve_quotation(quotation_no, requested_by, client_id=client_id))
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/sales/<chalan_no>/challan', methods=['POST'])
def api_upload_challan(chalan_no):
    client_id = _scoped_client_id(request.form.get('client_id'))
    if client_id is None:
        return _forbidden()
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({"status": "error", "message": "No file provided"}), 400

    buyer_name = (request.form.get('buyer_name') or 'Customer').strip()
    sale_date = (request.form.get('sale_date') or datetime.now().strftime('%Y-%m-%d')).strip()
    ext = os.path.splitext(file.filename)[1] or '.jpg'
    safe_buyer = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in buyer_name).strip()
    drive_filename = f"{chalan_no}_{safe_buyer}_{sale_date}{ext}"

    try:
        file_bytes = file.read()
        uploaded = upload_challan_to_drive(file_bytes, drive_filename, file.mimetype or 'application/octet-stream')
        uploaded_by = request.current_user['username']
        result = save_challan_upload(
            chalan_no, client_id, drive_filename,
            uploaded['file_id'], uploaded['view_url'], uploaded_by
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/letterhead', methods=['POST'])
def api_update_letterhead():
    try:
        new_letterhead = request.json or {}
        updated = save_letterhead_settings(new_letterhead)
        return jsonify({"status": "success", "letterhead": updated})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/letterhead/pad_image', methods=['POST'])
def api_upload_letterhead_pad_image():
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({"status": "error", "message": "No file provided"}), 400
    try:
        file_bytes = file.read()
        ext = os.path.splitext(file.filename)[1] or '.jpg'
        uploaded = upload_letterhead_pad_image(file_bytes, f"letterhead_pad{ext}", file.mimetype or 'image/jpeg')
        # Store the bare Drive file_id, not a direct Drive URL — Google sends
        # Cross-Origin-Resource-Policy: same-site on that URL, which blocks
        # browsers from loading it as a background-image on our own domain.
        # The frontend instead points at our own pad_image_proxy below.
        updated = save_letterhead_settings({'pad_image': uploaded['file_id']})
        return jsonify({"status": "success", "pad_image": uploaded['file_id'], "letterhead": updated})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/letterhead/pad_image_proxy', methods=['GET'])
def api_letterhead_pad_image_proxy():
    """Streams the pad image through our own origin instead of the browser
    loading it directly from Drive — sidesteps Drive's
    Cross-Origin-Resource-Policy: same-site header, which otherwise blocks
    the image from loading as a background-image on any other site."""
    lh = get_letterhead_settings()
    file_id = lh.get('pad_image')
    if not file_id:
        return jsonify({"status": "error", "message": "No pad image configured"}), 404
    try:
        file_bytes, mime_type = download_file_from_drive(file_id)
        return Response(file_bytes, mimetype=mime_type, headers={
            'Cache-Control': 'public, max-age=3600'
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


def open_browser():
    webbrowser.open_new('http://127.0.0.1:5000/')


NOTIFICATION_TASK_NAME = "JahanTradingSystemDueNotifications"


def ensure_notification_task():
    """Self-register a Windows Scheduled Task that runs this same exe daily
    with --check-notifications, so due-date alerts fire even when nobody
    has the app/browser open. No-op on non-Windows or if already registered."""
    if os.name != 'nt':
        return
    try:
        exists = subprocess.run(
            ["schtasks", "/query", "/tn", NOTIFICATION_TASK_NAME],
            capture_output=True
        ).returncode == 0
        if exists:
            return

        if getattr(sys, 'frozen', False):
            exe_cmd = f'"{sys.executable}" --check-notifications'
        else:
            exe_cmd = f'"{sys.executable}" "{os.path.abspath(__file__)}" --check-notifications'

        subprocess.run(
            ["schtasks", "/create", "/tn", NOTIFICATION_TASK_NAME,
             "/tr", exe_cmd, "/sc", "daily", "/st", "08:00", "/f"],
            capture_output=True, check=True
        )
        print(f"Registered daily due-date notification task '{NOTIFICATION_TASK_NAME}' (08:00).")
    except Exception as e:
        print(f"Could not register notification task: {e}")


if __name__ == '__main__':
    if '--check-notifications' in sys.argv:
        from notifications import check_and_notify_due_payments
        check_and_notify_due_payments()
        sys.exit(0)

    print("==================================================")
    print("      JAHAN TRADING SYSTEM - STARTING SERVER      ")
    print("==================================================")
    print("App URL: http://127.0.0.1:5000/  (also reachable on your LAN IP:5000, e.g. for the Android app)")
    ensure_notification_task()
    threading.Timer(1.2, open_browser).start()
    app.run(host='0.0.0.0', port=5000, debug=False)
