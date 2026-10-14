(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const CART_KEY = "webcafe-cart";
  const WHATSAPP = "923369241221";
  const CATEGORY = { hot: "Hot coffee", iced: "Iced", special: "Specials", sandwich: "Sandwiches", cake: "Cakes" };

  let menu = null;
  let byId = {};
  let cart = loadCart();
  let current = { product: null, size: "M", qty: 1 };

  const money = (n) => `${menu.currency}${n.toFixed(2)}`;
  const unitPrice = (p, size) => Math.round((p.price + (size ? menu.sizes[size].add : 0)) * 100) / 100;
  const defaultSize = (p) => (p.sized ? "M" : null);
  const sizeLabel = (size) => (size ? menu.sizes[size].label : "");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Product picture: your own photo when products.json has "image", else the drawn illustration. */
  function art(p) {
    if (p.image) return `<img class="drink photo" src="${esc(p.image)}" alt="${esc(p.name)}" data-id="${esc(p.id)}" loading="lazy">`;
    return drinkSVG(p.visual, { label: p.name });
  }

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* storage unavailable */ }
  }

  /* ---------- Boot ---------- */
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error();
      menu = await res.json();
    } catch {
      $("#productGrid").innerHTML = `<p class="muted">Menu could not be loaded. Please make sure the server is running (python3 server.py).</p>`;
      return;
    }
    byId = Object.fromEntries(menu.products.map((p) => [p.id, p]));
    cart = cart.filter((i) => byId[i.id] && (!byId[i.id].sized || menu.sizes[i.size]));
    cart.forEach((i) => { if (!byId[i.id].sized) i.size = null; });
    if (menu.testMode) document.body.insertAdjacentHTML("afterbegin", `<div class="test-banner">Test mode: payments are simulated until Safepay keys are added.</div>`);

    const hero = byId.cappuccino || menu.products[0];
    $("#heroCup").innerHTML = art(hero);
    $("#heroPrice").textContent = money(hero.price);
    $(".hero-badge span").textContent = hero.name;
    $$(".free-over").forEach((el) => (el.textContent = money(menu.freeDeliveryOver)));

    renderGrid("all");
    renderCart();
    bindEvents();
    observeReveal();
    handlePaymentReturn();
  }

  /* ---------- Menu grid ---------- */
  function renderGrid(filter) {
    const list = menu.products.filter((p) => filter === "all" || p.category === filter);
    $("#productGrid").innerHTML = list.map((p, i) => `
      <article class="card" style="animation-delay:${i * 60}ms">
        <button class="card-art" data-open="${p.id}" aria-label="View ${esc(p.name)}">
          ${p.badge ? `<span class="badge ${p.badge === "New" ? "alt" : ""}">${esc(p.badge)}</span>` : ""}
          ${art(p)}
        </button>
        <div class="card-body">
          <div class="card-top"><h3>${esc(p.name)}</h3><span class="price">${money(p.price)}</span></div>
          <p>${esc(p.description)}</p>
          <div class="tags">${p.ingredients.slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join("")}${p.ingredients.length > 3 ? `<span>+${p.ingredients.length - 3}</span>` : ""}</div>
          <div class="card-actions">
            <button class="btn btn-ghost" data-open="${p.id}">Details</button>
            <button class="btn btn-dark" data-quick="${p.id}">Add to order</button>
          </div>
        </div>
      </article>`).join("");
  }

  /* ---------- Product modal ---------- */
  function openProduct(id) {
    const p = byId[id];
    current = { product: p, size: defaultSize(p), qty: 1 };
    $("#pmArt").innerHTML = art(p);
    $("#pmCat").textContent = `${CATEGORY[p.category]} · ${p.kcal} kcal`;
    $("#pmName").textContent = p.name;
    $("#pmDesc").textContent = p.description;
    $("#pmIng").innerHTML = p.ingredients.map((x) => `<li>${esc(x)}</li>`).join("");
    $("#pmSizeHead").hidden = $("#pmSizes").hidden = !p.sized;
    $("#pmSizes").innerHTML = !p.sized ? "" : Object.entries(menu.sizes).map(([k, s]) =>
      `<button type="button" class="size" data-size="${k}"><strong>${s.label}</strong><span>${s.ml} ml · ${money(unitPrice(p, k))}</span></button>`).join("");
    updateModal();
    show("#productOverlay");
  }
  function updateModal() {
    $$("#pmSizes .size").forEach((b) => b.classList.toggle("active", b.dataset.size === current.size));
    $("#pmQty").textContent = current.qty;
    $("#pmTotal").textContent = money(unitPrice(current.product, current.size) * current.qty);
  }

  /* ---------- Cart ---------- */
  function addToCart(id, size, qty) {
    const line = cart.find((i) => i.id === id && i.size === size);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else cart.push({ id, size, qty });
    saveCart();
    renderCart();
    const c = $("#cartCount");
    c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    toast(`${byId[id].name}${size ? ` (${sizeLabel(size)})` : ""} added to your order`);
  }

  function totals(mode) {
    const subtotal = cart.reduce((s, i) => s + unitPrice(byId[i.id], i.size) * i.qty, 0);
    const delivery = mode === "delivery" && subtotal < menu.freeDeliveryOver ? menu.deliveryFee : 0;
    return { subtotal, delivery, total: subtotal + delivery };
  }

  function renderCart() {
    $("#cartCount").textContent = cart.reduce((s, i) => s + i.qty, 0);
    if (!cart.length) {
      $("#cartItems").innerHTML = `<div class="empty">${drinkSVG(byId.espresso ? byId.espresso.visual : menu.products[0].visual)}<p>Your order is empty.<br>Pick something delicious from the menu.</p></div>`;
      $("#cartSummary").innerHTML = `<a href="#menu" class="btn btn-dark block" data-close-cart>Browse menu</a>`;
      return;
    }
    $("#cartItems").innerHTML = cart.map((i, idx) => {
      const p = byId[i.id];
      return `<div class="cart-item">
        <div class="thumb">${art(p)}</div>
        <div><h4>${esc(p.name)}</h4><small>${i.size ? sizeLabel(i.size) + " · " : ""}${money(unitPrice(p, i.size))}</small>
          <div class="qty sm" style="margin-top:6px;width:max-content">
            <button data-dec="${idx}" aria-label="Decrease">−</button><span>${i.qty}</span><button data-inc="${idx}" aria-label="Increase">+</button>
          </div></div>
        <div class="right"><strong>${money(unitPrice(p, i.size) * i.qty)}</strong><button class="remove" data-rm="${idx}">Remove</button></div>
      </div>`;
    }).join("");
    const t = totals("pickup");
    const left = menu.freeDeliveryOver - t.subtotal;
    $("#cartSummary").innerHTML = `
      <div class="row total"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      <p class="note">${left > 0 ? `Add ${money(left)} more for free delivery.` : "You've unlocked free delivery!"}</p>
      <button class="btn btn-dark block" id="toCheckout">Checkout</button>`;
  }

  function renderCheckoutTotals() {
    const mode = $("#stepCheckout").elements.mode.value;
    const t = totals(mode);
    $("#checkoutTotals").innerHTML = `
      <div class="row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      ${mode === "delivery" ? `<div class="row"><span>Delivery</span><span>${t.delivery ? money(t.delivery) : "Free"}</span></div>` : ""}
      <div class="row total"><span>Total</span><span>${money(t.total)}</span></div>`;
  }

  function step(name) {
    ["Cart", "Checkout", "Success"].forEach((s) => ($("#step" + s).hidden = s !== name));
    $("#cartTitle").textContent = name === "Checkout" ? "Checkout" : name === "Success" ? "Thank you" : "Your order";
    if (name === "Checkout") renderCheckoutTotals();
  }

  async function placeOrder(e) {
    e.preventDefault();
    const f = e.target;
    const err = $("#formError");
    const data = {
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      email: f.elements.email.value.trim(),
      mode: f.elements.mode.value,
      address: f.elements.address.value.trim(),
      notes: f.elements.notes.value.trim(),
    };
    if (data.name.length < 2) return (err.textContent = "Please enter your name.");
    if (!/^[0-9+()\-\s]{7,20}$/.test(data.phone)) return (err.textContent = "Please enter a valid phone number.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return (err.textContent = "Please enter a valid email for your receipt.");
    if (data.mode === "delivery" && data.address.length < 6) return (err.textContent = "Please enter a delivery address.");
    err.textContent = "";

    const btn = $("#placeOrder");
    btn.disabled = true; btn.textContent = "Redirecting to secure payment…";
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: data, items: cart }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "Something went wrong.");
      location.href = out.paymentUrl;
    } catch (ex) {
      err.textContent = ex.message || "Could not reach the cafe. Please try again.";
      btn.disabled = false; btn.textContent = "Pay securely";
    }
  }

  /* ---------- Back from the payment page ---------- */
  async function handlePaymentReturn() {
    const q = new URLSearchParams(location.search);
    if (![...q.keys()].some((k) => ["paid", "cancelled", "payfail"].includes(k))) return;
    history.replaceState(null, "", location.pathname);
    if (q.has("cancelled")) return toast("Payment cancelled. Your order is still in the cart.");
    if (q.has("payfail")) return toast("We couldn't confirm your payment. Please contact us on WhatsApp.");
    try {
      const res = await fetch("/api/orders/" + encodeURIComponent(q.get("paid")));
      const o = await res.json();
      if (!res.ok || o.status !== "paid") throw new Error();
      cart = []; saveCart(); renderCart();
      $("#successId").textContent = o.orderId;
      $("#successText").textContent = `Thanks ${o.name}! We received ${money(o.total)} and a receipt is on its way to your email. ` +
        (o.mode === "delivery" ? `We'll deliver in about ${o.etaMinutes} minutes.` : `It'll be ready for pickup in about ${o.etaMinutes} minutes.`);
      $("#waConfirm").href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi WebCafe! I just paid for order ${o.orderId}.`)}`;
      step("Success");
      show("#cartOverlay");
    } catch {
      toast("We couldn't confirm your payment yet. Please contact us on WhatsApp.");
    }
  }

  /* ---------- UI helpers ---------- */
  let lastFocus = null;
  function show(sel) {
    lastFocus = document.activeElement;
    $(sel).hidden = false;
    document.body.classList.add("locked");
    const c = $(sel + " .close"); if (c) c.focus();
  }
  function hide(el) {
    el.hidden = true;
    if (!$$(".overlay").some((o) => !o.hidden)) document.body.classList.remove("locked");
    if (lastFocus) lastFocus.focus();
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }
  function observeReveal() {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    $$(".reveal").forEach((el) => io.observe(el));
  }

  function bindEvents() {
    // If a photo file is missing or broken, fall back to the drawn illustration.
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (img.matches && img.matches("img.photo") && byId[img.dataset.id]) {
        img.outerHTML = drinkSVG(byId[img.dataset.id].visual, { label: byId[img.dataset.id].name });
      }
    }, true);

    window.addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", scrollY > 10), { passive: true });

    $("#filters").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$(".chip").forEach((c) => { c.classList.toggle("active", c === b); c.setAttribute("aria-selected", c === b); });
      renderGrid(b.dataset.filter);
    });

    $("#productGrid").addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      const quick = e.target.closest("[data-quick]");
      if (quick) addToCart(quick.dataset.quick, defaultSize(byId[quick.dataset.quick]), 1);
      else if (open) openProduct(open.dataset.open);
    });

    $("#pmSizes").addEventListener("click", (e) => {
      const b = e.target.closest(".size"); if (!b) return;
      current.size = b.dataset.size; updateModal();
    });
    $("#pmMinus").onclick = () => { current.qty = Math.max(1, current.qty - 1); updateModal(); };
    $("#pmPlus").onclick = () => { current.qty = Math.min(20, current.qty + 1); updateModal(); };
    $("#pmAdd").onclick = () => { addToCart(current.product.id, current.size, current.qty); hide($("#productOverlay")); };

    $("#cartBtn").onclick = () => { step("Cart"); show("#cartOverlay"); };
    $("#cartOverlay").addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest("[data-close-cart]")) return hide($("#cartOverlay"));
      if (t.id === "toCheckout") return step("Checkout");
      const idx = +(t.dataset.inc ?? t.dataset.dec ?? t.dataset.rm ?? -1);
      if (idx < 0) return;
      if (t.dataset.inc !== undefined) cart[idx].qty = Math.min(20, cart[idx].qty + 1);
      if (t.dataset.dec !== undefined) cart[idx].qty -= 1;
      if (t.dataset.rm !== undefined || cart[idx].qty < 1) cart.splice(idx, 1);
      saveCart(); renderCart();
    });
    $("#backToCart").onclick = () => step("Cart");
    $("#newOrder").onclick = () => { hide($("#cartOverlay")); location.hash = "#menu"; };
    $("#stepCheckout").addEventListener("change", (e) => {
      if (e.target.name === "mode") {
        $("#addressField").hidden = e.target.value !== "delivery";
        renderCheckoutTotals();
      }
    });
    $("#stepCheckout").addEventListener("submit", placeOrder);

    $$(".overlay").forEach((o) => o.addEventListener("click", (e) => {
      if (e.target === o || e.target.closest("[data-close]")) hide(o);
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $$(".overlay").filter((o) => !o.hidden).forEach(hide);
    });
  }

  init();
})();
