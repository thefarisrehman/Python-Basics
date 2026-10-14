# Nescafe Web Cafe

A clean, animated online menu and ordering website for a coffee shop.
It uses a white background with black and brown accents.

- **Front end**: responsive single page (`static/`) with animated drink illustrations, a menu with filters, product details (ingredients, sizes, price), a cart and checkout.
- **Back end**: `server.py`, written in Python with only the standard library, so there's nothing to install. It serves the site, provides the menu, validates orders, recalculates prices on the server and saves orders to `data/orders.json`.

## Run it

```bash
cd nescafe-cafe
python3 server.py                     # open http://localhost:8000
```

To see incoming orders, start the server with an admin key and open `/admin.html`:

```bash
ADMIN_KEY=choose-a-secret python3 server.py
```

## Edit the menu

Everything lives in `data/products.json`:

| Field | Meaning |
|---|---|
| `currency` | Symbol shown before prices (e.g. `"$"`, `"Rs "`, `"£"`) |
| `deliveryFee`, `freeDeliveryOver` | Delivery charge and the free-delivery threshold |
| `sizes` | Small / Medium / Large and the extra cost of each |
| `products[]` | `name`, `price` (small size), `category` (`hot`/`iced`/`special`), `description`, `ingredients`, optional `badge`, and `visual` (how the drink is drawn) |

## Product pictures

Each drink is drawn as a vector illustration (`static/js/cups.js`), so it stays sharp on any screen.
The illustrations sit on a white background, with steam rising from hot drinks and ice gently moving in iced drinks.
To use real product photos instead, put them in `static/img/` and change the `drinkSVG(...)` calls in `static/js/app.js` to `<img src="img/<id>.jpg">`.

## Before going live

- Replace the address, phone number and opening hours in `static/index.html`.
- Use a name and logo you own or are licensed to use. "Nescafé" is a registered Nestlé trademark.
- Put the server behind HTTPS (for example nginx or Caddy) when you host it publicly.
