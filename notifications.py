"""Desktop toast notifications for upcoming payment due dates.

Runs in one of two ways:
  1. Invoked directly as `python app.py --check-notifications` (or the
     frozen exe with that same flag) — checks sales/purchases/transporters
     whose payment_due_date is tomorrow and still has an outstanding due
     amount, fires a Windows toast if any are found, then exits.
  2. Scheduled to run daily via a Windows Scheduled Task that app.py
     self-registers on normal startup (see ensure_notification_task() in
     app.py), so this fires even when nobody has the app/browser open.
"""
import time
from datetime import date, timedelta

from database import get_db_connection, load_config, _ph

try:
    from winotify import Notification
    WINOTIFY_AVAILABLE = True
except ImportError:
    WINOTIFY_AVAILABLE = False


def _due_tomorrow_items(client_id):
    conn, mode = get_db_connection()
    cursor = conn.cursor()
    ph = _ph(mode)
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    items = []

    cursor.execute(
        f"SELECT chalan_no as ref, buyer_name as party, due FROM sales "
        f"WHERE client_id = {ph} AND status = 'authorized' AND payment_due_date = {ph} AND due > 0",
        (client_id, tomorrow)
    )
    for row in cursor.fetchall():
        r = dict(row) if mode == 'sqlite' else row
        items.append(f"Sale {r['ref']} - {r['party']} (BDT {float(r['due']):.2f})")

    cursor.execute(
        f"SELECT input_invoice_no as ref, supplier_name as party, due FROM purchases "
        f"WHERE client_id = {ph} AND status = 'authorized' AND payment_due_date = {ph} AND due > 0",
        (client_id, tomorrow)
    )
    for row in cursor.fetchall():
        r = dict(row) if mode == 'sqlite' else row
        items.append(f"Purchase {r['ref']} - {r['party']} (BDT {float(r['due']):.2f})")

    cursor.execute(
        f"SELECT reference_no as ref, transporter_name as party, due FROM transporters "
        f"WHERE client_id = {ph} AND payment_due_date = {ph} AND due > 0",
        (client_id, tomorrow)
    )
    for row in cursor.fetchall():
        r = dict(row) if mode == 'sqlite' else row
        items.append(f"Transport {r['ref']} - {r['party']} (BDT {float(r['due']):.2f})")

    conn.close()
    return items


def check_and_notify_due_payments():
    config = load_config()
    client_id = config['system'].get('default_client_id', 'CLI-001')
    app_name = config['system'].get('app_name', 'Jahan Trading System')

    items = _due_tomorrow_items(client_id)
    if not items:
        print("No payments due tomorrow.")
        return

    print(f"{len(items)} payment(s) due tomorrow:")
    for item in items:
        print(" -", item)

    if not WINOTIFY_AVAILABLE:
        print("winotify not installed - skipping desktop toast.")
        return

    summary = "; ".join(items[:3])
    if len(items) > 3:
        summary += f" and {len(items) - 3} more"

    try:
        Notification(
            app_id=app_name,
            title="Payment Due Tomorrow",
            msg=summary,
            duration="long",
        ).show()
        # Notification.show() fires a detached powershell process and
        # returns immediately; give it a moment to spawn before this
        # short-lived check process exits.
        time.sleep(2)
    except Exception as e:
        print(f"Failed to show notification: {e}")


if __name__ == '__main__':
    check_and_notify_due_payments()
