"""Safepay (Pakistan) hosted checkout, mirroring the official SDK
(github.com/getsafepay/safepay-node):

1. POST {api}/order/v1/init  -> returns a tracker token
2. Redirect the customer to {checkout}/pay?beacon=<token>&...
3. Safepay sends the customer back to redirect_url with `tracker` and `sig`;
   sig must equal HMAC-SHA256(secret_key, tracker).

Without Safepay keys the site runs in TEST mode with a local fake payment page.
"""

import hashlib
import hmac
import json
import urllib.parse
import urllib.request

API = {
    "sandbox": "https://sandbox.api.getsafepay.com",
    "production": "https://api.getsafepay.com",
}
CHECKOUT = {
    "sandbox": "https://sandbox.api.getsafepay.com/checkout/pay",
    "production": "https://getsafepay.com/checkout/pay",
}


class PaymentError(Exception):
    pass


class Safepay:
    def __init__(self, env, api_key, secret_key):
        if env not in API:
            raise ValueError("SAFEPAY_ENV must be 'sandbox' or 'production'")
        self.env, self.api_key, self.secret_key = env, api_key, secret_key

    def create_tracker(self, amount, currency):
        body = json.dumps({
            "amount": amount,
            "client": self.api_key,
            "currency": currency,
            "environment": self.env,
        }).encode()
        req = urllib.request.Request(API[self.env] + "/order/v1/init", data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.load(res)
            return data["data"]["token"]
        except Exception as exc:  # network errors, bad keys, unexpected payload
            raise PaymentError(f"Safepay init failed: {exc}") from exc

    def checkout_url(self, token, order_id, redirect_url, cancel_url):
        return CHECKOUT[self.env] + "?" + urllib.parse.urlencode({
            "beacon": token,
            "cancel_url": cancel_url,
            "env": self.env,
            "order_id": order_id,
            "redirect_url": redirect_url,
            "source": "custom",
            "webhooks": "false",
        })

    def verify(self, tracker, sig):
        expected = hmac.new(self.secret_key.encode(), tracker.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig or "")
