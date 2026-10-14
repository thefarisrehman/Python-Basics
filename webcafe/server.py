"""WebCafe - backend server.

Zero-dependency (Python 3.8+ standard library only).

    python3 server.py            # http://localhost:8000

Settings come from environment variables or a `.env` file next to this
script (see .env.example). Without Safepay keys the site runs in TEST
payment mode.

Endpoints
    GET  /api/products        menu, sizes, currency, delivery settings
    POST /api/orders          create an order and start online payment
    GET  /api/orders/<id>     public order status (after payment redirect)
    GET  /api/orders          all orders (requires header X-Admin-Key)
    GET|POST /payment/return  Safepay redirect; verifies signature, marks paid
    POST /api/test-pay        TEST mode only: simulate a successful payment
"""

import json
import os
import re
import secrets
import threading
import urllib.parse
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from notify import notify_paid_order
from payments import PaymentError, Safepay

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
PRODUCTS_FILE = DATA_DIR / "products.json"
ORDERS_FILE = DATA_DIR / "orders.json"

MAX_BODY = 20_000
MAX_QTY = 20
PHONE_RE = re.compile(r"^[0-9+()\-\s]{7,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ORDER_ID_RE = re.compile(r"^WC-[0-9A-F]{8}$")


def load_config():
    cfg = {}
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                v = v.split(" #", 1)[0].strip()
                cfg[k.strip()] = v.strip('"').strip("'")
    cfg.update({k: v for k, v in os.environ.items() if v})
    return cfg


CFG = load_config()
ADMIN_KEY = CFG.get("ADMIN_KEY", "")
SAFEPAY = None
if CFG.get("SAFEPAY_API_KEY") and CFG.get("SAFEPAY_SECRET_KEY"):
    SAFEPAY = Safepay(CFG.get("SAFEPAY_ENV", "sandbox"), CFG["SAFEPAY_API_KEY"], CFG["SAFEPAY_SECRET_KEY"])
TEST_MODE = SAFEPAY is None

_orders_lock = threading.Lock()


def load_menu():
    with PRODUCTS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def _read_orders():
    if not ORDERS_FILE.exists():
        return []
    with ORDERS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def _write_orders(orders):
    tmp = ORDERS_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(orders, f, indent=2, ensure_ascii=False)
    tmp.replace(ORDERS_FILE)


def save_order(order):
    with _orders_lock:
        orders = _read_orders()
        orders.append(order)
        _write_orders(orders)


def find_order(order_id):
    with _orders_lock:
        return next((o for o in _read_orders() if o["orderId"] == order_id), None)


def update_order(order_id, **fields):
    with _orders_lock:
        orders = _read_orders()
        for o in orders:
            if o["orderId"] == order_id:
                o.update(fields)
                _write_orders(orders)
                return o
    return None


def mark_paid(order_id, **fields):
    """Mark an order paid once and send notifications. Returns the order."""
    with _orders_lock:
        orders = _read_orders()
        order = next((o for o in orders if o["orderId"] == order_id), None)
        if order is None or order["status"] == "paid":
            return order
        order.update(status="paid", paidAt=datetime.now(timezone.utc).isoformat(timespec="seconds"), **fields)
        _write_orders(orders)
    print(f"PAID order {order_id}: {order['currency']}{order['total']:.2f} ({order['customer']['name']})")
    notify_paid_order(CFG, order)
    return order


def build_order(payload, menu):
    """Validate the client payload and return (order, error)."""
    if not isinstance(payload, dict):
        return None, "Invalid request."

    customer = payload.get("customer") or {}
    name = str(customer.get("name", "")).strip()
    phone = str(customer.get("phone", "")).strip()
    email = str(customer.get("email", "")).strip()
    mode = customer.get("mode", "pickup")
    address = str(customer.get("address", "")).strip()[:200]
    notes = str(customer.get("notes", "")).strip()[:300]

    if not 2 <= len(name) <= 80:
        return None, "Please enter your name."
    if not PHONE_RE.match(phone):
        return None, "Please enter a valid phone number."
    if len(email) > 120 or not EMAIL_RE.match(email):
        return None, "Please enter a valid email for your receipt."
    if mode not in ("pickup", "delivery"):
        return None, "Choose pickup or delivery."
    if mode == "delivery" and len(address) < 6:
        return None, "Please enter a delivery address."

    products = {p["id"]: p for p in menu["products"]}
    sizes = menu["sizes"]
    items = payload.get("items")
    if not isinstance(items, list) or not items or len(items) > 50:
        return None, "Your order is empty."

    lines, subtotal = [], 0.0
    for item in items:
        if not isinstance(item, dict):
            return None, "Invalid item."
        product = products.get(item.get("id"))
        size = item.get("size")
        qty = item.get("qty")
        if product is None:
            return None, "One of the items is no longer available."
        if product["sized"] and size not in sizes:
            return None, "Please choose a size."
        if not product["sized"]:
            size = None
        if not isinstance(qty, int) or not 1 <= qty <= MAX_QTY:
            return None, f"Quantity must be between 1 and {MAX_QTY}."
        unit = round(product["price"] + (sizes[size]["add"] if size else 0), 2)
        line_total = round(unit * qty, 2)
        subtotal += line_total
        lines.append({
            "id": product["id"],
            "name": product["name"],
            "size": size,
            "sizeLabel": sizes[size]["label"] if size else "",
            "qty": qty,
            "unitPrice": unit,
            "lineTotal": line_total,
        })

    subtotal = round(subtotal, 2)
    delivery = 0.0
    if mode == "delivery" and subtotal < menu["freeDeliveryOver"]:
        delivery = menu["deliveryFee"]
    total = round(subtotal + delivery, 2)

    order = {
        "orderId": "WC-" + secrets.token_hex(4).upper(),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "pending_payment",
        "customer": {
            "name": name,
            "phone": phone,
            "email": email,
            "mode": mode,
            "address": address if mode == "delivery" else "",
            "notes": notes,
        },
        "items": lines,
        "subtotal": subtotal,
        "deliveryFee": delivery,
        "total": total,
        "currency": menu["currency"],
        "currencyCode": menu.get("currencyCode", "USD"),
        "etaMinutes": 35 if mode == "delivery" else 12,
    }
    return order, None


class CafeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    # ---------- helpers ----------
    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    def public_url(self):
        return CFG.get("PUBLIC_URL", "").rstrip("/") or f"http://{self.headers.get('Host', 'localhost')}"

    def split(self):
        parsed = urllib.parse.urlsplit(self.path)
        return parsed.path, dict(urllib.parse.parse_qsl(parsed.query))

    # ---------- routes ----------
    def do_GET(self):
        path, query = self.split()
        if path == "/api/products":
            menu = load_menu()
            menu["testMode"] = TEST_MODE
            return self.send_json(200, menu)
        if path == "/api/orders":
            if not ADMIN_KEY:
                return self.send_json(403, {"error": "Set ADMIN_KEY to enable the orders list."})
            if not secrets.compare_digest(self.headers.get("X-Admin-Key", ""), ADMIN_KEY):
                return self.send_json(401, {"error": "Wrong admin key."})
            with _orders_lock:
                return self.send_json(200, list(reversed(_read_orders())))
        if path.startswith("/api/orders/"):
            order = find_order(path.rsplit("/", 1)[1])
            if order is None:
                return self.send_json(404, {"error": "Order not found."})
            return self.send_json(200, {
                "orderId": order["orderId"], "status": order["status"], "total": order["total"],
                "currency": order["currency"], "etaMinutes": order["etaMinutes"],
                "mode": order["customer"]["mode"], "name": order["customer"]["name"].split()[0],
            })
        if path == "/payment/return":
            return self.payment_return(query)
        if path == "/payment/cancel":
            order_id = query.get("order", "")
            if ORDER_ID_RE.match(order_id):
                order = find_order(order_id)
                if order and order["status"] == "pending_payment":
                    update_order(order_id, status="cancelled")
            return self.redirect("/?cancelled=1")
        if path == "/pay-test.html" and not TEST_MODE:
            return self.send_json(404, {"error": "Not found."})
        return super().do_GET()

    def do_POST(self):
        path, query = self.split()
        if path == "/payment/return":
            raw = self.read_body() or b""
            ctype = self.headers.get("Content-Type", "")
            try:
                data = json.loads(raw) if "json" in ctype else dict(urllib.parse.parse_qsl(raw.decode()))
            except (ValueError, UnicodeDecodeError):
                data = {}
            return self.payment_return({**query, **{k: str(v) for k, v in data.items()}})

        raw = self.read_body()
        if raw is None:
            return self.send_json(400, {"error": "Invalid request size."})
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self.send_json(400, {"error": "Invalid JSON."})

        if path == "/api/orders":
            return self.create_order(payload)
        if path == "/api/test-pay" and TEST_MODE:
            order = find_order(str(payload.get("orderId", "")))
            if order is None or order["status"] not in ("pending_payment", "paid"):
                return self.send_json(404, {"error": "Order not found."})
            mark_paid(order["orderId"], payment={"provider": "test"})
            return self.send_json(200, {"redirect": f"/?paid={order['orderId']}"})
        return self.send_json(404, {"error": "Not found."})

    def create_order(self, payload):
        order, error = build_order(payload, load_menu())
        if error:
            return self.send_json(422, {"error": error})

        if TEST_MODE:
            save_order(order)
            return self.send_json(201, {"orderId": order["orderId"],
                                        "paymentUrl": f"/pay-test.html?order={order['orderId']}"})
        try:
            token = SAFEPAY.create_tracker(order["total"], order["currencyCode"])
        except PaymentError as exc:
            print(exc)
            return self.send_json(502, {"error": "Payment service is unavailable. Please try again shortly."})
        order["payment"] = {"provider": "safepay", "tracker": token}
        save_order(order)
        base = self.public_url()
        url = SAFEPAY.checkout_url(
            token, order["orderId"],
            redirect_url=f"{base}/payment/return?order={order['orderId']}",
            cancel_url=f"{base}/payment/cancel?order={order['orderId']}",
        )
        return self.send_json(201, {"orderId": order["orderId"], "paymentUrl": url})

    def payment_return(self, data):
        order_id = data.get("order") or data.get("order_id", "")
        tracker, sig = data.get("tracker", ""), data.get("sig", "")
        order = find_order(order_id) if ORDER_ID_RE.match(order_id) else None
        if order is None or SAFEPAY is None:
            return self.redirect("/?payfail=1")
        if order["status"] == "paid":
            return self.redirect(f"/?paid={order_id}")
        stored = order.get("payment", {}).get("tracker", "")
        if tracker and secrets.compare_digest(tracker, stored) and SAFEPAY.verify(tracker, sig):
            mark_paid(order_id, payment={**order["payment"], "reference": data.get("reference", "")})
            return self.redirect(f"/?paid={order_id}")
        print(f"Payment verification failed for {order_id}")
        return self.redirect("/?payfail=1")


def main():
    port = int(CFG.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), CafeHandler)
    print(f"WebCafe running on http://localhost:{port}")
    if TEST_MODE:
        print("PAYMENTS: TEST MODE (no real money). Add Safepay keys to .env to accept real payments.")
    else:
        print(f"PAYMENTS: Safepay ({SAFEPAY.env})")
    if not ADMIN_KEY:
        print("Tip: set ADMIN_KEY to view orders at /admin.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
