import sqlite3
import json
import os
import ssl
import hashlib
import secrets
from datetime import datetime, timedelta
from secure_config import decrypt_dict

SESSION_TOKEN_TTL_DAYS = 30

try:
    import pymysql
    PYMYSQL_AVAILABLE = True
except ImportError:
    PYMYSQL_AVAILABLE = False

# Overridable so a cloud host (which never gets config.json committed to
# its repo — it holds live DB credentials) can point this at wherever it
# mounts the file instead, e.g. Render's Secret Files path.
CONFIG_PATH = os.environ.get('CONFIG_PATH') or os.path.join(os.path.dirname(__file__), 'config.json')

_CONFIG_CACHE = None
_CONFIG_MTIME = 0


def load_config():
    global _CONFIG_CACHE, _CONFIG_MTIME
    try:
        mtime = os.path.getmtime(CONFIG_PATH)
    except OSError:
        mtime = 0
    if _CONFIG_CACHE is None or mtime != _CONFIG_MTIME:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            _CONFIG_CACHE = json.load(f)
        _CONFIG_MTIME = mtime
    return _CONFIG_CACHE


def invalidate_config_cache():
    global _CONFIG_CACHE
    _CONFIG_CACHE = None


def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


_DECRYPTED_DB_CFG_CACHE = {}


def _resolve_db_config(db_cfg):
    """Transparently decrypt database_config.encrypted if present.

    Cached by blob value so the (deliberately slow) PBKDF2 derivation only
    runs once per process, not on every request — get_db_connection() opens
    a fresh connection per API call (no pooling), so re-deriving the key
    every time would add real latency.
    """
    if 'encrypted' not in db_cfg:
        return db_cfg
    blob = db_cfg['encrypted']
    if _DECRYPTED_DB_CFG_CACHE.get('blob') == blob:
        return _DECRYPTED_DB_CFG_CACHE['data']
    decrypted = decrypt_dict(blob)
    decrypted['mode'] = db_cfg.get('mode', decrypted.get('mode', 'sqlite'))
    _DECRYPTED_DB_CFG_CACHE['blob'] = blob
    _DECRYPTED_DB_CFG_CACHE['data'] = decrypted
    return decrypted


def get_db_connection():
    config = load_config()
    db_cfg = _resolve_db_config(config.get('database_config', {}))
    mode = db_cfg.get('mode', 'sqlite').lower()

    if mode == 'mysql' and PYMYSQL_AVAILABLE:
        connect_kwargs = dict(
            host=db_cfg.get('host', 'localhost'),
            port=int(db_cfg.get('port', 3306)),
            user=db_cfg.get('user', 'root'),
            password=db_cfg.get('password', ''),
            database=db_cfg.get('database', 'jahan_trading_db'),
            autocommit=True,
            cursorclass=pymysql.cursors.DictCursor
        )

        ssl_ca_path = db_cfg.get('ssl_ca_path')
        if ssl_ca_path:
            resolved_ca = ssl_ca_path
            if not os.path.isabs(resolved_ca):
                resolved_ca = os.path.join(os.path.dirname(__file__), resolved_ca)
            if not os.path.exists(resolved_ca):
                raise FileNotFoundError(
                    f"SSL CA certificate not found at '{resolved_ca}'. "
                    f"Download ca.pem from your cloud provider's dashboard and "
                    f"update 'ssl_ca_path' in config.json."
                )
            # Build the SSL context explicitly rather than relying on PyMySQL's
            # dict shortcut — providers like Aiven use a private (self-signed)
            # root CA, and hostname verification against that CA is unreliable
            # via the shortcut. This mirrors Aiven's documented connection method.
            ssl_ctx = ssl.create_default_context(cafile=resolved_ca)
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_REQUIRED
            connect_kwargs['ssl'] = ssl_ctx
        elif db_cfg.get('ssl_required', True):
            # Aiven and most managed MySQL providers require SSL by default.
            # Without a CA file we still request an encrypted channel
            # (no certificate verification — fine for quick setup, but
            # supplying ssl_ca_path above is the more secure option).
            connect_kwargs['ssl'] = {}

        conn = pymysql.connect(**connect_kwargs)
        return conn, 'mysql'

    db_file = config['system'].get('db_file', 'jahan_trading.db')
    db_path = os.path.join(os.path.dirname(__file__), db_file)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn, 'sqlite'


def _ph(mode, n=1):
    """Return a placeholder string for a single param."""
    return "?" if mode == 'sqlite' else "%s"


def _rowget(row, key, default=None):
    """Row can be dict (mysql) or sqlite3.Row."""
    if row is None:
        return default
    try:
        val = row[key]
        return default if val is None else val
    except (KeyError, IndexError):
        return default


def init_db():
    config = load_config()
    conn, mode = get_db_connection()
    cursor = conn.cursor()

    tables = config.get('tables', {})
    for table_name, schema in tables.items():
        cols_def = []
        for col in schema.get('columns', []):
            cname = col['name']
            ctype = col['type']
            if mode == 'mysql':
                ctype = ctype.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'INT AUTO_INCREMENT PRIMARY KEY')
                ctype = ctype.replace('TEXT', 'VARCHAR(255)')
                ctype = ctype.replace('REAL', 'DOUBLE')
            cols_def.append(f"{cname} {ctype}")

        sql = f"CREATE TABLE IF NOT EXISTS {table_name} (\n  " + ",\n  ".join(cols_def) + "\n);"
        cursor.execute(sql)

    if mode == 'sqlite':
        conn.commit()

    _migrate_missing_columns(cursor, mode, tables)
    if mode == 'sqlite':
        conn.commit()

    _ensure_auth_tokens_table(cursor, mode)
    if mode == 'sqlite':
        conn.commit()

    _ensure_letterhead_table(cursor, mode)
    if mode == 'sqlite':
        conn.commit()

    seed_admin_and_demo(conn, mode)
    conn.close()
    print(f"Database initialized in {mode.upper()} mode successfully!")


def _ensure_auth_tokens_table(cursor, mode):
    """Server-side session tokens issued at login. Not part of config['tables']
    since it's an internal auth concern, not a reportable business table."""
    if mode == 'sqlite':
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                client_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
    else:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token VARCHAR(64) PRIMARY KEY,
                user_id INT NOT NULL,
                username VARCHAR(255) NOT NULL,
                role VARCHAR(255) NOT NULL,
                client_id VARCHAR(255) NOT NULL,
                created_at VARCHAR(64) NOT NULL,
                expires_at VARCHAR(64) NOT NULL
            )
        """)


def _ensure_letterhead_table(cursor, mode):
    """Letterhead/business-pad settings (including the optional uploaded
    pad image) live in the DB, not config.json. On a cloud host config.json
    is a read-only Secret File, so writes to it (business pad edits) would
    silently fail there — the DB is the only thing actually writable and
    persistent across restarts/redeploys."""
    if mode == 'sqlite':
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS letterhead_settings (
                id INTEGER PRIMARY KEY,
                company_name TEXT,
                sub_heading TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                footer_note TEXT,
                header_height_px INTEGER,
                footer_height_px INTEGER,
                show_border INTEGER,
                use_pad_image INTEGER,
                pad_image TEXT,
                bank_details TEXT
            )
        """)
    else:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS letterhead_settings (
                id INT PRIMARY KEY,
                company_name TEXT,
                sub_heading TEXT,
                address TEXT,
                phone TEXT,
                email TEXT,
                footer_note TEXT,
                header_height_px INT,
                footer_height_px INT,
                show_border TINYINT,
                use_pad_image TINYINT,
                pad_image MEDIUMTEXT,
                bank_details TEXT
            )
        """)

    # Older installs created this table before footer_height_px existed.
    if mode == 'sqlite':
        cursor.execute("PRAGMA table_info(letterhead_settings)")
        existing_cols = {row[1] for row in cursor.fetchall()}
    else:
        cursor.execute(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'letterhead_settings'"
        )
        existing_cols = {row['COLUMN_NAME'] for row in cursor.fetchall()}
    if 'footer_height_px' not in existing_cols:
        col_type = 'INTEGER' if mode == 'sqlite' else 'INT'
        cursor.execute(f"ALTER TABLE letterhead_settings ADD COLUMN footer_height_px {col_type}")
    if 'bank_details' not in existing_cols:
        col_type = 'TEXT' if mode == 'sqlite' else 'MEDIUMTEXT'
        cursor.execute(f"ALTER TABLE letterhead_settings ADD COLUMN bank_details {col_type}")

    # Payment terms/bank info printed on quotation offer letters — seeded
    # with the business's real accounts (from the client's own reference
    # offer letter) so a fresh install doesn't ship blank bank details.
    DEFAULT_BANK_DETAILS = (
        "Payment will be made in favor of M/S JAHAN TRADING.\n"
        "BRAC BANK, AGRABAD, CHITTAGONG — A/C: 2077772850001, Routing: 215152349\n"
        "EASTERN BANK, MIRPUR BRANCH — A/C: 1071070005188, Routing: 095262987\n"
        "TRUST BANK PLC, HALISHAHAR, CHITTAGONG — A/C: 00240210009446, Routing: 240153162"
    )

    ph = _ph(mode)
    cursor.execute("SELECT COUNT(*) as cnt FROM letterhead_settings WHERE id = 1")
    row = cursor.fetchone()
    exists = (row[0] if mode == 'sqlite' else row['cnt']) > 0
    if not exists:
        # One-time migration: seed from config.json's old letterhead block
        # (if any) so upgrading doesn't blank out an already-configured pad.
        old_lh = load_config().get('letterhead', {}) or {}
        cursor.execute(
            f"INSERT INTO letterhead_settings (id, company_name, sub_heading, address, phone, "
            f"email, footer_note, header_height_px, footer_height_px, show_border, use_pad_image, pad_image, bank_details) "
            f"VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph})",
            (
                1,
                old_lh.get('company_name', ''),
                old_lh.get('sub_heading', ''),
                old_lh.get('address', ''),
                old_lh.get('phone', ''),
                old_lh.get('email', ''),
                old_lh.get('footer_note', ''),
                int(old_lh.get('header_height_px') or 140),
                int(old_lh.get('footer_height_px') or 110),
                1 if old_lh.get('show_border', True) else 0,
                0,
                '',
                DEFAULT_BANK_DETAILS
            )
        )
    elif 'bank_details' not in existing_cols:
        # Existing install upgrading — same seed, but as an UPDATE since the
        # row already exists (only fills it if it was empty/null).
        cursor.execute(
            f"UPDATE letterhead_settings SET bank_details = {ph} WHERE id = 1 AND (bank_details IS NULL OR bank_details = '')",
            (DEFAULT_BANK_DETAILS,)
        )


# Base64 pad images are capped here rather than in the frontend alone —
# the frontend check is just a fast UX warning, this is the real guard
# against an oversized upload bloating the letterhead_settings row.
MAX_PAD_IMAGE_B64_CHARS = 8 * 1024 * 1024


def get_letterhead_settings():
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM letterhead_settings WHERE id = 1")
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {}
    data = dict(row) if mode == 'sqlite' else dict(row)
    data['show_border'] = bool(data.get('show_border', 1))
    data['use_pad_image'] = bool(data.get('use_pad_image', 0))
    return data


def save_letterhead_settings(payload):
    pad_image = payload.get('pad_image') or ''
    if len(pad_image) > MAX_PAD_IMAGE_B64_CHARS:
        raise ValueError("Pad image is too large — please use a smaller/compressed JPG or PNG.")

    existing = get_letterhead_settings()
    merged = {
        'company_name': payload.get('company_name', existing.get('company_name', '')),
        'sub_heading': payload.get('sub_heading', existing.get('sub_heading', '')),
        'address': payload.get('address', existing.get('address', '')),
        'phone': payload.get('phone', existing.get('phone', '')),
        'email': payload.get('email', existing.get('email', '')),
        'footer_note': payload.get('footer_note', existing.get('footer_note', '')),
        'header_height_px': int(payload.get('header_height_px') or existing.get('header_height_px') or 140),
        'footer_height_px': int(payload.get('footer_height_px') or existing.get('footer_height_px') or 110),
        'show_border': payload.get('show_border', existing.get('show_border', True)),
        'use_pad_image': payload.get('use_pad_image', existing.get('use_pad_image', False)),
        'pad_image': pad_image if 'pad_image' in payload else existing.get('pad_image', ''),
        'bank_details': payload.get('bank_details', existing.get('bank_details', '')),
    }

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    values = (
        merged['company_name'], merged['sub_heading'], merged['address'],
        merged['phone'], merged['email'], merged['footer_note'],
        merged['header_height_px'], merged['footer_height_px'],
        1 if merged['show_border'] else 0,
        1 if merged['use_pad_image'] else 0,
        merged['pad_image'], merged['bank_details'],
    )
    cursor.execute(
        f"UPDATE letterhead_settings SET company_name={ph}, sub_heading={ph}, address={ph}, "
        f"phone={ph}, email={ph}, footer_note={ph}, header_height_px={ph}, footer_height_px={ph}, "
        f"show_border={ph}, use_pad_image={ph}, pad_image={ph}, bank_details={ph} WHERE id = 1",
        values
    )
    if mode == 'sqlite':
        conn.commit()
    conn.close()
    return get_letterhead_settings()


def _migrate_missing_columns(cursor, mode, tables):
    """Add any columns present in config['tables'] but missing from an
    already-existing table (CREATE TABLE IF NOT EXISTS is a no-op for tables
    that predate a config change, e.g. the live Aiven MySQL instance)."""
    for table_name, schema in tables.items():
        if mode == 'sqlite':
            cursor.execute(f"PRAGMA table_info({table_name})")
            existing_cols = {row[1] for row in cursor.fetchall()}
        else:
            cursor.execute(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
                (table_name,)
            )
            existing_cols = {row['COLUMN_NAME'] for row in cursor.fetchall()}

        for col in schema.get('columns', []):
            cname = col['name']
            if cname in existing_cols:
                continue
            ctype = col['type']
            if 'PRIMARY KEY' in ctype.upper():
                continue
            if mode == 'mysql':
                ctype = ctype.replace('TEXT', 'VARCHAR(255)').replace('REAL', 'DOUBLE')
            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {cname} {ctype}")

            # Rows that predate the authorization workflow already happened
            # and already applied their inventory effect — mark them
            # authorized rather than defaulting to 'pending' (which would
            # otherwise vanish them from reports/dashboard).
            if cname == 'status' and table_name in ('purchases', 'sales'):
                cursor.execute(f"UPDATE {table_name} SET status = 'authorized'")


def seed_admin_and_demo(conn, mode):
    cursor = conn.cursor()
    ph = _ph(mode)

    admin_pass = hash_password("admin123")
    cursor.execute(f"SELECT COUNT(*) as cnt FROM users WHERE username = {ph}", ("admin",))
    row = cursor.fetchone()
    has_admin = (row[0] if mode == 'sqlite' else row['cnt']) > 0

    if not has_admin:
        cursor.execute(
            f"INSERT INTO users (username, password_hash, full_name, role, client_id, is_active) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, 1)",
            ("admin", admin_pass, "System Administrator", "admin", "CLI-001")
        )

    client_id = "CLI-001"

    # Seed demo products
    cursor.execute(f"SELECT COUNT(*) as cnt FROM products WHERE client_id = {ph}", (client_id,))
    row = cursor.fetchone()
    prod_count = row[0] if mode == 'sqlite' else row['cnt']
    if prod_count == 0:
        demo_products = [
            ("Steel Rod", "12mm", 1450.0),
            ("Steel Rod", "16mm", 1600.0),
            ("Hydraulic Valve", "3/4 inch", 5800.0),
            ("Brass Fitting", "Standard", 1100.0),
            ("Bearing Set", "Industrial", 480.0),
        ]
        for pt, sz, price in demo_products:
            cursor.execute(
                f"INSERT INTO products (client_id, product_type, size, unit_price) VALUES ({ph}, {ph}, {ph}, {ph})",
                (client_id, pt, sz, price)
            )

    if mode == 'sqlite':
        conn.commit()


# ---------------- AUTH ----------------
def authenticate_user(username, password):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    pass_hash = hash_password(password)
    cursor.execute(
        f"SELECT id, username, full_name, role, client_id FROM users "
        f"WHERE username = {ph} AND password_hash = {ph} AND is_active = 1",
        (username, pass_hash)
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return dict(row) if mode == 'sqlite' else row


def create_session_token(user):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    expires = now + timedelta(days=SESSION_TOKEN_TTL_DAYS)
    cursor.execute(
        f"INSERT INTO auth_tokens (token, user_id, username, role, client_id, created_at, expires_at) "
        f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})",
        (token, user['id'], user['username'], user['role'], user['client_id'],
         now.isoformat(), expires.isoformat())
    )
    if mode == 'sqlite':
        conn.commit()
    conn.close()
    return token


def verify_session_token(token):
    if not token:
        return None
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT user_id, username, role, client_id, expires_at FROM auth_tokens WHERE token = {ph}",
        (token,)
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    row = dict(row) if mode == 'sqlite' else row
    try:
        if datetime.utcnow() > datetime.fromisoformat(row['expires_at']):
            return None
    except (TypeError, ValueError):
        return None
    return {
        'id': row['user_id'],
        'username': row['username'],
        'role': row['role'],
        'client_id': row['client_id'],
    }


def revoke_session_token(token):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(f"DELETE FROM auth_tokens WHERE token = {ph}", (token,))
    if mode == 'sqlite':
        conn.commit()
    conn.close()


def _lookup_user_role(cursor, mode, username):
    if not username:
        return None
    ph = _ph(mode)
    cursor.execute(f"SELECT role FROM users WHERE username = {ph}", (username,))
    row = cursor.fetchone()
    if not row:
        return None
    return row[0] if mode == 'sqlite' else row['role']


def get_user_role(username):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    role = _lookup_user_role(cursor, mode, username)
    conn.close()
    return role


def create_user(username, password, full_name, role, client_id):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    pass_hash = hash_password(password)
    try:
        cursor.execute(
            f"INSERT INTO users (username, password_hash, full_name, role, client_id) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (username, pass_hash, full_name, role, client_id)
        )
        if mode == 'sqlite':
            conn.commit()
        conn.close()
        return {"status": "success", "username": username}
    except Exception as e:
        conn.close()
        raise ValueError(f"Failed to create user (username may already exist): {e}")


def get_all_users():
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, full_name, role, client_id, is_active FROM users ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- CHALAN ----------------
def get_next_chalan(client_id):
    config = load_config()
    start = int(config['system'].get('chalan_start', 1))
    pad = int(config['system'].get('chalan_pad', 6))

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(f"SELECT COUNT(*) as cnt FROM sales WHERE client_id = {ph}", (client_id,))
    row = cursor.fetchone()
    count = row[0] if mode == 'sqlite' else row['cnt']
    conn.close()

    next_no = start + int(count or 0)
    return str(next_no).zfill(pad)


# ---------------- LOOKUPS ----------------
def list_products(client_id):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT id, product_type, size, unit_price, origin FROM products WHERE client_id = {ph} "
        f"ORDER BY product_type ASC, size ASC",
        (client_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_customers(client_id, customer_type=None):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    if customer_type:
        cursor.execute(
            f"SELECT id, customer_name, customer_type, contact_number, address FROM customers "
            f"WHERE client_id = {ph} AND customer_type = {ph} ORDER BY customer_name ASC",
            (client_id, customer_type)
        )
    else:
        cursor.execute(
            f"SELECT id, customer_name, customer_type, contact_number, address FROM customers "
            f"WHERE client_id = {ph} ORDER BY customer_name ASC",
            (client_id,)
        )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_report_customer_options(report_id, client_id):
    """Distinct customer/buyer/supplier/transporter names valid for a
    report's customer filter dropdown, pulled straight from the transaction
    tables themselves (not the customers catalog) — Previous-mode/free-text
    names and non-'Sales'-type parties (suppliers, transporters) all need to
    be selectable too, and the filter itself does an exact match against
    these same values."""
    config = load_config()
    report_def = next((rp for rp in config.get('report_points', []) if rp['id'] == report_id), None)
    if not report_def or not report_def.get('supports_customer_filter'):
        return []
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    names = set()

    def _collect(sql, col):
        cursor.execute(sql, (client_id,))
        for r in cursor.fetchall():
            v = r[0] if mode == 'sqlite' else r[col]
            if v:
                names.add(v)

    if report_id == 'sales_report':
        _collect(f"SELECT DISTINCT buyer_name FROM sales WHERE client_id = {ph} AND status = 'authorized'", 'buyer_name')
    else:
        _collect(f"SELECT DISTINCT buyer_name FROM sales WHERE client_id = {ph} AND status = 'authorized'", 'buyer_name')
        _collect(f"SELECT DISTINCT supplier_name FROM purchases WHERE client_id = {ph} AND status = 'authorized'", 'supplier_name')
        _collect(f"SELECT DISTINCT transporter_name FROM transporters WHERE client_id = {ph}", 'transporter_name')
    conn.close()
    return sorted(names)


def list_report_po_options(report_id, client_id, customer=None, date_from=None, date_to=None):
    """Distinct PO Order numbers for the Total Sales Report's cascading PO
    filter — scoped to the currently selected customer and date range (if
    any) so the dropdown only ever offers POs that actually exist for that
    slice, matching the exact-match {po_filter} the backend applies."""
    config = load_config()
    report_def = next((rp for rp in config.get('report_points', []) if rp['id'] == report_id), None)
    if not report_def or not report_def.get('supports_po_filter'):
        return []
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    sql = f"SELECT DISTINCT po_order FROM sales WHERE client_id = {ph} AND status = 'authorized'"
    params = [client_id]
    if customer:
        sql += f" AND buyer_name = {ph}"
        params.append(customer)
    if date_from:
        sql += f" AND sale_date >= {ph}"
        params.append(date_from)
    if date_to:
        sql += f" AND sale_date <= {ph}"
        params.append(date_to)
    cursor.execute(sql, params)
    names = sorted({(r[0] if mode == 'sqlite' else r['po_order']) for r in cursor.fetchall() if (r[0] if mode == 'sqlite' else r['po_order'])})
    conn.close()
    return names


def list_invoice_refs(ref_type, client_id):
    """List existing sale chalans or purchase invoice numbers — with customer
    name, grand total, transporter/truck, and total quantity/locations —
    for the Transporter Entry form's reference-number dropdown. Grouped by
    reference number since a multi-item sale/purchase spreads one chalan/
    invoice across several rows; SUM() gives the true total quantity/amount
    the transporter needs to move rather than just one line item's share."""
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    if ref_type == 'sales':
        cursor.execute(
            f"SELECT chalan_no as reference_no, buyer_name as customer_name, "
            f"SUM(sale_total_price) as total_amount, SUM(received_quantity) as quantity, "
            f"MAX(transporter_name) as transporter_name, MAX(truck_no) as truck_no, "
            f"MAX(loading_location) as from_location, MAX(unloading_location) as to_location "
            f"FROM sales WHERE client_id = {ph} "
            f"GROUP BY chalan_no, buyer_name ORDER BY MAX(id) DESC",
            (client_id,)
        )
    elif ref_type == 'purchases':
        cursor.execute(
            f"SELECT input_invoice_no as reference_no, supplier_name as customer_name, "
            f"SUM(total) as total_amount, SUM(quantity) as quantity, "
            f"MAX(transporter_name) as transporter_name, MAX(truck_no) as truck_no, "
            f"MAX(loading_location) as from_location, MAX(unloading_location) as to_location "
            f"FROM purchases WHERE client_id = {ph} "
            f"GROUP BY input_invoice_no, supplier_name ORDER BY MAX(id) DESC",
            (client_id,)
        )
    else:
        conn.close()
        raise ValueError("ref_type must be 'sales' or 'purchases'")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_inventory(client_id):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT id, product_type, size, quantity, cost_price FROM inventory "
        f"WHERE client_id = {ph} ORDER BY product_type ASC, size ASC",
        (client_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- INVENTORY UPDATES ----------------
def _inventory_add_purchase(cursor, mode, client_id, product_type, size, qty, unit_cost):
    """Merge purchase into inventory: recompute weighted avg cost, sum qty."""
    ph = _ph(mode)
    size = size or ""
    cursor.execute(
        f"SELECT id, quantity, cost_price FROM inventory "
        f"WHERE client_id = {ph} AND product_type = {ph} AND size = {ph}",
        (client_id, product_type, size)
    )
    existing = cursor.fetchone()
    if existing:
        eid = existing[0] if mode == 'sqlite' else existing['id']
        eqty = float(existing[1] if mode == 'sqlite' else existing['quantity']) or 0.0
        ecost = float(existing[2] if mode == 'sqlite' else existing['cost_price']) or 0.0
        new_qty = eqty + qty
        if new_qty > 0:
            new_cost = ((eqty * ecost) + (qty * unit_cost)) / new_qty
        else:
            new_cost = unit_cost
        cursor.execute(
            f"UPDATE inventory SET quantity = {ph}, cost_price = {ph} WHERE id = {ph}",
            (new_qty, new_cost, eid)
        )
    else:
        cursor.execute(
            f"INSERT INTO inventory (client_id, product_type, size, quantity, cost_price) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (client_id, product_type, size, qty, unit_cost)
        )


def _inventory_reduce_sale(cursor, mode, client_id, product_type, size, qty):
    ph = _ph(mode)
    size = size or ""
    cursor.execute(
        f"UPDATE inventory SET quantity = quantity - {ph} "
        f"WHERE client_id = {ph} AND product_type = {ph} AND size = {ph}",
        (qty, client_id, product_type, size)
    )


def _inventory_adjust_quantity(cursor, mode, client_id, product_type, size, delta):
    """Add (positive) or subtract (negative) delta from an inventory row's
    quantity, without touching cost_price. Used to reverse a deleted
    authorized purchase/sale."""
    ph = _ph(mode)
    size = size or ""
    cursor.execute(
        f"UPDATE inventory SET quantity = quantity + {ph} "
        f"WHERE client_id = {ph} AND product_type = {ph} AND size = {ph}",
        (delta, client_id, product_type, size)
    )


def _get_inventory_cost(cursor, mode, client_id, product_type, size):
    ph = _ph(mode)
    size = size or ""
    cursor.execute(
        f"SELECT cost_price FROM inventory "
        f"WHERE client_id = {ph} AND product_type = {ph} AND size = {ph}",
        (client_id, product_type, size)
    )
    row = cursor.fetchone()
    if not row:
        return 0.0
    return float(row[0] if mode == 'sqlite' else row['cost_price']) or 0.0


def _upsert_product(cursor, mode, client_id, product_type, size, unit_price):
    ph = _ph(mode)
    cursor.execute(
        f"SELECT id FROM products WHERE client_id = {ph} AND product_type = {ph} AND size = {ph}",
        (client_id, product_type, size)
    )
    row = cursor.fetchone()
    if row:
        pid = row[0] if mode == 'sqlite' else row['id']
        cursor.execute(f"UPDATE products SET unit_price = {ph} WHERE id = {ph}", (unit_price, pid))
    else:
        cursor.execute(
            f"INSERT INTO products (client_id, product_type, size, unit_price) VALUES ({ph}, {ph}, {ph}, {ph})",
            (client_id, product_type, size, unit_price)
        )


def _validate_linked_customers(cursor, mode, client_id, entry_def, data):
    """Every required customer_select field (Buyer Name, Supplier Name) must
    resolve to a customer already registered in Customer Registration — the
    client wants Sales/Purchase entries rejected rather than saved against a
    free-text name, including one typed into the Previous/Modify combobox
    that never got matched to a real record.
    """
    ph = _ph(mode)
    for f in entry_def['fields']:
        if f.get('type') != 'customer_select' or not f.get('required'):
            continue
        value = str(data.get(f['name']) or '').strip()
        if not value:
            raise ValueError(f"{f['label']} is required and must be an existing registered customer.")
        cursor.execute(
            f"SELECT COUNT(*) as cnt FROM customers WHERE client_id = {ph} AND customer_name = {ph} AND customer_type = {ph}",
            (client_id, value, f.get('customer_type_filter'))
        )
        row = cursor.fetchone()
        cnt = row[0] if mode == 'sqlite' else row['cnt']
        if not cnt:
            ctype = f.get('customer_type_filter', '')
            raise ValueError(
                f"{f['label']} '{value}' is not a registered {ctype} customer. "
                f"Please add it in Customer Registration first."
            )


# Per-line-item field names for each multi-item table — mirrors
# MULTI_ITEM_FIELDS in app.js. Needed here so shared-field validation below
# can skip them (they're validated per row by the caller, not as a single
# shared value).
MULTI_LINE_ITEM_FIELDS = {
    'sales': {'product_type', 'size', 'cost_price', 'received_quantity', 'sale_unit_price', 'unloading_cost_per_unit'},
    'purchases': {'product_type', 'size', 'unit_price', 'quantity'},
    'quotations': {'product_type', 'size', 'origin', 'unit_price', 'quantity'},
}


def _validate_line_items(table_name, line_items):
    """Every product line item must actually identify a product and carry a
    real quantity/price. The multi-item insert loop silently defaults a
    missing product_type to '' and a missing/blank quantity or price to 0
    (so the row inserts fine but is functionally empty) — this closes that
    loophole by rejecting the whole submission up front, mirroring
    _validate_required_shared_fields but for per-row fields, which that
    function deliberately skips (see MULTI_LINE_ITEM_FIELDS). Size is
    intentionally NOT enforced here, matching config.json's own
    `required: false` on the size field for sales/purchases/quotations —
    it's often auto-derived from the product selection and can legitimately
    be blank for a product not yet fully catalogued.
    """
    qty_field = 'received_quantity' if table_name == 'sales' else 'quantity'
    price_field = 'sale_unit_price' if table_name == 'sales' else 'unit_price'
    for idx, li in enumerate(line_items, start=1):
        if not str(li.get('product_type') or '').strip():
            raise ValueError(f"Product #{idx}: Product Type is required.")
        try:
            qty = float(li.get(qty_field) or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            raise ValueError(f"Product #{idx}: Quantity must be greater than 0.")
        try:
            price = float(li.get(price_field) or 0)
        except (TypeError, ValueError):
            price = 0
        if price <= 0:
            raise ValueError(f"Product #{idx}: Unit Price must be greater than 0.")


def _validate_required_shared_fields(table_name, entry_def, shared_data):
    """The client wants every field on a Sales/Purchase entry actually
    filled in — not just the linked customer — so this rejects a submit
    that's missing any required shared (non-line-item) field, the same way
    the browser's own `required` attribute does, as a server-side backstop
    against a direct API call skipping the frontend entirely. Respects
    show_if: a field only hidden/shown conditionally (Bank Name/LC No for
    Foreign purchases) is only required while its condition is actually met.
    """
    line_item_fields = MULTI_LINE_ITEM_FIELDS.get(table_name, set())
    for f in entry_def['fields']:
        if f['name'] in line_item_fields:
            continue
        if f['name'] == 'record_source' or f.get('type') == 'customer_select':
            continue
        if not f.get('required'):
            continue
        show_if = f.get('show_if')
        if show_if:
            watched_val = str(shared_data.get(show_if['field'], '') or '').strip()
            if watched_val != show_if['value']:
                continue
        value = shared_data.get(f['name'])
        if value is None or str(value).strip() == '':
            raise ValueError(f"{f['label']} is required.")


# ---------------- SAVE ENTRY ----------------
def save_entry(entry_id, data, client_id=None, created_by=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    entry_def = next((ep for ep in config.get('entry_points', []) if ep['id'] == entry_id), None)
    if not entry_def:
        raise ValueError(f"Unknown entry point ID: {entry_id}")

    table_name = entry_def['table']
    fields = entry_def['fields']

    conn, mode = get_db_connection()
    cursor = conn.cursor()

    try:
        insert_data = {'client_id': client_id}
        for f in fields:
            fname = f['name']
            val = data.get(fname)
            if val is None or val == "":
                val = f.get('default', None)
            insert_data[fname] = val

        # Table-specific augmentation
        if table_name == 'sales':
            # Auto-generate chalan if missing
            if not insert_data.get('chalan_no'):
                insert_data['chalan_no'] = get_next_chalan(client_id)

            qty = float(insert_data.get('received_quantity') or 0)
            price = float(insert_data.get('sale_unit_price') or 0)
            insert_data['sale_total_price'] = round(qty * price, 2)

            unload_rate = float(insert_data.get('unloading_cost_per_unit') or 0)
            insert_data['unloading_cost'] = round(qty * unload_rate, 2)

            # Pull cost price from inventory if not provided
            provided_cost = insert_data.get('cost_price')
            if provided_cost in (None, "", 0, "0"):
                cost = _get_inventory_cost(cursor, mode, client_id,
                                           insert_data.get('product_type'),
                                           insert_data.get('size'))
                insert_data['cost_price'] = cost
            else:
                insert_data['cost_price'] = float(provided_cost)

            # Due is always authoritative server-side: total minus advance.
            advance = float(insert_data.get('advance') or 0)
            insert_data['due'] = round(max(0.0, insert_data['sale_total_price'] - advance), 2)

        elif table_name == 'purchases':
            qty = float(insert_data.get('quantity') or 0)
            price = float(insert_data.get('unit_price') or 0)
            insert_data['total'] = round(qty * price, 2)

            advance = float(insert_data.get('advance') or 0)
            insert_data['due'] = round(max(0.0, insert_data['total'] - advance), 2)

        elif table_name == 'transporters':
            # Rent is always authoritative server-side (rate * qty), same
            # pattern as sales/purchase totals below — never trust a client-
            # submitted rent value.
            qty = float(insert_data.get('quantity') or 0)
            rate = float(insert_data.get('unit_rate_per_ton') or 0)
            insert_data['rent'] = round(qty * rate, 2)
            advance = float(insert_data.get('advance') or 0)
            insert_data['due'] = round(max(0.0, insert_data['rent'] - advance), 2)

        # Sales/purchase transactions require admin authorization unless the
        # submitter is already an admin (auto-authorized).
        if table_name in ('sales', 'purchases'):
            role = _lookup_user_role(cursor, mode, created_by)
            is_admin = (role == 'admin')
            now = datetime.now().isoformat(timespec='seconds')
            insert_data['created_by'] = created_by
            insert_data['status'] = 'authorized' if is_admin else 'pending'
            insert_data['authorized_by'] = created_by if is_admin else None
            insert_data['authorized_at'] = now if is_admin else None

        # Coerce numeric-like fields
        for f in fields:
            if f.get('type') == 'number':
                v = insert_data.get(f['name'])
                if v is None or v == "":
                    insert_data[f['name']] = 0
                else:
                    try:
                        insert_data[f['name']] = float(v)
                    except (TypeError, ValueError):
                        insert_data[f['name']] = 0

        if table_name in ('sales', 'purchases'):
            _validate_linked_customers(cursor, mode, client_id, entry_def, insert_data)
            _validate_required_shared_fields(table_name, entry_def, insert_data)
            # save_entry() only ever handles a single product row; treat it as
            # a one-item line list so product/size/quantity/price get the same
            # non-blank, non-zero enforcement as the multi-item path below.
            _validate_line_items(table_name, [insert_data])

        # Filter to only real table columns
        table_cols = {c['name'] for c in config['tables'][table_name]['columns']}
        insert_data = {k: v for k, v in insert_data.items() if k in table_cols}

        ph = _ph(mode)
        cols = list(insert_data.keys())
        vals = list(insert_data.values())
        placeholders = ", ".join([ph] * len(cols))
        sql = f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES ({placeholders})"
        cursor.execute(sql, vals)

        new_id = cursor.lastrowid if mode == 'sqlite' else cursor.lastrowid

        # Inventory / product side-effects — only for already-authorized
        # transactions; pending sales/purchases wait until an admin authorizes them.
        if table_name == 'purchases' and insert_data.get('status') == 'authorized':
            _inventory_add_purchase(
                cursor, mode, client_id,
                insert_data.get('product_type'),
                insert_data.get('size'),
                float(insert_data.get('quantity') or 0),
                float(insert_data.get('unit_price') or 0),
            )
            # Update products catalog price
            if insert_data.get('product_type'):
                _upsert_product(
                    cursor, mode, client_id,
                    insert_data['product_type'],
                    insert_data.get('size') or "",
                    float(insert_data.get('unit_price') or 0),
                )

        elif table_name == 'sales' and insert_data.get('status') == 'authorized':
            _inventory_reduce_sale(
                cursor, mode, client_id,
                insert_data.get('product_type'),
                insert_data.get('size'),
                float(insert_data.get('received_quantity') or 0),
            )

        if mode == 'sqlite':
            conn.commit()

        result = {"status": "success", "table": table_name, "id": new_id}
        if table_name == 'sales':
            result["chalan_no"] = insert_data.get('chalan_no')
            result["entry_status"] = insert_data.get('status')
        elif table_name == 'purchases':
            result["input_invoice_no"] = insert_data.get('input_invoice_no')
            result["entry_status"] = insert_data.get('status')
        return result
    finally:
        conn.close()


def save_multi_item_entry(entry_id, shared_data, line_items, client_id=None, created_by=None):
    """Like save_entry(), but inserts one row per product line item, all
    sharing a single chalan_no/input_invoice_no/quotation_no. Supports sales,
    purchases and quotations — the only tables with a per-transaction
    reference number that multiple product rows can share.

    Advance/due are invoice-level concepts but the schema stores them per
    row, so the full advance and the resulting due are attributed entirely
    to the first row and left at 0 on the rest. That keeps SUM(due) and
    SUM(advance) across the invoice's rows numerically correct without
    prorating — prorating would let a single overpaid/underpaid line item
    silently misstate that item's own due while the others looked fine.
    Quotations have no advance/due columns at all, so this is a no-op for them.
    """
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    entry_def = next((ep for ep in config.get('entry_points', []) if ep['id'] == entry_id), None)
    if not entry_def:
        raise ValueError(f"Unknown entry point ID: {entry_id}")

    table_name = entry_def['table']
    if table_name not in ('sales', 'purchases', 'quotations'):
        raise ValueError("Multi-item entry is only supported for sales, purchases and quotations")
    if not line_items:
        raise ValueError("At least one product line item is required")

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, created_by)
        is_admin = (role == 'admin')
        now = datetime.now().isoformat(timespec='seconds')

        if table_name in ('sales', 'purchases'):
            _validate_linked_customers(cursor, mode, client_id, entry_def, shared_data)
            _validate_required_shared_fields(table_name, entry_def, shared_data)
        _validate_line_items(table_name, line_items)

        # "Previous" entries are historical/backfill records the client is
        # keying in from paper records — they must never touch inventory
        # (the stock was already accounted for when it originally happened)
        # and are auto-authorized immediately since there's no live workflow
        # left to gate: nothing to double-check, no inventory to protect.
        is_previous = table_name in ('sales', 'purchases') and \
            str(shared_data.get('record_source', '')).strip().lower() == 'previous'

        if table_name == 'sales':
            ref_no = shared_data.get('chalan_no') or get_next_chalan(client_id)
        elif table_name == 'purchases':
            ref_no = shared_data.get('input_invoice_no')
            if not ref_no:
                raise ValueError("Input Invoice No is required")
        else:
            ref_no = shared_data.get('quotation_no') or get_next_quotation_no(client_id)

        advance_total = float(shared_data.get('advance') or 0)

        # Pass 1: compute each line's own total (and cost_price for sales)
        # before touching the DB, so the grand total is known up front.
        prepared = []
        grand_total = 0.0
        for li in line_items:
            if table_name == 'sales':
                qty = float(li.get('received_quantity') or 0)
                price = float(li.get('sale_unit_price') or 0)
                line_total = round(qty * price, 2)
                provided_cost = li.get('cost_price')
                if provided_cost in (None, "", 0, "0"):
                    cost = 0.0 if is_previous else _get_inventory_cost(
                        cursor, mode, client_id, li.get('product_type'), li.get('size'))
                else:
                    cost = float(provided_cost)
                unload_rate = float(li.get('unloading_cost_per_unit') or 0)
                unloading_cost = round(qty * unload_rate, 2)
                prepared.append({**li, 'received_quantity': qty, 'sale_unit_price': price,
                                  'sale_total_price': line_total, 'cost_price': cost,
                                  'unloading_cost_per_unit': unload_rate, 'unloading_cost': unloading_cost})
            else:
                qty = float(li.get('quantity') or 0)
                price = float(li.get('unit_price') or 0)
                line_total = round(qty * price, 2)
                prepared.append({**li, 'quantity': qty, 'unit_price': price, 'total': line_total})
            grand_total += line_total
        grand_total = round(grand_total, 2)

        overall_due = round(max(0.0, grand_total - advance_total), 2)
        overall_advance_applied = round(grand_total - overall_due, 2)

        table_cols = {c['name'] for c in config['tables'][table_name]['columns']}
        new_ids = []

        for idx, li in enumerate(prepared):
            insert_data = {'client_id': client_id}
            insert_data.update(shared_data)
            insert_data.update(li)

            if table_name == 'sales':
                insert_data['chalan_no'] = ref_no
            elif table_name == 'purchases':
                insert_data['input_invoice_no'] = ref_no
            else:
                insert_data['quotation_no'] = ref_no

            insert_data['advance'] = overall_advance_applied if idx == 0 else 0
            insert_data['due'] = overall_due if idx == 0 else 0

            insert_data['created_by'] = created_by
            if is_previous:
                insert_data['record_source'] = 'Previous'
                insert_data['status'] = 'authorized'
                insert_data['authorized_by'] = created_by
                insert_data['authorized_at'] = now
            elif table_name in ('sales', 'purchases'):
                insert_data['record_source'] = 'New'
                insert_data['status'] = 'authorized' if is_admin else 'pending'
                insert_data['authorized_by'] = created_by if is_admin else None
                insert_data['authorized_at'] = now if is_admin else None
            else:
                # Quotations always start pending — an admin must explicitly
                # approve them via the Quotation Report, regardless of who created it.
                insert_data['status'] = 'pending'
                insert_data['authorized_by'] = None
                insert_data['authorized_at'] = None

            # Coerce numeric-like fields (mirrors save_entry's own pass),
            # skipping advance/due which are already deliberately set above.
            for f in entry_def['fields']:
                if f.get('type') == 'number' and f['name'] not in ('advance', 'due'):
                    v = insert_data.get(f['name'])
                    if v is None or v == "":
                        insert_data[f['name']] = 0
                    else:
                        try:
                            insert_data[f['name']] = float(v)
                        except (TypeError, ValueError):
                            insert_data[f['name']] = 0

            insert_data = {k: v for k, v in insert_data.items() if k in table_cols}

            cols = list(insert_data.keys())
            vals = list(insert_data.values())
            placeholders = ", ".join([ph] * len(cols))
            cursor.execute(f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES ({placeholders})", vals)
            new_ids.append(cursor.lastrowid)

            if is_previous:
                pass  # historical backfill — never touches inventory or the products catalog
            elif table_name == 'purchases' and insert_data.get('status') == 'authorized':
                _inventory_add_purchase(
                    cursor, mode, client_id,
                    insert_data.get('product_type'), insert_data.get('size'),
                    float(insert_data.get('quantity') or 0), float(insert_data.get('unit_price') or 0),
                )
                if insert_data.get('product_type'):
                    _upsert_product(
                        cursor, mode, client_id, insert_data['product_type'],
                        insert_data.get('size') or "", float(insert_data.get('unit_price') or 0),
                    )
            elif table_name == 'sales' and insert_data.get('status') == 'authorized':
                _inventory_reduce_sale(
                    cursor, mode, client_id,
                    insert_data.get('product_type'), insert_data.get('size'),
                    float(insert_data.get('received_quantity') or 0),
                )

        if mode == 'sqlite':
            conn.commit()

        result = {
            "status": "success", "table": table_name, "ids": new_ids,
            "line_count": len(new_ids),
            "entry_status": insert_data.get('status')
        }
        if table_name == 'sales':
            result["chalan_no"] = ref_no
        elif table_name == 'purchases':
            result["input_invoice_no"] = ref_no
        else:
            result["quotation_no"] = ref_no
        return result
    finally:
        conn.close()


# ---------------- MODIFY EXISTING SALES/PURCHASE ----------------
# The "Modify" record_source option lets an admin correct a previously
# entered Sales/Purchase transaction in place (fixing a typo, quantity, or
# price after the fact) instead of deleting and re-keying it. Distinct from
# "Previous" (historical backfill of a transaction that never touched
# inventory) — Modify edits a real transaction and its inventory effect.
MODIFIABLE_MULTI_TABLES = {
    'sales': {'ref_col': 'chalan_no', 'name_col': 'buyer_name', 'date_col': 'sale_date'},
    'purchases': {'ref_col': 'input_invoice_no', 'name_col': 'supplier_name', 'date_col': 'purchase_date'},
}


def list_modifiable_refs(table_name, client_id=None):
    """Distinct reference numbers (chalan_no/input_invoice_no) available to
    load into the Modify flow, newest first."""
    if table_name not in MODIFIABLE_MULTI_TABLES:
        raise ValueError("table_name must be 'sales' or 'purchases'")
    spec = MODIFIABLE_MULTI_TABLES[table_name]
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT {spec['ref_col']} as reference_no, MAX({spec['name_col']}) as party_name, "
        f"MAX({spec['date_col']}) as record_date, MAX(id) as sort_id "
        f"FROM {table_name} WHERE client_id = {ph} GROUP BY {spec['ref_col']} ORDER BY sort_id DESC",
        (client_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_editable_record(table_name, reference_no, client_id=None):
    """Full row set (header + line items) for an existing sales/purchases
    reference number, used to pre-fill the Modify form."""
    if table_name not in MODIFIABLE_MULTI_TABLES:
        raise ValueError("table_name must be 'sales' or 'purchases'")
    ref_col = MODIFIABLE_MULTI_TABLES[table_name]['ref_col']
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT * FROM {table_name} WHERE {ref_col} = {ph} AND client_id = {ph} ORDER BY id ASC",
        (reference_no, client_id)
    )
    rows = cursor.fetchall()
    items = [dict(r) for r in rows] if mode == 'sqlite' else list(rows)
    conn.close()
    if not items:
        return None
    return {"table": table_name, "reference_no": reference_no, "header": items[0], "items": items}


def update_multi_item_entry(entry_id, original_ref, shared_data, line_items, client_id=None, requested_by=None):
    """Admin-only: replace every row sharing an existing chalan_no/
    input_invoice_no with a freshly-computed set from edited data, so a
    mistake in a previously entered Sales/Purchase transaction can be
    corrected in place rather than by deleting and re-keying it.

    Implemented as reverse-old-inventory -> delete old rows -> insert new
    rows, reusing the same reference number throughout — so anything that
    points at it by that number (transporters.reference_no,
    challan_uploads.chalan_no) keeps working even though the underlying
    row ids change.
    """
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    entry_def = next((ep for ep in config.get('entry_points', []) if ep['id'] == entry_id), None)
    if not entry_def:
        raise ValueError(f"Unknown entry point ID: {entry_id}")

    table_name = entry_def['table']
    if table_name not in MODIFIABLE_MULTI_TABLES:
        raise ValueError("Modify is only supported for sales and purchases")
    if not line_items:
        raise ValueError("At least one product line item is required")
    if not original_ref:
        raise ValueError("No existing record selected to modify")

    ref_col = MODIFIABLE_MULTI_TABLES[table_name]['ref_col']

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can modify existing records")

        # Validate before touching any data — a rejected edit must never
        # leave the old rows deleted/reversed with nothing re-inserted.
        _validate_linked_customers(cursor, mode, client_id, entry_def, shared_data)
        _validate_required_shared_fields(table_name, entry_def, shared_data)
        _validate_line_items(table_name, line_items)

        cursor.execute(
            f"SELECT * FROM {table_name} WHERE {ref_col} = {ph} AND client_id = {ph} ORDER BY id ASC",
            (original_ref, client_id)
        )
        old_rows = cursor.fetchall()
        old_rows = [dict(r) for r in old_rows] if mode == 'sqlite' else list(old_rows)
        if not old_rows:
            raise ValueError(f"No existing record found for '{original_ref}'")

        old_record_source = str(old_rows[0].get('record_source', '') or '').strip().lower()
        is_previous = old_record_source == 'previous'
        old_created_by = old_rows[0].get('created_by')

        # Reverse whatever inventory effect the old rows applied (mirrors
        # delete_entry) before the new rows apply their own — this stays
        # correct even if product/size/quantity changed between old and new.
        if not is_previous:
            for row in old_rows:
                if row.get('status') != 'authorized':
                    continue
                if table_name == 'purchases':
                    _inventory_adjust_quantity(
                        cursor, mode, client_id,
                        row.get('product_type'), row.get('size'),
                        -float(row.get('quantity') or 0),
                    )
                else:
                    _inventory_adjust_quantity(
                        cursor, mode, client_id,
                        row.get('product_type'), row.get('size'),
                        float(row.get('received_quantity') or 0),
                    )

        cursor.execute(
            f"DELETE FROM {table_name} WHERE {ref_col} = {ph} AND client_id = {ph}",
            (original_ref, client_id)
        )

        ref_no = shared_data.get(ref_col) or original_ref
        now = datetime.now().isoformat(timespec='seconds')
        advance_total = float(shared_data.get('advance') or 0)

        prepared = []
        grand_total = 0.0
        for li in line_items:
            if table_name == 'sales':
                qty = float(li.get('received_quantity') or 0)
                price = float(li.get('sale_unit_price') or 0)
                line_total = round(qty * price, 2)
                provided_cost = li.get('cost_price')
                if provided_cost in (None, "", 0, "0"):
                    cost = 0.0 if is_previous else _get_inventory_cost(
                        cursor, mode, client_id, li.get('product_type'), li.get('size'))
                else:
                    cost = float(provided_cost)
                unload_rate = float(li.get('unloading_cost_per_unit') or 0)
                unloading_cost = round(qty * unload_rate, 2)
                prepared.append({**li, 'received_quantity': qty, 'sale_unit_price': price,
                                  'sale_total_price': line_total, 'cost_price': cost,
                                  'unloading_cost_per_unit': unload_rate, 'unloading_cost': unloading_cost})
            else:
                qty = float(li.get('quantity') or 0)
                price = float(li.get('unit_price') or 0)
                line_total = round(qty * price, 2)
                prepared.append({**li, 'quantity': qty, 'unit_price': price, 'total': line_total})
            grand_total += line_total
        grand_total = round(grand_total, 2)

        overall_due = round(max(0.0, grand_total - advance_total), 2)
        overall_advance_applied = round(grand_total - overall_due, 2)

        table_cols = {c['name'] for c in config['tables'][table_name]['columns']}
        new_ids = []

        for idx, li in enumerate(prepared):
            insert_data = {'client_id': client_id}
            insert_data.update(shared_data)
            insert_data.update(li)
            insert_data[ref_col] = ref_no

            insert_data['advance'] = overall_advance_applied if idx == 0 else 0
            insert_data['due'] = overall_due if idx == 0 else 0

            # created_by preserves the original submitter for the audit
            # trail; authorized_by/at reflect the admin who just made this
            # correction, and status/record_source stay as they were —
            # Modify never flips a record between New and Previous.
            insert_data['created_by'] = old_created_by
            insert_data['record_source'] = 'Previous' if is_previous else 'New'
            insert_data['status'] = 'authorized'
            insert_data['authorized_by'] = requested_by
            insert_data['authorized_at'] = now

            for f in entry_def['fields']:
                if f.get('type') == 'number' and f['name'] not in ('advance', 'due'):
                    v = insert_data.get(f['name'])
                    if v is None or v == "":
                        insert_data[f['name']] = 0
                    else:
                        try:
                            insert_data[f['name']] = float(v)
                        except (TypeError, ValueError):
                            insert_data[f['name']] = 0

            insert_data = {k: v for k, v in insert_data.items() if k in table_cols}

            cols = list(insert_data.keys())
            vals = list(insert_data.values())
            placeholders = ", ".join([ph] * len(cols))
            cursor.execute(f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES ({placeholders})", vals)
            new_ids.append(cursor.lastrowid)

            if is_previous:
                pass  # historical backfill — never touches inventory or the products catalog
            elif table_name == 'purchases':
                _inventory_add_purchase(
                    cursor, mode, client_id,
                    insert_data.get('product_type'), insert_data.get('size'),
                    float(insert_data.get('quantity') or 0), float(insert_data.get('unit_price') or 0),
                )
                if insert_data.get('product_type'):
                    _upsert_product(
                        cursor, mode, client_id, insert_data['product_type'],
                        insert_data.get('size') or "", float(insert_data.get('unit_price') or 0),
                    )
            else:
                _inventory_reduce_sale(
                    cursor, mode, client_id,
                    insert_data.get('product_type'), insert_data.get('size'),
                    float(insert_data.get('received_quantity') or 0),
                )

        if mode == 'sqlite':
            conn.commit()

        result = {
            "status": "success", "table": table_name, "ids": new_ids,
            "line_count": len(new_ids), ref_col: ref_no,
        }
        return result
    finally:
        conn.close()


# ---------------- QUOTATIONS ----------------
def get_next_quotation_no(client_id):
    # Based on the MAX numeric suffix among existing quotation_no values,
    # not a row/distinct count — a count-based scheme collides forever once
    # any gap appears (a deleted quotation, or a number skipped for any
    # reason): the count stops matching the highest number actually in use,
    # so every new quotation keeps recomputing the same already-taken
    # number. MAX is immune to gaps since it only looks at what's highest.
    config = load_config()
    pad = int(config['system'].get('chalan_pad', 6))
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(f"SELECT quotation_no FROM quotations WHERE client_id = {ph}", (client_id,))
    rows = cursor.fetchall()
    conn.close()
    max_no = 0
    for r in rows:
        qno = r[0] if mode == 'sqlite' else r['quotation_no']
        if qno and qno.startswith('QT-') and qno[3:].isdigit():
            max_no = max(max_no, int(qno[3:]))
    next_no = max_no + 1
    return f"QT-{str(next_no).zfill(pad)}"


def list_quotation_refs(client_id=None):
    """Approved quotations available to link into a Sales Entry."""
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT DISTINCT quotation_no, customer_name FROM quotations "
        f"WHERE client_id = {ph} AND status = {ph} ORDER BY quotation_no DESC",
        (client_id, 'approved')
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_quotation_data(quotation_no, client_id=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(
        f"SELECT * FROM quotations WHERE quotation_no = {ph} AND client_id = {ph} ORDER BY id ASC",
        (quotation_no, client_id)
    )
    rows = cursor.fetchall()
    items = [dict(r) for r in rows] if mode == 'sqlite' else list(rows)
    conn.close()
    if not items:
        return None
    header = items[0]
    grand_total = round(sum(float(i.get('total') or 0) for i in items), 2)
    return {
        "quotation_no": quotation_no,
        "customer_name": header.get('customer_name'),
        "quotation_date": header.get('quotation_date'),
        "status": header.get('status'),
        "address": header.get('address'),
        "project_location": header.get('project_location'),
        "transport_terms": header.get('transport_terms'),
        "weighing_terms": header.get('weighing_terms'),
        "payment_terms": header.get('payment_terms'),
        "items": items,
        "grand_total": grand_total,
        "letterhead": get_letterhead_settings(),
        "system": config.get('system', {})
    }


def approve_quotation(quotation_no, requested_by, client_id=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can approve quotations")

        cursor.execute(
            f"SELECT COUNT(*) as cnt FROM quotations WHERE quotation_no = {ph} AND client_id = {ph}",
            (quotation_no, client_id)
        )
        row = cursor.fetchone()
        cnt = row[0] if mode == 'sqlite' else row['cnt']
        if not cnt:
            raise ValueError("Quotation not found")

        now = datetime.now().isoformat(timespec='seconds')
        cursor.execute(
            f"UPDATE quotations SET status = {ph}, authorized_by = {ph}, authorized_at = {ph} "
            f"WHERE quotation_no = {ph} AND client_id = {ph}",
            ('approved', requested_by, now, quotation_no, client_id)
        )
        if mode == 'sqlite':
            conn.commit()
        return {"status": "success", "quotation_no": quotation_no}
    finally:
        conn.close()


# ---------------- AUTHORIZATION ----------------
def authorize_entry(table_name, record_id, authorized_by, client_id=None):
    if table_name not in ('sales', 'purchases'):
        raise ValueError("Only sales and purchases require authorization")

    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, authorized_by)
        if role != 'admin':
            raise ValueError("Only an admin can authorize transactions")

        cursor.execute(
            f"SELECT * FROM {table_name} WHERE id = {ph} AND client_id = {ph} AND status = {ph}",
            (record_id, client_id, 'pending')
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Transaction not found or already authorized")
        record = dict(row) if mode == 'sqlite' else row

        if table_name == 'purchases':
            _inventory_add_purchase(
                cursor, mode, client_id,
                record.get('product_type'), record.get('size'),
                float(record.get('quantity') or 0),
                float(record.get('unit_price') or 0),
            )
            if record.get('product_type'):
                _upsert_product(
                    cursor, mode, client_id,
                    record['product_type'], record.get('size') or "",
                    float(record.get('unit_price') or 0),
                )
        else:
            _inventory_reduce_sale(
                cursor, mode, client_id,
                record.get('product_type'), record.get('size'),
                float(record.get('received_quantity') or 0),
            )

        now = datetime.now().isoformat(timespec='seconds')
        cursor.execute(
            f"UPDATE {table_name} SET status = {ph}, authorized_by = {ph}, authorized_at = {ph} WHERE id = {ph}",
            ('authorized', authorized_by, now, record_id)
        )

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "table": table_name, "id": record_id}
    finally:
        conn.close()


def list_pending_transactions(client_id=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    cursor.execute(
        f"SELECT * FROM purchases WHERE client_id = {ph} AND status = {ph} ORDER BY id DESC",
        (client_id, 'pending')
    )
    rows = cursor.fetchall()
    purchases = [dict(r) for r in rows] if mode == 'sqlite' else rows

    cursor.execute(
        f"SELECT * FROM sales WHERE client_id = {ph} AND status = {ph} ORDER BY id DESC",
        (client_id, 'pending')
    )
    rows = cursor.fetchall()
    sales = [dict(r) for r in rows] if mode == 'sqlite' else rows

    conn.close()
    return {"purchases": purchases, "sales": sales}


DELETABLE_TABLES = ('products', 'inventory', 'customers', 'transporters', 'purchases', 'sales', 'quotations')

# Master data with no derived/dependent fields (no totals, no inventory
# side-effects, no authorization workflow) — a plain column update is safe.
# Transaction tables (sales/purchases/etc.) are deliberately excluded since
# editing their quantity/price after the fact would leave inventory and
# due/advance out of sync with what was actually applied at save time.
EDITABLE_TABLES = ('products', 'customers')


def update_record(table_name, record_id, data, requested_by, client_id=None):
    if table_name not in EDITABLE_TABLES:
        raise ValueError(f"'{table_name}' records cannot be edited")

    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can edit records")

        cursor.execute(f"SELECT id FROM {table_name} WHERE id = {ph} AND client_id = {ph}", (record_id, client_id))
        if not cursor.fetchone():
            raise ValueError("Record not found")

        table_cols = {c['name'] for c in config['tables'][table_name]['columns']}
        editable_data = {k: v for k, v in data.items() if k in table_cols and k not in ('id', 'client_id')}
        if not editable_data:
            raise ValueError("Nothing to update")

        sets = [f"{k} = {ph}" for k in editable_data]
        params = list(editable_data.values()) + [record_id, client_id]
        cursor.execute(
            f"UPDATE {table_name} SET {', '.join(sets)} WHERE id = {ph} AND client_id = {ph}",
            params
        )

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "table": table_name, "id": record_id}
    finally:
        conn.close()


def delete_entry(table_name, record_id, requested_by, client_id=None):
    if table_name not in DELETABLE_TABLES:
        raise ValueError(f"'{table_name}' records cannot be deleted")

    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can delete records")

        cursor.execute(
            f"SELECT * FROM {table_name} WHERE id = {ph} AND client_id = {ph}",
            (record_id, client_id)
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Record not found")
        record = dict(row) if mode == 'sqlite' else row

        # "Previous" (historical backfill) rows never touched inventory when
        # created, so deleting one must not reverse an adjustment that was
        # never applied in the first place.
        is_previous = str(record.get('record_source', '')).strip().lower() == 'previous'

        if is_previous:
            pass
        elif table_name == 'purchases' and record.get('status') == 'authorized':
            _inventory_adjust_quantity(
                cursor, mode, client_id,
                record.get('product_type'), record.get('size'),
                -float(record.get('quantity') or 0),
            )
        elif table_name == 'sales' and record.get('status') == 'authorized':
            _inventory_adjust_quantity(
                cursor, mode, client_id,
                record.get('product_type'), record.get('size'),
                float(record.get('received_quantity') or 0),
            )

        cursor.execute(
            f"DELETE FROM {table_name} WHERE id = {ph} AND client_id = {ph}",
            (record_id, client_id)
        )

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "table": table_name, "id": record_id}
    finally:
        conn.close()


ADJUSTABLE_TABLES = {
    'sales': 'sale_total_price',
    'purchases': 'total',
    'transporters': 'rent',
}


def adjust_entry(table_name, record_id, requested_by, payment_due_date=None,
                  additional_advance=None, client_id=None):
    """Admin-only: change a record's payment_due_date directly and/or add to
    its advance (the new advance is old_advance + additional_advance, never
    a replacement — due is then recomputed as max(0, total - new_advance)).
    Sales/purchases must already be status='authorized'; transporters have
    no authorization gate so any transporter row can be adjusted.
    """
    if table_name not in ADJUSTABLE_TABLES:
        raise ValueError(f"'{table_name}' records cannot be adjusted")
    if payment_due_date is None and additional_advance is None:
        raise ValueError("Nothing to adjust — provide payment_due_date and/or additional_advance")

    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can adjust records")

        cursor.execute(
            f"SELECT * FROM {table_name} WHERE id = {ph} AND client_id = {ph}",
            (record_id, client_id)
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Record not found")
        record = dict(row) if mode == 'sqlite' else row

        if table_name in ('sales', 'purchases') and record.get('status') != 'authorized':
            raise ValueError("Only authorized records can be adjusted")

        set_clauses = []
        params = []

        if payment_due_date is not None:
            set_clauses.append(f"payment_due_date = {ph}")
            params.append(payment_due_date)

        if additional_advance is not None:
            additional_advance = float(additional_advance)
            total_col = ADJUSTABLE_TABLES[table_name]
            total_amount = float(record.get(total_col) or 0)
            old_advance = float(record.get('advance') or 0)
            new_advance = round(old_advance + additional_advance, 2)
            new_due = round(max(0.0, total_amount - new_advance), 2)
            set_clauses.append(f"advance = {ph}")
            set_clauses.append(f"due = {ph}")
            params.extend([new_advance, new_due])

        params.extend([record_id, client_id])
        cursor.execute(
            f"UPDATE {table_name} SET {', '.join(set_clauses)} WHERE id = {ph} AND client_id = {ph}",
            params
        )

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "table": table_name, "id": record_id}
    finally:
        conn.close()


# ---------------- CUSTOMER PAYMENTS / RECEIPTS ----------------
# A direct payment-in (Sales — money received from a buyer) or payment-out
# (Purchase/Transport — money paid to a supplier/transporter), applied
# against one or more of that party's existing outstanding bills. Recorded
# as its own auditable record (payments + payment_allocations) rather than
# just mutating advance/due in place, so it shows up in its own ledger and
# can be edited/deleted later — unlike the older Adjust button, which
# changes advance/due with no separate trace of the adjustment itself.
PAYMENT_TXN_TABLES = {
    'Sales': {'table': 'sales', 'ref_col': 'chalan_no', 'name_col': 'buyer_name',
              'total_col': 'sale_total_price', 'date_col': 'sale_date'},
    'Purchase': {'table': 'purchases', 'ref_col': 'input_invoice_no', 'name_col': 'supplier_name',
                 'total_col': 'total', 'date_col': 'purchase_date'},
    'Transport': {'table': 'transporters', 'ref_col': 'reference_no', 'name_col': 'transporter_name',
                  'total_col': 'rent', 'date_col': 'entry_date'},
}


def list_customers_with_dues(txn_type, client_id):
    """Distinct customer/supplier/transporter names that currently have an
    outstanding due for this transaction type — feeds the Payment/Receipt
    entry form's Customer dropdown, scoped to whichever Transaction Type is
    selected first."""
    spec = PAYMENT_TXN_TABLES.get(txn_type)
    if not spec:
        raise ValueError("txn_type must be one of Sales, Purchase, Transport")
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    status_clause = " AND status = 'authorized'" if spec['table'] in ('sales', 'purchases') else ""
    cursor.execute(
        f"SELECT {spec['name_col']} as name FROM {spec['table']} "
        f"WHERE client_id = {ph}{status_clause} GROUP BY {spec['name_col']} HAVING SUM(due) > 0 "
        f"ORDER BY {spec['name_col']} ASC",
        (client_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [(r[0] if mode == 'sqlite' else r['name']) for r in rows if (r[0] if mode == 'sqlite' else r['name'])]


def list_customer_dues(txn_type, customer_name, client_id):
    """Outstanding bills for one party under one transaction type, grouped
    by reference number so a multi-item transaction (several DB rows
    sharing one chalan_no/input_invoice_no) appears as a single bill with
    its true invoice-level total/advance/due — feeds the Payment/Receipt
    entry form's due-bill picker."""
    spec = PAYMENT_TXN_TABLES.get(txn_type)
    if not spec:
        raise ValueError("txn_type must be one of Sales, Purchase, Transport")
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    status_clause = " AND status = 'authorized'" if spec['table'] in ('sales', 'purchases') else ""
    cursor.execute(
        f"SELECT {spec['ref_col']} as reference_no, MAX({spec['date_col']}) as txn_date, "
        f"SUM({spec['total_col']}) as total, SUM(advance) as advance, SUM(due) as due "
        f"FROM {spec['table']} WHERE client_id = {ph} AND {spec['name_col']} = {ph}{status_clause} "
        f"GROUP BY {spec['ref_col']} HAVING SUM(due) > 0 ORDER BY MAX(id) DESC",
        (client_id, customer_name)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _apply_payment_delta(cursor, mode, client_id, table_name, ref_col, total_col, reference_no, delta_amount):
    """Add (positive, applying a payment) or subtract (negative, reversing
    one) delta_amount to/from the advance of whichever row currently carries
    the due for this reference number — mirrors the "first row of a
    multi-item group holds the whole invoice's advance/due" invariant used
    everywhere else in this codebase (see save_multi_item_entry), so due is
    recomputed against the invoice's TRUE grand total (summed across every
    row sharing the reference), not just one line item's own total."""
    ph = _ph(mode)
    cursor.execute(
        f"SELECT id, {total_col} as amt, advance FROM {table_name} "
        f"WHERE {ref_col} = {ph} AND client_id = {ph} ORDER BY id ASC",
        (reference_no, client_id)
    )
    rows = cursor.fetchall()
    if not rows:
        raise ValueError(f"No {table_name} record found for reference '{reference_no}'")
    rows = [dict(r) for r in rows] if mode == 'sqlite' else list(rows)
    grand_total = sum(float(r['amt'] or 0) for r in rows)
    first = rows[0]
    old_advance = float(first['advance'] or 0)
    new_advance = round(old_advance + delta_amount, 2)
    new_due = round(max(0.0, grand_total - new_advance), 2)
    cursor.execute(
        f"UPDATE {table_name} SET advance = {ph}, due = {ph} WHERE id = {ph}",
        (new_advance, new_due, first['id'])
    )


def _validate_payment_input(shared_data, allocations):
    txn_type = str(shared_data.get('txn_type') or '').strip()
    spec = PAYMENT_TXN_TABLES.get(txn_type)
    if not spec:
        raise ValueError("Transaction Type must be one of Sales, Purchase, Transport")
    customer_name = str(shared_data.get('customer_name') or '').strip()
    if not customer_name:
        raise ValueError("Customer is required")
    payment_date = shared_data.get('payment_date')
    if not payment_date:
        raise ValueError("Payment Date is required")
    clean_allocations = []
    for a in (allocations or []):
        ref = str(a.get('reference_no') or '').strip()
        try:
            amt = float(a.get('amount') or 0)
        except (TypeError, ValueError):
            amt = 0
        if ref and amt > 0:
            clean_allocations.append({'reference_no': ref, 'amount': round(amt, 2)})
    if not clean_allocations:
        raise ValueError("Select at least one bill and enter an amount greater than 0")
    return txn_type, spec, customer_name, payment_date, clean_allocations


def _insert_payment_and_allocations(cursor, mode, ph, client_id, txn_type, spec, customer_name,
                                     payment_date, notes, clean_allocations, total_amount, created_by):
    now = datetime.now().isoformat(timespec='seconds')
    cursor.execute(
        f"INSERT INTO payments (client_id, payment_date, txn_type, customer_name, total_amount, notes, created_by, created_at) "
        f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})",
        (client_id, payment_date, txn_type, customer_name, total_amount, notes, created_by, now)
    )
    payment_id = cursor.lastrowid
    for a in clean_allocations:
        _apply_payment_delta(cursor, mode, client_id, spec['table'], spec['ref_col'],
                              spec['total_col'], a['reference_no'], a['amount'])
        cursor.execute(
            f"INSERT INTO payment_allocations (client_id, payment_id, table_name, reference_no, allocated_amount) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (client_id, payment_id, spec['table'], a['reference_no'], a['amount'])
        )
    return payment_id


def save_payment(shared_data, allocations, client_id=None, created_by=None):
    """Records a payment/receipt and applies it against one or more of the
    party's selected outstanding bills. allocations: [{"reference_no": ...,
    "amount": ...}, ...] — one entry per bill the operator chose to pay."""
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    txn_type, spec, customer_name, payment_date, clean_allocations = _validate_payment_input(shared_data, allocations)
    total_amount = round(sum(a['amount'] for a in clean_allocations), 2)

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    try:
        payment_id = _insert_payment_and_allocations(
            cursor, mode, ph, client_id, txn_type, spec, customer_name,
            payment_date, shared_data.get('notes'), clean_allocations, total_amount, created_by
        )
        if mode == 'sqlite':
            conn.commit()
        return {"status": "success", "id": payment_id, "total_amount": total_amount}
    finally:
        conn.close()


def get_payment_detail(payment_id, client_id=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    cursor.execute(f"SELECT * FROM payments WHERE id = {ph} AND client_id = {ph}", (payment_id, client_id))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    payment = dict(row)
    cursor.execute(
        f"SELECT reference_no, allocated_amount FROM payment_allocations "
        f"WHERE payment_id = {ph} AND client_id = {ph} ORDER BY id ASC",
        (payment_id, client_id)
    )
    allocs = cursor.fetchall()
    conn.close()
    payment['allocations'] = [dict(a) for a in allocs]
    return payment


def _reverse_payment(cursor, mode, client_id, payment_id):
    """Undoes a payment's effect on every bill it was allocated against,
    then deletes the payment + its allocation rows. Shared by update and
    delete — update is simply reverse-old, then re-save as new."""
    ph = _ph(mode)
    cursor.execute(
        f"SELECT table_name, reference_no, allocated_amount FROM payment_allocations "
        f"WHERE payment_id = {ph} AND client_id = {ph}",
        (payment_id, client_id)
    )
    allocs = cursor.fetchall()
    allocs = [dict(a) for a in allocs] if mode == 'sqlite' else list(allocs)
    ref_col_by_table = {'sales': 'chalan_no', 'purchases': 'input_invoice_no', 'transporters': 'reference_no'}
    total_col_by_table = {'sales': 'sale_total_price', 'purchases': 'total', 'transporters': 'rent'}
    for a in allocs:
        table_name = a['table_name']
        _apply_payment_delta(cursor, mode, client_id, table_name, ref_col_by_table[table_name],
                              total_col_by_table[table_name], a['reference_no'], -float(a['allocated_amount'] or 0))
    cursor.execute(f"DELETE FROM payment_allocations WHERE payment_id = {ph} AND client_id = {ph}", (payment_id, client_id))
    cursor.execute(f"DELETE FROM payments WHERE id = {ph} AND client_id = {ph}", (payment_id, client_id))


def update_payment(payment_id, shared_data, allocations, requested_by, client_id=None):
    """Admin-only: reverse the old allocations' effect, then insert a fresh
    payment with the edited data — mirrors update_multi_item_entry()'s
    reverse-old/insert-new pattern. Validates the new data before touching
    anything, so a rejected edit never leaves the old payment reversed with
    nothing re-applied in its place."""
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    txn_type, spec, customer_name, payment_date, clean_allocations = _validate_payment_input(shared_data, allocations)
    total_amount = round(sum(a['amount'] for a in clean_allocations), 2)

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can modify a payment")

        cursor.execute(f"SELECT id FROM payments WHERE id = {ph} AND client_id = {ph}", (payment_id, client_id))
        if not cursor.fetchone():
            raise ValueError("Payment not found")

        _reverse_payment(cursor, mode, client_id, payment_id)
        new_payment_id = _insert_payment_and_allocations(
            cursor, mode, ph, client_id, txn_type, spec, customer_name,
            payment_date, shared_data.get('notes'), clean_allocations, total_amount, requested_by
        )
        if mode == 'sqlite':
            conn.commit()
        return {"status": "success", "id": new_payment_id, "total_amount": total_amount}
    finally:
        conn.close()


def delete_payment(payment_id, requested_by, client_id=None):
    """Admin-only: reverses this payment's effect on every bill it touched,
    then removes it — mirrors delete_entry()'s reversal pattern."""
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can delete a payment")

        cursor.execute(f"SELECT id FROM payments WHERE id = {ph} AND client_id = {ph}", (payment_id, client_id))
        if not cursor.fetchone():
            raise ValueError("Payment not found")

        _reverse_payment(cursor, mode, client_id, payment_id)

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "id": payment_id}
    finally:
        conn.close()


def delete_user(user_id, requested_by):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can delete user accounts")

        cursor.execute(f"SELECT id, role FROM users WHERE id = {ph}", (user_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError("User not found")
        target_role = row[1] if mode == 'sqlite' else row['role']

        if target_role == 'admin':
            cursor.execute("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
            cnt_row = cursor.fetchone()
            admin_count = cnt_row[0] if mode == 'sqlite' else cnt_row['cnt']
            if admin_count <= 1:
                raise ValueError("Cannot delete the last remaining admin account")

        cursor.execute(f"DELETE FROM users WHERE id = {ph}", (user_id,))

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "id": user_id}
    finally:
        conn.close()


def update_user(user_id, requested_by, new_username=None, new_password=None):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    try:
        role = _lookup_user_role(cursor, mode, requested_by)
        if role != 'admin':
            raise ValueError("Only an admin can edit user accounts")

        cursor.execute(f"SELECT id FROM users WHERE id = {ph}", (user_id,))
        if not cursor.fetchone():
            raise ValueError("User not found")

        sets, params = [], []
        if new_username:
            sets.append(f"username = {ph}")
            params.append(new_username)
        if new_password:
            sets.append(f"password_hash = {ph}")
            params.append(hash_password(new_password))
        if not sets:
            raise ValueError("Nothing to update — provide a new username and/or password")

        params.append(user_id)
        try:
            cursor.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = {ph}", params)
        except Exception:
            raise ValueError("That username is already taken by another account")

        if mode == 'sqlite':
            conn.commit()

        return {"status": "success", "id": user_id}
    finally:
        conn.close()


# ---------------- REPORTS ----------------
def _record_mode_clause(table, record_mode):
    """SQL fragment filtering a sales/purchases sub-select by record_source.
    Transporters have no record_source column at all (point 4/5 only cover
    Sales/Purchase), so a 'Previous' view excludes that table entirely
    rather than erroring on a missing column."""
    if table == 'transporters':
        return " AND 1=0" if record_mode == 'Previous' else ""
    if record_mode == 'Previous':
        return " AND record_source = 'Previous'"
    return " AND (record_source = 'New' OR record_source IS NULL)"


def execute_report(report_id, client_id=None, date_from=None, date_to=None,
                   customer=None, po_order=None, txn_type=None, record_mode=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    report_def = next((rp for rp in config.get('report_points', []) if rp['id'] == report_id), None)
    if not report_def:
        raise ValueError(f"Unknown report point ID: {report_id}")

    conn, mode = get_db_connection()
    cursor = conn.cursor()

    params = {'client_id': client_id}
    record_mode_eff = record_mode if record_mode in ('New', 'Previous') else 'New'

    # Build per-type queries for customer_dues_report when a specific type is requested
    if txn_type and report_def.get('supports_txn_type_filter') and txn_type != 'All':
        if txn_type == 'Sales':
            sql = ("SELECT buyer_name as customer, SUM(sale_total_price) as total_amount, "
                   "SUM(advance) as total_advance, SUM(due) as sales_receivable, "
                   "0 as purchase_payable, 0 as transport_payable, SUM(due) as total_due "
                   "FROM sales WHERE client_id = :client_id AND status = 'authorized' {rm_sales} "
                   "{date_filter} GROUP BY buyer_name ORDER BY total_due DESC")
            date_col = 'sale_date'
        elif txn_type == 'Purchase':
            sql = ("SELECT supplier_name as customer, SUM(total) as total_amount, "
                   "SUM(advance) as total_advance, 0 as sales_receivable, "
                   "SUM(due) as purchase_payable, 0 as transport_payable, SUM(due) as total_due "
                   "FROM purchases WHERE client_id = :client_id AND status = 'authorized' {rm_purchases} "
                   "{date_filter} GROUP BY supplier_name ORDER BY total_due DESC")
            date_col = 'purchase_date'
        elif txn_type == 'Transport':
            sql = ("SELECT transporter_name as customer, SUM(rent) as total_amount, "
                   "SUM(advance) as total_advance, 0 as sales_receivable, "
                   "0 as purchase_payable, SUM(due) as transport_payable, SUM(due) as total_due "
                   "FROM transporters WHERE client_id = :client_id {rm_transport} "
                   "{date_filter} GROUP BY transporter_name ORDER BY total_due DESC")
            date_col = 'entry_date'
        else:
            sql = report_def['query']
            date_col = report_def.get('date_column')
    else:
        sql = report_def['query']
        date_col = report_def.get('date_column')

    date_filter_sql = ""
    if date_col and (date_from or date_to):
        parts = []
        if date_from:
            parts.append(f"{date_col} >= :date_from")
            params['date_from'] = date_from
        if date_to:
            parts.append(f"{date_col} <= :date_to")
            params['date_to'] = date_to
        date_filter_sql = " AND " + " AND ".join(parts)

    customer_filter_sql = ""
    if report_def.get('supports_customer_filter') and customer:
        filter_col = report_def.get('customer_filter_column', 'buyer_name')
        customer_filter_sql = f" AND {filter_col} = :customer"
        params['customer'] = customer

    po_filter_sql = ""
    if report_def.get('supports_po_filter') and po_order:
        po_filter_sql = " AND po_order = :po_order"
        params['po_order'] = po_order

    sql = (sql.replace("{date_filter}", date_filter_sql)
              .replace("{customer_filter}", customer_filter_sql)
              .replace("{po_filter}", po_filter_sql)
              .replace("{rm_sales}", _record_mode_clause('sales', record_mode_eff))
              .replace("{rm_purchases}", _record_mode_clause('purchases', record_mode_eff))
              .replace("{rm_transport}", _record_mode_clause('transporters', record_mode_eff)))

    if mode == 'sqlite':
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        result_data = [dict(r) for r in rows]
    else:
        # Convert :name to %(name)s for pymysql
        import re
        mysql_sql = re.sub(r":(\w+)", r"%(\1)s", sql)
        cursor.execute(mysql_sql, params)
        result_data = cursor.fetchall()

    conn.close()

    total_summary = 0.0
    summary_col = report_def.get('summary_column')
    if summary_col:
        for row in result_data:
            total_summary += float(row.get(summary_col, 0) or 0)

    db_keys = list(result_data[0].keys()) if result_data else []

    return {
        "title": report_def['title'],
        "columns": report_def['columns'],
        "keys": db_keys,
        "data": result_data,
        "summary_column": summary_col,
        "summary_total": round(total_summary, 2),
        "supports_period": bool(report_def.get('supports_period')),
        "supports_customer_filter": bool(report_def.get('supports_customer_filter')),
        "supports_po_filter": bool(report_def.get('supports_po_filter')),
        "supports_record_mode": bool(report_def.get('supports_record_mode'))
    }


def get_invoice_data(invoice_id, client_id=None):
    """invoice_id may be a chalan_no or sales.id"""
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    cursor.execute(
        f"SELECT * FROM sales WHERE (chalan_no = {ph} OR CAST(id AS TEXT) = {ph}) AND client_id = {ph}"
        if mode == 'sqlite'
        else f"SELECT * FROM sales WHERE (chalan_no = {ph} OR CAST(id AS CHAR) = {ph}) AND client_id = {ph}",
        (str(invoice_id), str(invoice_id), client_id)
    )
    row = cursor.fetchone()
    sale_data = dict(row) if row and mode == 'sqlite' else (row if row else None)

    if not sale_data:
        conn.close()
        return None

    # A multi-product sale shares one chalan_no across several rows — the
    # anchor row above (whichever the lookup happened to match) carries the
    # shared invoice-level fields (buyer, date, advance, due, transport),
    # while every row sharing that chalan_no is a product line item.
    cursor.execute(
        f"SELECT * FROM sales WHERE chalan_no = {ph} AND client_id = {ph} ORDER BY id ASC",
        (sale_data['chalan_no'], client_id)
    )
    item_rows = cursor.fetchall()
    items = [dict(r) for r in item_rows] if mode == 'sqlite' else list(item_rows)
    conn.close()

    return {
        "sale": sale_data,
        "items": items,
        "letterhead": get_letterhead_settings(),
        "system": config.get('system', {})
    }


# ---------------- CHALLAN FILE UPLOADS (Google Drive) ----------------
def save_challan_upload(chalan_no, client_id, file_name, drive_file_id, drive_view_url, uploaded_by):
    """Upsert keyed by (client_id, chalan_no) — a chalan is one physical
    document even though a multi-product sale spreads it across several
    sales rows, so the attachment lives in its own table rather than being
    duplicated onto every line-item row."""
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    now = datetime.now().isoformat(timespec='seconds')
    try:
        cursor.execute(
            f"SELECT id FROM challan_uploads WHERE chalan_no = {ph} AND client_id = {ph}",
            (chalan_no, client_id)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                f"UPDATE challan_uploads SET file_name = {ph}, drive_file_id = {ph}, "
                f"drive_view_url = {ph}, uploaded_by = {ph}, uploaded_at = {ph} "
                f"WHERE chalan_no = {ph} AND client_id = {ph}",
                (file_name, drive_file_id, drive_view_url, uploaded_by, now, chalan_no, client_id)
            )
        else:
            cursor.execute(
                f"INSERT INTO challan_uploads (client_id, chalan_no, file_name, drive_file_id, "
                f"drive_view_url, uploaded_by, uploaded_at) VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})",
                (client_id, chalan_no, file_name, drive_file_id, drive_view_url, uploaded_by, now)
            )
        if mode == 'sqlite':
            conn.commit()
        return {"status": "success", "chalan_no": chalan_no, "drive_view_url": drive_view_url}
    finally:
        conn.close()


def get_dashboard(client_id=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)

    cursor.execute(f"SELECT COALESCE(SUM(sale_total_price),0) as rev, COUNT(*) as cnt FROM sales WHERE client_id = {ph} AND status = 'authorized'", (client_id,))
    row = cursor.fetchone()
    total_revenue = float(row[0] if mode == 'sqlite' else row['rev']) or 0
    total_sales_count = int(row[1] if mode == 'sqlite' else row['cnt']) or 0

    cursor.execute(f"SELECT COALESCE(SUM(total),0) as pur FROM purchases WHERE client_id = {ph} AND status = 'authorized'", (client_id,))
    row = cursor.fetchone()
    total_purchases = float(row[0] if mode == 'sqlite' else row['pur']) or 0

    cursor.execute(f"SELECT COALESCE(SUM(quantity * cost_price),0) as val FROM inventory WHERE client_id = {ph}", (client_id,))
    row = cursor.fetchone()
    total_inventory_valuation = float(row[0] if mode == 'sqlite' else row['val']) or 0

    cursor.execute(f"SELECT COUNT(*) as low FROM inventory WHERE client_id = {ph} AND quantity <= 5", (client_id,))
    row = cursor.fetchone()
    low_stock_count = int(row[0] if mode == 'sqlite' else row['low']) or 0

    cursor.execute(f"SELECT COALESCE(SUM(due),0) as due FROM sales WHERE client_id = {ph} AND status = 'authorized'", (client_id,))
    row = cursor.fetchone()
    total_receivable = float(row[0] if mode == 'sqlite' else row['due']) or 0

    cursor.execute(f"SELECT COALESCE(SUM(due),0) as due FROM purchases WHERE client_id = {ph} AND status = 'authorized'", (client_id,))
    row = cursor.fetchone()
    total_payable = float(row[0] if mode == 'sqlite' else row['due']) or 0

    cursor.execute(
        f"SELECT id, chalan_no, sale_date, buyer_name, product_type, size, "
        f"sale_total_price, due FROM sales WHERE client_id = {ph} AND status = 'authorized' ORDER BY id DESC LIMIT 5",
        (client_id,)
    )
    rows = cursor.fetchall()
    recent_sales = [dict(r) for r in rows] if mode == 'sqlite' else rows

    conn.close()

    return {
        "total_revenue": round(total_revenue, 2),
        "total_sales_count": total_sales_count,
        "total_purchases": round(total_purchases, 2),
        "inventory_valuation": round(total_inventory_valuation, 2),
        "low_stock_count": low_stock_count,
        "total_receivable": round(total_receivable, 2),
        "total_payable": round(total_payable, 2),
        "recent_sales": recent_sales,
        "currency": config['system'].get('currency_symbol', 'BDT')
    }


if __name__ == '__main__':
    init_db()
