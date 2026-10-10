"""Dollars Food ordering backend.

Serves the website, the menu, customer accounts, per-customer order history,
reviews and a small admin screen for the kitchen. Data lives in SQLite.

Run:  pip install -r requirements.txt && python app.py
"""
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, abort, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = Path(os.environ.get("DOLLARS_DB", BASE / "dollarsfood.db"))
SECRET = os.environ.get("DOLLARS_SECRET", "change-me-in-production")
ADMIN_KEY = os.environ.get("DOLLARS_ADMIN_KEY", "dollars-admin")
TOKEN_MAX_AGE = 60 * 60 * 24 * 90  # 90 days

ORDER_TYPES = {"delivery", "takeaway", "dinein"}
STATUSES = ["placed", "preparing", "on_the_way", "delivered", "cancelled"]

app = Flask(__name__, static_folder=str(STATIC), static_url_path="")
signer = URLSafeTimedSerializer(SECRET, salt="dollars-auth")


def load_menu():
    with open(STATIC / "menu.json", encoding="utf-8") as f:
        return json.load(f)


MENU = load_menu()
ITEMS = {item["id"]: item for item in MENU["items"]}
SETTINGS = MENU["settings"]


# ---------------------------------------------------------------- database

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    address TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    items TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    delivery_fee INTEGER NOT NULL,
    total INTEGER NOT NULL,
    order_type TEXT NOT NULL,
    address TEXT DEFAULT '',
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    payment TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    eta TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.close()


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec="seconds")


# ---------------------------------------------------------------- helpers

def error(message, code=400):
    return jsonify({"error": message}), code


def normalize_phone(raw):
    """Accept 03xx-xxxxxxx, +923xx..., 923xx... and return 03xxxxxxxxx."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("92") and len(digits) == 12:
        digits = "0" + digits[2:]
    if not re.fullmatch(r"03\d{9}", digits):
        return None
    return digits


def user_json(row):
    return {"id": row["id"], "name": row["name"], "phone": row["phone"], "address": row["address"]}


def order_json(row):
    return {
        "id": row["id"],
        "items": json.loads(row["items"]),
        "subtotal": row["subtotal"],
        "deliveryFee": row["delivery_fee"],
        "total": row["total"],
        "orderType": row["order_type"],
        "address": row["address"],
        "phone": row["phone"],
        "name": row["name"],
        "notes": row["notes"],
        "payment": row["payment"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "eta": row["eta"],
    }


def issue_token(user_id):
    return signer.dumps({"uid": user_id})


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = signer.loads(header[7:], max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return db().execute("SELECT * FROM users WHERE id = ?", (data.get("uid"),)).fetchone()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return error("Please sign in to continue.", 401)
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.headers.get("X-Admin-Key") != ADMIN_KEY:
            return error("Wrong admin key.", 403)
        return fn(*args, **kwargs)
    return wrapper


def price_cart(lines):
    """Re-price the cart from the menu so the browser can't change prices."""
    if not isinstance(lines, list) or not lines:
        raise ValueError("Your cart is empty.")
    priced = []
    for line in lines:
        item = ITEMS.get(str(line.get("id")))
        if item is None:
            raise ValueError("One of the items is no longer on the menu.")
        try:
            qty = int(line.get("qty", 1))
        except (TypeError, ValueError):
            raise ValueError("Invalid quantity.")
        if not 1 <= qty <= 50:
            raise ValueError("Quantity must be between 1 and 50.")
        name, price = item["name"], item.get("price")
        size = None
        if "sizes" in item:
            size = next((s for s in item["sizes"] if s["id"] == line.get("size")), None)
            if size is None:
                raise ValueError(f"Choose a size for {item['name']}.")
            name, price = f"{item['name']} ({size['name']})", size["price"]
        priced.append({
            "id": item["id"], "name": name, "size": size["id"] if size else None,
            "price": price, "qty": qty, "lineTotal": price * qty, "image": item.get("image"),
        })
    return priced


# ---------------------------------------------------------------- pages

def page(filename):
    """Our HTML files are written as body fragments; wrap them in a document."""
    body = (STATIC / filename).read_text(encoding="utf-8")
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">"
        "<link rel=\"icon\" href=\"img/logo.svg\">"
        f"</head><body>{body}</body></html>"
    )


@app.get("/")
def index():
    return page("index.html")


@app.get("/admin")
def admin_page():
    return page("admin.html")


# ---------------------------------------------------------------- api

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "mode": "server"})


@app.get("/api/menu")
def menu():
    return jsonify(MENU)


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    phone = normalize_phone(data.get("phone"))
    password = data.get("password") or ""
    if len(name) < 2:
        return error("Enter your name.")
    if phone is None:
        return error("Enter a valid mobile number, like 0340-1219888.")
    if len(password) < 4:
        return error("Password must be at least 4 characters.")
    conn = db()
    if conn.execute("SELECT 1 FROM users WHERE phone = ?", (phone,)).fetchone():
        return error("This number already has an account. Sign in instead.", 409)
    cur = conn.execute(
        "INSERT INTO users (name, phone, password_hash, address, created_at) VALUES (?, ?, ?, ?, ?)",
        (name, phone, generate_password_hash(password), (data.get("address") or "").strip(), iso(now())),
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"token": issue_token(user["id"]), "user": user_json(user)}), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    user = db().execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone() if phone else None
    if user is None or not check_password_hash(user["password_hash"], data.get("password") or ""):
        return error("Mobile number or password is incorrect.", 401)
    return jsonify({"token": issue_token(user["id"]), "user": user_json(user)})


@app.get("/api/me")
@login_required
def me():
    return jsonify({"user": user_json(g.user)})


@app.get("/api/orders")
@login_required
def my_orders():
    rows = db().execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", (g.user["id"],)
    ).fetchall()
    return jsonify({"orders": [order_json(r) for r in rows]})


@app.post("/api/orders")
@login_required
def place_order():
    data = request.get_json(silent=True) or {}
    try:
        items = price_cart(data.get("items"))
    except ValueError as exc:
        return error(str(exc))

    order_type = data.get("orderType", "delivery")
    if order_type not in ORDER_TYPES:
        return error("Choose delivery, takeaway or dine in.")
    address = (data.get("address") or "").strip()
    if order_type == "delivery" and len(address) < 5:
        return error("Enter your delivery address.")
    phone = normalize_phone(data.get("phone")) or g.user["phone"]
    name = (data.get("name") or g.user["name"]).strip()

    subtotal = sum(i["lineTotal"] for i in items)
    fee = SETTINGS["deliveryFee"] if order_type == "delivery" else 0
    created = now()
    eta = created + timedelta(minutes=SETTINGS["deliveryMinutes"])

    conn = db()
    cur = conn.execute(
        """INSERT INTO orders (user_id, items, subtotal, delivery_fee, total, order_type, address,
               phone, name, notes, payment, status, created_at, eta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (g.user["id"], json.dumps(items), subtotal, fee, subtotal + fee, order_type, address,
         phone, name, (data.get("notes") or "").strip()[:300], "Cash on delivery", "placed",
         iso(created), iso(eta)),
    )
    if order_type == "delivery" and address:
        conn.execute("UPDATE users SET address = ? WHERE id = ?", (address, g.user["id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"order": order_json(row)}), 201


@app.get("/api/reviews")
def reviews():
    rows = db().execute("SELECT * FROM reviews ORDER BY id DESC LIMIT 60").fetchall()
    return jsonify({"reviews": [
        {"id": r["id"], "name": r["name"], "rating": r["rating"], "text": r["text"], "createdAt": r["created_at"]}
        for r in rows
    ]})


@app.post("/api/reviews")
def add_review():
    data = request.get_json(silent=True) or {}
    user = current_user()
    name = (data.get("name") or (user["name"] if user else "")).strip()[:40]
    text = (data.get("text") or "").strip()[:500]
    try:
        rating = int(data.get("rating"))
    except (TypeError, ValueError):
        rating = 0
    if not name or len(text) < 3 or not 1 <= rating <= 5:
        return error("Add your name, a star rating and a few words.")
    conn = db()
    cur = conn.execute(
        "INSERT INTO reviews (user_id, name, rating, text, created_at) VALUES (?, ?, ?, ?, ?)",
        (user["id"] if user else None, name, rating, text, iso(now())),
    )
    conn.commit()
    return jsonify({"review": {"id": cur.lastrowid, "name": name, "rating": rating, "text": text,
                               "createdAt": iso(now())}}), 201


# ---------------------------------------------------------------- admin api

@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    rows = db().execute("SELECT * FROM orders ORDER BY id DESC LIMIT 200").fetchall()
    return jsonify({"orders": [order_json(r) for r in rows]})


@app.patch("/api/admin/orders/<int:order_id>")
@admin_required
def admin_update(order_id):
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in STATUSES:
        return error("Unknown status.")
    conn = db()
    if conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id)).rowcount == 0:
        abort(404)
    conn.commit()
    return jsonify({"ok": True})


@app.delete("/api/admin/reviews/<int:review_id>")
@admin_required
def admin_delete_review(review_id):
    conn = db()
    conn.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
    conn.commit()
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
