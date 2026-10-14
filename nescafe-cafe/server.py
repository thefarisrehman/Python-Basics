"""Nescafe Web Cafe - backend server.

Zero-dependency (Python 3.8+ standard library only).

    python3 server.py              # http://localhost:8000
    PORT=5000 python3 server.py
    ADMIN_KEY=secret python3 server.py   # enables /admin.html order list

Endpoints
    GET  /api/products   menu, sizes, currency, delivery settings
    POST /api/orders     place an order (prices are recomputed server-side)
    GET  /api/orders     list orders (requires header X-Admin-Key)
"""

import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
PRODUCTS_FILE = DATA_DIR / "products.json"
ORDERS_FILE = DATA_DIR / "orders.json"

ADMIN_KEY = os.environ.get("ADMIN_KEY", "")
MAX_BODY = 20_000
MAX_QTY = 20
PHONE_RE = re.compile(r"^[0-9+()\-\s]{7,20}$")

_orders_lock = threading.Lock()


def load_menu():
    with PRODUCTS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def load_orders():
    if not ORDERS_FILE.exists():
        return []
    with ORDERS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def save_order(order):
    with _orders_lock:
        orders = load_orders()
        orders.append(order)
        tmp = ORDERS_FILE.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(orders, f, indent=2, ensure_ascii=False)
        tmp.replace(ORDERS_FILE)


def build_order(payload, menu):
    """Validate the client payload and return (order, error)."""
    if not isinstance(payload, dict):
        return None, "Invalid request."

    customer = payload.get("customer") or {}
    name = str(customer.get("name", "")).strip()
    phone = str(customer.get("phone", "")).strip()
    mode = customer.get("mode", "pickup")
    address = str(customer.get("address", "")).strip()
    notes = str(customer.get("notes", "")).strip()[:300]

    if not 2 <= len(name) <= 80:
        return None, "Please enter your name."
    if not PHONE_RE.match(phone):
        return None, "Please enter a valid phone number."
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
        if product is None or size not in sizes:
            return None, "One of the items is no longer available."
        if not isinstance(qty, int) or not 1 <= qty <= MAX_QTY:
            return None, f"Quantity must be between 1 and {MAX_QTY}."
        unit = round(product["price"] + sizes[size]["add"], 2)
        line_total = round(unit * qty, 2)
        subtotal += line_total
        lines.append({
            "id": product["id"],
            "name": product["name"],
            "size": size,
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
        "orderId": "NC-" + secrets.token_hex(3).upper(),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "received",
        "customer": {
            "name": name,
            "phone": phone,
            "mode": mode,
            "address": address if mode == "delivery" else "",
            "notes": notes,
        },
        "items": lines,
        "subtotal": subtotal,
        "deliveryFee": delivery,
        "total": total,
        "currency": menu["currency"],
        "etaMinutes": 30 if mode == "delivery" else 10,
    }
    return order, None


class CafeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/products":
            return self.send_json(200, load_menu())
        if path == "/api/orders":
            if not ADMIN_KEY:
                return self.send_json(403, {"error": "Set ADMIN_KEY to enable the orders list."})
            if not secrets.compare_digest(self.headers.get("X-Admin-Key", ""), ADMIN_KEY):
                return self.send_json(401, {"error": "Wrong admin key."})
            return self.send_json(200, list(reversed(load_orders())))
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/orders":
            return self.send_json(404, {"error": "Not found."})
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self.send_json(400, {"error": "Invalid request size."})
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self.send_json(400, {"error": "Invalid JSON."})

        order, error = build_order(payload, load_menu())
        if error:
            return self.send_json(422, {"error": error})
        save_order(order)
        print(f"New order {order['orderId']}: {order['currency']}{order['total']:.2f} "
              f"({order['customer']['name']}, {order['customer']['mode']})")
        return self.send_json(201, order)


def main():
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), CafeHandler)
    print(f"Nescafe Web Cafe running on http://localhost:{port}")
    if not ADMIN_KEY:
        print("Tip: start with ADMIN_KEY=yourkey to view orders at /admin.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")


if __name__ == "__main__":
    main()
