# Dollars Food website

Online ordering site for Dollars Food, St 5, Lane 10, Hostel City, Islamabad (0340-1219888).

## What's in it
- Full menu taken from the posters: solo deals, family deals 1–6, pizza in three sizes, chicken deals
- Add to cart, quantities, checkout (delivery, takeaway or dine in), cash on delivery
- Customer accounts by mobile number + password. Each customer sees only their own order history, with a "reorder" button
- Free delivery in a fixed 30 minutes, with a live countdown on each order. Cash on delivery only
- Opening hours 12pm – 4am (Pakistan time). The site shows Open now / Closed, and the server refuses orders outside these hours
- Customer reviews with star ratings
- WhatsApp button everywhere, plus "Send order on WhatsApp" after checkout so the kitchen gets the order on the phone too
- Kitchen screen at `/admin` to see incoming orders and update their status (Preparing, On the way, Delivered)

## Run it
```bash
cd dollarsfood
pip install -r requirements.txt
DOLLARS_SECRET="some-long-random-text" DOLLARS_ADMIN_KEY="your-kitchen-password" python app.py
```
Open http://localhost:5000 for the shop and http://localhost:5000/admin for the kitchen screen.

## Change prices or items
Edit `static/menu.json`. The server re-prices every order from this file, so the browser can't change prices.
`deliveryFee` (currently 0 = free), `deliveryMinutes` (30) and `hours` (open 12, close 4) are in the `settings` block.

## Files
- `app.py`: Flask backend (accounts, orders, reviews, admin) with SQLite (`dollarsfood.db`)
- `static/index.html`, `static/styles.css`, `static/app.js`: the website
- `static/admin.html`: kitchen screen
- `static/img/`: food photos cropped from the Dollars Food posters, plus the logo

If the page is opened without the backend (a static preview), it keeps working and saves accounts and orders in that browser only.
