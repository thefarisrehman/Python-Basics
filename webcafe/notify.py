"""Order notifications: WhatsApp (CallMeBot) to the owner, and email to the
owner and the customer. Each channel is skipped when it isn't configured."""

import smtplib
import ssl
import threading
import urllib.parse
import urllib.request
from email.message import EmailMessage


def order_text(order):
    c = order["customer"]
    cur = order["currency"]
    lines = [f"New PAID order {order['orderId']} - {cur}{order['total']:.2f}",
             f"{c['name']} | {c['phone']} | {c['mode'].upper()}"]
    if c["address"]:
        lines.append(f"Address: {c['address']}")
    lines += [f"- {i['qty']} x {i['name']}{' (' + i['sizeLabel'] + ')' if i['sizeLabel'] else ''}"
              f" = {cur}{i['lineTotal']:.2f}" for i in order["items"]]
    if order["deliveryFee"]:
        lines.append(f"Delivery: {cur}{order['deliveryFee']:.2f}")
    if c["notes"]:
        lines.append(f"Notes: {c['notes']}")
    return "\n".join(lines)


def send_whatsapp(cfg, text):
    phone, key = cfg.get("CALLMEBOT_PHONE"), cfg.get("CALLMEBOT_APIKEY")
    if not (phone and key):
        return
    url = "https://api.callmebot.com/whatsapp.php?" + urllib.parse.urlencode(
        {"phone": phone, "text": text, "apikey": key})
    with urllib.request.urlopen(url, timeout=20) as res:
        res.read()


def send_email(cfg, to, subject, body):
    host = cfg.get("SMTP_HOST")
    if not (host and to):
        return
    msg = EmailMessage()
    msg["From"] = cfg.get("SMTP_FROM") or cfg.get("SMTP_USER")
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    port = int(cfg.get("SMTP_PORT") or 587)
    ctx = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
        server.starttls(context=ctx)
    with server:
        if cfg.get("SMTP_USER"):
            server.login(cfg["SMTP_USER"], cfg.get("SMTP_PASSWORD", ""))
        server.send_message(msg)


def notify_paid_order(cfg, order):
    """Fire-and-forget so the customer's redirect isn't delayed."""
    def run():
        text = order_text(order)
        jobs = [
            ("WhatsApp", lambda: send_whatsapp(cfg, text)),
            ("owner email", lambda: send_email(cfg, cfg.get("ORDER_EMAIL_TO"),
                                               f"New order {order['orderId']}", text)),
            ("customer email", lambda: send_email(
                cfg, order["customer"]["email"], f"Your WebCafe order {order['orderId']}",
                f"Hi {order['customer']['name']},\n\nThank you! Your payment was received "
                f"and we're preparing your order.\n\n{text.split(chr(10), 1)[1]}\n\n"
                f"Total paid: {order['currency']}{order['total']:.2f}\n"
                f"Estimated time: {order['etaMinutes']} minutes\n\nWebCafe, Peshawar Cantt\n"
                f"WhatsApp: +92 336 9241221")),
        ]
        for name, job in jobs:
            try:
                job()
            except Exception as exc:
                print(f"[notify] {name} failed for {order['orderId']}: {exc}")
    threading.Thread(target=run, daemon=True).start()
