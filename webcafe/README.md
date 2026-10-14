# WebCafe · Peshawar Cantt

An animated online menu and ordering website for WebCafe: coffee, sandwiches and cakes.
Customers order and pay online by card (no cash on delivery). The owner gets each paid order on WhatsApp and by email, and the customer gets an email receipt.

- **Front end** (`static/`): white, black and brown theme, WebCafe logo with a coffee-bean watermark, animated product illustrations, a menu with filters (Hot, Iced, Specials, Sandwiches, Cakes), product details, cart, checkout and a WhatsApp chat button.
- **Back end** (`server.py`, `payments.py`, `notify.py`): Python standard library only, so there's nothing to install.

## Run it

```bash
cd webcafe
cp .env.example .env     # then fill in your keys
python3 server.py        # open http://localhost:8000
```

Without Safepay keys the site runs in **test mode**: a banner says so, and payments are simulated, so you can try the full flow safely.

## How an order works

1. The customer fills in their name, phone, email and pickup or delivery, then clicks **Pay securely**.
2. The server works out the price itself and saves the order as `pending_payment`.
3. The customer is sent to **Safepay's** secure card page. Card details never touch your server.
4. Safepay sends the customer back. The server checks Safepay's signature, marks the order **paid**, and then sends:
   - a WhatsApp message to the owner (CallMeBot)
   - an email to the owner
   - an email receipt to the customer
5. The customer sees the confirmation with their order number.

Only paid orders trigger notifications. Unpaid or cancelled orders still show on `/admin.html`, labelled with their status.

## Setup checklist (`.env`)

| What | How |
|---|---|
| **Safepay** (card payments, Pakistan) | Create a merchant account at getsafepay.com. Put the API key and secret key in `SAFEPAY_API_KEY` / `SAFEPAY_SECRET_KEY`. Test with `SAFEPAY_ENV=sandbox`, then switch to `production`. |
| **PUBLIC_URL** | Your live website address, used for Safepay's return links. |
| **WhatsApp alerts** | Follow CallMeBot's setup (message their bot once from 0336 9241221) and put the key in `CALLMEBOT_APIKEY`. |
| **Email** | Any SMTP account. For Gmail: `smtp.gmail.com`, port 587, and an App Password. Set `ORDER_EMAIL_TO` to your inbox. |
| **Admin** | Set `ADMIN_KEY`, then open `/admin.html` to see orders. |

## Edit the menu

Everything is in `data/products.json`:

- `price` is the Small/regular price in US dollars.
- Drinks have `"sized": true`. Medium and Large add the `sizes[].add` amount.
- Food has `"sized": false`.
- `category` is one of `hot`, `iced`, `special`, `sandwich` or `cake`.
- `visual` controls the illustration: `cup`, `espresso`, `glass`, `club`, `panini`, `slice` or `lava`.

## Before going live

- Host the site behind HTTPS (for example nginx or Caddy) and set `PUBLIC_URL`.
- Do one sandbox payment end to end before switching Safepay to `production`.
