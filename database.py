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
        f"SELECT id, product_type, size, unit_price FROM products WHERE client_id = {ph} "
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
            f"SELECT id, customer_name, customer_type, contact_number FROM customers "
            f"WHERE client_id = {ph} AND customer_type = {ph} ORDER BY customer_name ASC",
            (client_id, customer_type)
        )
    else:
        cursor.execute(
            f"SELECT id, customer_name, customer_type, contact_number FROM customers "
            f"WHERE client_id = {ph} ORDER BY customer_name ASC",
            (client_id,)
        )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_invoice_refs(ref_type, client_id):
    """List existing sale chalans or purchase invoice numbers (with their
    quantity) for the Transporter Entry form's reference-number dropdown."""
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    if ref_type == 'sales':
        cursor.execute(
            f"SELECT chalan_no as reference_no, received_quantity as quantity, "
            f"loading_location as from_location, unloading_location as to_location "
            f"FROM sales WHERE client_id = {ph} ORDER BY id DESC",
            (client_id,)
        )
    elif ref_type == 'purchases':
        cursor.execute(
            f"SELECT input_invoice_no as reference_no, quantity, "
            f"loading_location as from_location, unloading_location as to_location "
            f"FROM purchases WHERE client_id = {ph} ORDER BY id DESC",
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
            rent = float(insert_data.get('rent') or 0)
            advance = float(insert_data.get('advance') or 0)
            insert_data['due'] = round(max(0.0, rent - advance), 2)

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


DELETABLE_TABLES = ('products', 'customers', 'transporters', 'purchases', 'sales')


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

        if table_name == 'purchases' and record.get('status') == 'authorized':
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


# ---------------- REPORTS ----------------
def execute_report(report_id, client_id=None, date_from=None, date_to=None,
                   customer=None, txn_type=None):
    config = load_config()
    if not client_id:
        client_id = config['system'].get('default_client_id', 'CLI-001')

    report_def = next((rp for rp in config.get('report_points', []) if rp['id'] == report_id), None)
    if not report_def:
        raise ValueError(f"Unknown report point ID: {report_id}")

    conn, mode = get_db_connection()
    cursor = conn.cursor()

    params = {'client_id': client_id}

    # Build per-type queries for customer_dues_report when a specific type is requested
    if txn_type and report_def.get('supports_txn_type_filter') and txn_type != 'All':
        if txn_type == 'Sales':
            sql = ("SELECT buyer_name as customer, SUM(sale_total_price) as total_amount, "
                   "SUM(advance) as total_advance, SUM(due) as total_due "
                   "FROM sales WHERE client_id = :client_id AND status = 'authorized' "
                   "{date_filter} GROUP BY buyer_name ORDER BY total_due DESC")
            date_col = 'sale_date'
        elif txn_type == 'Purchase':
            sql = ("SELECT supplier_name as customer, SUM(total) as total_amount, "
                   "SUM(advance) as total_advance, SUM(due) as total_due "
                   "FROM purchases WHERE client_id = :client_id AND status = 'authorized' "
                   "{date_filter} GROUP BY supplier_name ORDER BY total_due DESC")
            date_col = 'purchase_date'
        elif txn_type == 'Transport':
            sql = ("SELECT transporter_name as customer, SUM(rent) as total_amount, "
                   "SUM(advance) as total_advance, SUM(due) as total_due "
                   "FROM transporters WHERE client_id = :client_id "
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

    sql = sql.replace("{date_filter}", date_filter_sql).replace("{customer_filter}", customer_filter_sql)

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
        "supports_customer_filter": bool(report_def.get('supports_customer_filter'))
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
    conn.close()

    if not sale_data:
        return None

    return {
        "sale": sale_data,
        "letterhead": config.get('letterhead', {}),
        "system": config.get('system', {})
    }


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
