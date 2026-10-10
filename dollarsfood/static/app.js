/* Dollars Food storefront.
   Talks to the Flask API when it is running (server mode). When the page is
   opened without the backend (a static preview), the same features run on
   this browser's storage instead (local mode). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => 'Rs ' + Number(n).toLocaleString('en-US');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  let MENU = null;
  let S = null; // settings
  const ITEMS = {};
  let cart = store.get('df_cart', []); // [{ id, size, qty }]
  let session = store.get('df_session', null); // { token, user }
  const chosenSize = {};
  let activeTab = 'all';
  let afterAuth = null;
  let orderType = 'delivery';
  let lastOrder = null;

  // ------------------------------------------------------------------ opening hours (Pakistan time)

  function isOpen(at = new Date()) {
    const h = S.hours;
    const hour = (at.getUTCHours() + h.utcOffset + 24) % 24;
    return h.open < h.close ? hour >= h.open && hour < h.close : hour >= h.open || hour < h.close;
  }
  const closedMsg = () => `We're closed right now. We take orders ${S.hours.label}.`;

  function renderOpen() {
    const open = isOpen();
    const pill = $('#openPill');
    pill.dataset.open = String(open);
    pill.querySelector('span').textContent = open ? 'Open now' : 'Closed · opens 12pm';
    const eta = $('#cartEta');
    eta.classList.toggle('closed', !open);
    eta.querySelector('span').textContent = open ? `Free delivery in ${S.deliveryMinutes} minutes` : closedMsg();
    const btn = $('#checkoutBtn');
    btn.disabled = !open;
    btn.textContent = open ? 'Checkout' : 'Closed · opens at 12pm';
  }

  // ------------------------------------------------------------------ pricing

  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2);
    return /^03\d{9}$/.test(d) ? d : null;
  }
  const prettyPhone = (p) => (p && p.length === 11 ? p.slice(0, 4) + '-' + p.slice(4) : p);

  function priceLine(line) {
    const item = ITEMS[line.id];
    if (!item) return null;
    let name = item.name, price = item.price;
    if (item.sizes) {
      const size = item.sizes.find((s) => s.id === line.size);
      if (!size) return null;
      name = `${item.name} (${size.name})`;
      price = size.price;
    }
    return { id: item.id, name, size: line.size || null, price, qty: line.qty, lineTotal: price * line.qty, image: item.image };
  }
  const pricedCart = () => cart.map(priceLine).filter(Boolean);
  const cartSubtotal = () => pricedCart().reduce((s, l) => s + l.lineTotal, 0);
  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);

  // ------------------------------------------------------------------ local backend (preview mode)

  async function hash(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('df:' + text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { return 'p:' + btoa(unescape(encodeURIComponent(text))); }
  }
  const fail = (msg) => { throw new Error(msg); };
  const local = {
    users: () => store.get('df_users', {}),
    userFromToken() {
      const phone = session?.token?.startsWith('local:') ? session.token.slice(6) : null;
      return phone ? this.users()[phone] : null;
    },
    pub: (u) => ({ id: u.id, name: u.name, phone: u.phone, address: u.address || '' }),
    async register(d) {
      const name = (d.name || '').trim(), phone = normalizePhone(d.phone);
      if (name.length < 2) fail('Enter your name.');
      if (!phone) fail('Enter a valid mobile number, like 0340-1219888.');
      if ((d.password || '').length < 4) fail('Password must be at least 4 characters.');
      const users = this.users();
      if (users[phone]) fail('This number already has an account. Sign in instead.');
      users[phone] = { id: Date.now(), name, phone, address: '', hash: await hash(d.password) };
      store.set('df_users', users);
      return { token: 'local:' + phone, user: this.pub(users[phone]) };
    },
    async login(d) {
      const phone = normalizePhone(d.phone);
      const u = phone && this.users()[phone];
      if (!u || u.hash !== (await hash(d.password || ''))) fail('Mobile number or password is incorrect.');
      return { token: 'local:' + phone, user: this.pub(u) };
    },
    async orders() {
      const u = this.userFromToken();
      if (!u) fail('Please sign in to continue.');
      return { orders: (store.get('df_orders', {})[u.phone] || []).slice().reverse() };
    },
    async placeOrder(d) {
      if (!isOpen()) fail(closedMsg());
      const u = this.userFromToken();
      if (!u) fail('Please sign in to continue.');
      const items = d.items.map(priceLine).filter(Boolean);
      if (!items.length) fail('Your cart is empty.');
      if (d.orderType === 'delivery' && (d.address || '').trim().length < 5) fail('Enter your delivery address.');
      const all = store.get('df_orders', {});
      const list = all[u.phone] || [];
      const seq = store.get('df_seq', 0) + 1;
      store.set('df_seq', seq);
      const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
      const fee = d.orderType === 'delivery' ? S.deliveryFee : 0;
      const created = new Date();
      const order = {
        id: seq, items, subtotal, deliveryFee: fee, total: subtotal + fee, orderType: d.orderType,
        address: (d.address || '').trim(), phone: normalizePhone(d.phone) || u.phone, name: (d.name || u.name).trim(),
        notes: (d.notes || '').trim(), payment: 'Cash on delivery', status: 'placed',
        createdAt: created.toISOString(), eta: new Date(created.getTime() + S.deliveryMinutes * 60000).toISOString(),
      };
      list.push(order);
      all[u.phone] = list;
      store.set('df_orders', all);
      if (d.orderType === 'delivery') {
        const users = this.users(); users[u.phone].address = order.address; store.set('df_users', users);
      }
      return { order };
    },
    async reviews() { return { reviews: store.get('df_reviews', []) }; },
    async addReview(d) {
      const name = (d.name || '').trim().slice(0, 40), text = (d.text || '').trim().slice(0, 500), rating = +d.rating;
      if (!name || text.length < 3 || !(rating >= 1 && rating <= 5)) fail('Add your name, a star rating and a few words.');
      const list = store.get('df_reviews', []);
      const review = { id: Date.now(), name, rating, text, createdAt: new Date().toISOString() };
      list.unshift(review);
      store.set('df_reviews', list);
      return { review };
    },
  };

  // ------------------------------------------------------------------ api facade

  const api = {
    mode: 'local',
    async init() {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        if (r.ok && (await r.json()).mode === 'server') this.mode = 'server';
      } catch { /* static preview */ }
    },
    async req(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (session?.token) headers.Authorization = 'Bearer ' + session.token;
      const r = await fetch('api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = {};
      try { j = await r.json(); } catch { /* empty body */ }
      if (!r.ok) {
        if (r.status === 401 && path !== 'login') setSession(null);
        throw new Error(j.error || 'Something went wrong. Please try again.');
      }
      return j;
    },
    register(d) { return this.mode === 'server' ? this.req('POST', 'register', d) : local.register(d); },
    login(d) { return this.mode === 'server' ? this.req('POST', 'login', d) : local.login(d); },
    orders() { return this.mode === 'server' ? this.req('GET', 'orders') : local.orders(); },
    placeOrder(d) { return this.mode === 'server' ? this.req('POST', 'orders', d) : local.placeOrder(d); },
    reviews() { return this.mode === 'server' ? this.req('GET', 'reviews') : local.reviews(); },
    addReview(d) { return this.mode === 'server' ? this.req('POST', 'reviews', d) : local.addReview(d); },
  };

  // ------------------------------------------------------------------ ui helpers

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function openPanel(el) {
    $$('.drawer.open, .modal.open').forEach((p) => { if (p !== el) closePanel(p, true); });
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    $('#scrim').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => (el.querySelector('input:not([type=hidden]), .x') || el).focus({ preventScroll: true }), 60);
  }
  function closePanel(el, keepScrim) {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (!keepScrim && !$('.drawer.open, .modal.open')) {
      $('#scrim').classList.remove('open');
      document.body.style.overflow = '';
    }
  }
  const closeAll = () => $$('.drawer.open, .modal.open').forEach((p) => closePanel(p));

  function setSession(s) {
    session = s;
    if (s) store.set('df_session', s); else store.del('df_session');
    $('#accountLabel').textContent = s ? s.user.name.split(' ')[0] : 'Sign in';
  }

  function waLink(text) {
    return `https://wa.me/${S.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  }

  // ------------------------------------------------------------------ menu rendering

  function cardHTML(item, i) {
    const size = item.sizes ? (chosenSize[item.id] ||= item.sizes[0].id) : null;
    const price = item.sizes ? item.sizes.find((s) => s.id === size).price : item.price;
    return `
      <article class="card" data-card="${item.id}" style="animation:fade .5s ${Math.min(i, 8) * 0.05}s both">
        ${item.tag ? `<span class="tag ${item.category === 'pizza' ? 'y' : ''}">${esc(item.tag)}</span>` : ''}
        <span class="in-cart" data-incart="${item.id}" hidden></span>
        <div class="card-media"><img src="${item.image}" alt="${esc(item.name)}" loading="lazy"></div>
        <div class="card-body">
          <h4>${esc(item.name)}</h4>
          ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
          ${item.includes ? `<ul class="includes">${item.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${item.sizes ? `<div class="sizes" role="group" aria-label="Size">${item.sizes.map((s) => `
            <button type="button" data-size="${item.id}:${s.id}" aria-pressed="${s.id === size}">${s.name}<small>${fmt(s.price)}</small></button>`).join('')}</div>` : ''}
          <div class="card-foot">
            <span class="price" data-price="${item.id}"><small>Rs</small>${price.toLocaleString('en-US')}</span>
            <button class="add-btn" type="button" data-add="${item.id}"><svg class="icon"><use href="#i-plus"/></svg>Add</button>
          </div>
        </div>
      </article>`;
  }

  function renderTabs() {
    const counts = {};
    MENU.items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    const tabs = [{ id: 'all', name: 'All', n: MENU.items.length }, ...MENU.categories.map((c) => ({ ...c, n: counts[c.id] || 0 }))];
    $('#tabs').innerHTML = tabs.map((t) => `<button class="tab" role="tab" type="button" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${esc(t.name)}<span class="n">${t.n}</span></button>`).join('');
  }

  function renderMenu() {
    const cats = MENU.categories.filter((c) => activeTab === 'all' || c.id === activeTab);
    let i = 0;
    $('#menu-groups').innerHTML = cats.map((c) => {
      const items = MENU.items.filter((it) => it.category === c.id);
      let body;
      if (c.id === 'chicken') {
        const tiers = [...new Set(items.map((it) => it.tier))];
        body = tiers.map((t) => `<h4 class="hand tier-label">${esc(t)}</h4>
          <div class="grid">${items.filter((it) => it.tier === t).map((it) => cardHTML(it, i++)).join('')}</div>`).join('');
      } else {
        body = `<div class="grid">${items.map((it) => cardHTML(it, i++)).join('')}</div>`;
      }
      return `<div class="menu-group" id="cat-${c.id}">
        <div class="group-head"><h3 class="display">${esc(c.name)}</h3><p class="hand">${esc(c.blurb)}</p></div>${body}</div>`;
    }).join('');
    syncInCart();
  }

  function renderHits() {
    const solo = MENU.items.filter((i) => i.category === 'solo');
    $('#hits-grid').innerHTML = solo.map((it, n) => `
      <article class="hit reveal ${n === 0 ? 'green' : ''}" data-card="${it.id}">
        <img src="${it.image}" alt="${esc(it.name)}">
        ${it.tag ? `<span class="tag ${n === 0 ? '' : 'y'}">${esc(it.tag)}</span>` : ''}
        <div class="hit-body">
          <div>
            <h3 class="display">${esc(it.name)}</h3>
            <ul>${it.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
          <div style="display:grid;gap:.6rem;justify-items:end">
            <span class="price"><small>Rs</small>${it.price}</span>
            <button class="add-btn" type="button" data-add="${it.id}"><svg class="icon"><use href="#i-plus"/></svg>Add to cart</button>
          </div>
        </div>
      </article>`).join('');
  }

  function renderTicker() {
    const words = ['Zinger Burger', 'Chicken Chowmein', 'Fajita Pizza', 'Crispy Wings', 'Tempura Strips', 'Tikka Pizza', 'Mint Margarita', 'Zinger Wrap', '$ Special Pizza', 'Fried Chicken'];
    const row = words.map((w) => `<span>${esc(w)}</span>`).join('');
    $('#ticker').innerHTML = row + row;
  }

  function syncInCart() {
    const byId = {};
    cart.forEach((l) => { byId[l.id] = (byId[l.id] || 0) + l.qty; });
    $$('[data-incart]').forEach((el) => {
      const n = byId[el.dataset.incart];
      el.hidden = !n;
      if (n) el.textContent = `${n} in cart`;
    });
  }

  // ------------------------------------------------------------------ cart

  function saveCart() { store.set('df_cart', cart); renderCart(); syncInCart(); }

  function addToCart(id, size, qty = 1) {
    const line = cart.find((l) => l.id === id && (l.size || null) === (size || null));
    if (line) line.qty = Math.min(50, line.qty + qty); else cart.push({ id, size: size || null, qty });
    saveCart();
  }

  function renderCart() {
    const lines = pricedCart();
    const sub = cartSubtotal();
    const fee = lines.length ? S.deliveryFee : 0;
    $$('[data-cart-count]').forEach((el) => { el.textContent = cartCount(); });
    $$('[data-cart-total]').forEach((el) => { el.textContent = fmt(sub + fee); });
    $('#cartSubtotal').textContent = fmt(sub);
    $('#cartFee').textContent = S.deliveryFee ? fmt(S.deliveryFee) : 'Free';
    $('#cartTotal').textContent = fmt(sub + fee);
    $('#cartFoot').hidden = !lines.length;
    $('#cartBody').innerHTML = lines.length ? lines.map((l, i) => `
      <div class="line-item">
        <img src="${l.image}" alt="">
        <div style="min-width:0">
          <strong>${esc(l.name)}</strong>
          <span class="muted">${fmt(l.price)} each</span><br>
          <div class="qty" role="group" aria-label="Quantity for ${esc(l.name)}">
            <button type="button" data-qty="${i}:-1" aria-label="One less">−</button><span>${l.qty}</span><button type="button" data-qty="${i}:1" aria-label="One more">+</button>
          </div>
        </div>
        <strong class="price" style="font-size:1.3rem">${fmt(l.lineTotal)}</strong>
      </div>`).join('') : `
      <div class="empty"><span class="hand">your cart is hungry</span>Add a deal or two and it'll show up here.<br><br>
      <a class="btn btn-red" href="#menu" data-close>Browse the menu</a></div>`;
  }

  function flyToCart(fromImg) {
    const target = getComputedStyle($('#fabCart')).display !== 'none' ? $('#fabCart') : $('#cartBtn');
    const bump = () => { target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); };
    if (!fromImg || reduceMotion) return bump();
    const a = fromImg.getBoundingClientRect(), b = target.getBoundingClientRect();
    const size = Math.min(110, a.width);
    const f = document.createElement('img');
    f.src = fromImg.src; f.className = 'flyer'; f.alt = '';
    Object.assign(f.style, { width: size + 'px', height: size + 'px', left: a.left + a.width / 2 - size / 2 + 'px', top: a.top + a.height / 2 - size / 2 + 'px' });
    document.body.appendChild(f);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    f.animate([
      { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(.7) rotate(160deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(340deg)`, opacity: 0.4 },
    ], { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => { f.remove(); bump(); };
  }

  // ------------------------------------------------------------------ auth

  let authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    $$('#authSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $$('[data-only="register"]').forEach((el) => { el.hidden = m !== 'register'; });
    $('#authTitle').textContent = m === 'login' ? 'Sign in' : 'Create account';
    $('#authSubmit').textContent = m === 'login' ? 'Sign in' : 'Create account';
    $('#authPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#authError').textContent = '';
  }
  function openAuth(then) {
    afterAuth = then || null;
    const signed = !!session;
    $('#authForm').hidden = signed;
    $('#authSeg').hidden = signed;
    $('#accountView').hidden = !signed;
    if (signed) {
      $('#authTitle').textContent = 'Hi, ' + session.user.name.split(' ')[0];
      $('#accName').textContent = session.user.name;
      $('#accPhone').textContent = prettyPhone(session.user.phone);
    } else {
      setAuthMode(then ? 'register' : 'login');
    }
    openPanel($('#authModal'));
  }

  // ------------------------------------------------------------------ checkout

  function setOrderType(t) {
    orderType = t;
    $$('#typeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
    $('#coAddrWrap').hidden = t !== 'delivery';
    $('#coEta').textContent = t === 'delivery' ? `Arrives in ${S.deliveryMinutes} minutes` : `Ready in ${S.deliveryMinutes} minutes`;
    const fee = t === 'delivery' ? S.deliveryFee : 0;
    $('#coTotal').textContent = fmt(cartSubtotal() + fee);
  }

  function openCheckout() {
    if (!cart.length) return toast('Your cart is empty.');
    if (!isOpen()) return toast(closedMsg());
    if (!session) return openAuth(openCheckout);
    $('#coFormView').hidden = false;
    $('#coDoneView').hidden = true;
    $('#coName').value ||= session.user.name;
    $('#coPhone').value ||= prettyPhone(session.user.phone);
    $('#coAddress').value ||= session.user.address || '';
    $('#coError').textContent = '';
    setOrderType(orderType);
    openPanel($('#checkoutModal'));
  }

  function orderText(o) {
    const type = { delivery: 'Delivery', takeaway: 'Takeaway', dinein: 'Dine in' }[o.orderType];
    return [
      `Assalam o Alaikum Dollars Food! New order #${o.id}`,
      '',
      ...o.items.map((l) => `${l.qty} x ${l.name} = ${fmt(l.lineTotal)}`),
      '',
      `Total: ${fmt(o.total)} (cash)`,
      `Type: ${type}`,
      `Name: ${o.name}`,
      `Phone: ${prettyPhone(o.phone)}`,
      o.orderType === 'delivery' ? `Address: ${o.address}` : null,
      o.notes ? `Notes: ${o.notes}` : null,
    ].filter((x) => x !== null).join('\n');
  }

  function showDone(o) {
    lastOrder = o;
    $('#coFormView').hidden = true;
    $('#coDoneView').hidden = false;
    $('#doneTitle').textContent = `Order #${o.id}`;
    const when = new Date(o.eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#doneText').textContent = o.orderType === 'delivery'
      ? `Your food is on its way to ${o.address}. Expected by ${when}. Pay ${fmt(o.total)} in cash to the rider.`
      : `We'll have it ready by ${when}. Pay ${fmt(o.total)} at the counter.`;
    $('#cdLabel').textContent = o.orderType === 'delivery' ? 'until delivery' : 'until ready';
    $('#doneWa').href = waLink(orderText(o));
    tick();
    burst();
  }

  function burst() {
    if (reduceMotion) return;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.className = 'burst';
      s.textContent = i % 3 ? '$' : '★';
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.color = i % 2 ? 'var(--mustard)' : 'var(--red)';
      document.body.appendChild(s);
      const ang = Math.random() * Math.PI * 2, dist = 140 + Math.random() * 220;
      s.animate([
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist + 120}px)) scale(1.2) rotate(${Math.random() * 360}deg)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  }

  // ------------------------------------------------------------------ orders

  const STATUS_LABEL = { placed: 'Order placed', preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };

  async function openOrders() {
    if (!session) return openAuth(openOrders);
    openPanel($('#ordersDrawer'));
    const body = $('#ordersBody');
    body.innerHTML = '<p class="muted">Loading your orders…</p>';
    try {
      const { orders } = await api.orders();
      body.innerHTML = orders.length ? orders.map((o) => `
        <article class="order">
          <div class="order-top"><strong>Order #${o.id}</strong><span class="status ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></div>
          <span class="muted" style="font-size:.85rem">${new Date(o.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${{ delivery: 'Delivery', takeaway: 'Takeaway', dinein: 'Dine in' }[o.orderType]}</span>
          <ul>${o.items.map((l) => `<li>${l.qty} × ${esc(l.name)}</li>`).join('')}</ul>
          <span class="order-eta" data-eta="${o.eta}" data-status="${o.status}" data-type="${o.orderType}"></span>
          <div class="order-foot">
            <span class="price">${fmt(o.total)}</span>
            <button class="btn btn-yellow" type="button" data-reorder='${esc(JSON.stringify(o.items.map((l) => ({ id: l.id, size: l.size, qty: l.qty }))))}'>Order again</button>
          </div>
        </article>`).join('') : `
        <div class="empty"><span class="hand">no orders yet</span>Your first order will show up here with a live delivery countdown.<br><br>
        <a class="btn btn-red" href="#menu" data-close>Start an order</a></div>`;
      tick();
    } catch (e) {
      body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
    }
  }

  function mmss(sec) {
    sec = Math.max(0, Math.round(sec));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function tick() {
    const now = Date.now();
    $$('[data-eta]').forEach((el) => {
      const left = (new Date(el.dataset.eta) - now) / 1000;
      const st = el.dataset.status;
      if (st === 'delivered' || st === 'cancelled') { el.textContent = ''; return; }
      const verb = el.dataset.type === 'delivery' ? 'Arrives' : 'Ready';
      el.textContent = left > 0 ? `${verb} in ${mmss(left)}` : `${verb} any moment now`;
    });
    if (lastOrder && !$('#coDoneView').hidden) {
      const total = S.deliveryMinutes * 60;
      const left = Math.max(0, (new Date(lastOrder.eta) - now) / 1000);
      $('#cdVal').textContent = mmss(left);
      $('#cdBar').style.strokeDashoffset = String(326.7 * (1 - left / total));
    }
  }

  // ------------------------------------------------------------------ reviews

  const starsHTML = (r) => '★★★★★'.split('').map((s, i) => `<span class="${i < Math.round(r) ? '' : 'off'}">★</span>`).join('');
  let reviewRating = 0;

  function renderStarInput() {
    $('#starInput').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === reviewRating}" aria-label="${n} star${n > 1 ? 's' : ''}" data-star="${n}" class="${n <= reviewRating ? 'on' : ''}">★</button>`).join('');
  }

  async function loadReviews() {
    let list = [];
    try { list = (await api.reviews()).reviews; } catch { /* show empty state */ }
    if (list.length) {
      const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
      $('#ratingAvg').textContent = avg.toFixed(1);
      $('#ratingStars').innerHTML = starsHTML(avg);
      $('#ratingCount').textContent = `${list.length} review${list.length > 1 ? 's' : ''}`;
    } else {
      $('#ratingAvg').textContent = '–';
      $('#ratingStars').innerHTML = starsHTML(0);
      $('#ratingCount').textContent = 'No reviews yet';
    }
    $('#reviewList').innerHTML = list.length ? list.map((r) => `
      <article class="review">
        <div class="stars" aria-label="${r.rating} out of 5">${starsHTML(r.rating)}</div>
        <p>${esc(r.text)}</p>
        <footer><b>${esc(r.name)}</b><span>${new Date(r.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</span></footer>
      </article>`).join('') : `
      <div class="empty" style="grid-column:1/-1"><span class="hand">be the first!</span>Tried our zinger or a pizza deal? Tell the next hungry person what you thought.</div>`;
  }

  // ------------------------------------------------------------------ sesame seed canvas

  function seeds() {
    const c = $('#seeds');
    const ctx = c.getContext('2d');
    let w, h, dpr, parts = [], running = true, raf;
    function size() {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(60, w / 22));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: 2.2 + Math.random() * 2.6,
        a: Math.random() * Math.PI, va: (Math.random() - .5) * .02, vy: .15 + Math.random() * .35, vx: (Math.random() - .5) * .2,
        o: .25 + Math.random() * .45,
      }));
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = `rgba(255, 236, 200, ${p.o})`;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 1.9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (!reduceMotion) {
          p.y -= p.vy; p.x += p.vx; p.a += p.va;
          if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        }
      }
      if (running && !reduceMotion) raf = requestAnimationFrame(draw);
    }
    size(); draw();
    addEventListener('resize', () => { size(); if (reduceMotion) draw(); });
    new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (running && !reduceMotion) raf = requestAnimationFrame(draw);
    }).observe(c);
  }

  // ------------------------------------------------------------------ reveal on scroll

  function reveal() {
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('shown'); e.target.classList.remove('primed'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach((el) => {
      if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('primed'); io.observe(el); }
    });
  }

  // ------------------------------------------------------------------ events

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;

      if (t.dataset.add) {
        const id = t.dataset.add;
        const item = ITEMS[id];
        addToCart(id, item.sizes ? chosenSize[id] : null);
        const card = t.closest('[data-card]');
        flyToCart(card && card.querySelector('img'));
        t.classList.add('done');
        const old = t.innerHTML;
        t.innerHTML = 'Added ✓';
        setTimeout(() => { t.classList.remove('done'); t.innerHTML = old; }, 900);
        const line = item.sizes ? `${item.name} (${item.sizes.find((s) => s.id === chosenSize[id]).name})` : item.name;
        toast(`${line} added to cart`);
        return;
      }
      if (t.dataset.size) {
        const [id, sz] = t.dataset.size.split(':');
        chosenSize[id] = sz;
        $$(`[data-size^="${id}:"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
        const price = ITEMS[id].sizes.find((s) => s.id === sz).price;
        const p = $(`[data-price="${id}"]`);
        p.innerHTML = `<small>Rs</small>${price.toLocaleString('en-US')}`;
        if (!reduceMotion) p.animate([{ transform: 'scale(1.25)', color: 'var(--mustard)' }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-out' });
        return;
      }
      if (t.dataset.tab) {
        activeTab = t.dataset.tab;
        $$('#tabs .tab').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
        renderMenu();
        const top = $('#menu-groups').getBoundingClientRect().top + scrollY - 150;
        if (scrollY > top) scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      if (t.dataset.qty) {
        const [i, d] = t.dataset.qty.split(':').map(Number);
        cart[i].qty += d;
        if (cart[i].qty <= 0) cart.splice(i, 1);
        saveCart();
        return;
      }
      if (t.dataset.reorder) {
        JSON.parse(t.dataset.reorder).forEach((l) => { if (ITEMS[l.id]) addToCart(l.id, l.size, l.qty); });
        openPanel($('#cartDrawer'));
        toast('Added your previous order to the cart');
        return;
      }
      if (t.dataset.star) {
        reviewRating = +t.dataset.star;
        renderStarInput();
        return;
      }
      if (t.dataset.copy) {
        const val = t.dataset.copy;
        navigator.clipboard?.writeText(val).then(() => toast('Number copied'), () => toast(val));
        return;
      }
      if (t.hasAttribute('data-close')) {
        const panel = t.closest('.drawer, .modal');
        if (panel) closePanel(panel); else closeAll();
      }
    });

    $('#scrim').addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

    $('#cartBtn').addEventListener('click', () => openPanel($('#cartDrawer')));
    $('#fabCart').addEventListener('click', () => openPanel($('#cartDrawer')));
    $('#ordersBtn').addEventListener('click', openOrders);
    $('#accountBtn').addEventListener('click', () => openAuth());
    $('#checkoutBtn').addEventListener('click', openCheckout);
    $('#accOrders').addEventListener('click', openOrders);
    $('#doneOrders').addEventListener('click', openOrders);
    $('#logoutBtn').addEventListener('click', () => { setSession(null); closeAll(); toast('Signed out'); });

    $$('#authSeg button').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
    $$('#typeSeg button').forEach((b) => b.addEventListener('click', () => setOrderType(b.dataset.type)));

    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#authSubmit');
      btn.disabled = true;
      $('#authError').textContent = '';
      try {
        const d = { name: $('#authName').value, phone: $('#authPhone').value, password: $('#authPass').value };
        const res = authMode === 'login' ? await api.login(d) : await api.register(d);
        setSession(res);
        $('#authPass').value = '';
        toast(`Welcome, ${res.user.name.split(' ')[0]}!`);
        const next = afterAuth;
        afterAuth = null;
        closePanel($('#authModal'));
        if (next) next();
      } catch (err) {
        $('#authError').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    $('#checkoutForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#coSubmit');
      btn.disabled = true;
      btn.textContent = 'Placing order…';
      $('#coError').textContent = '';
      try {
        const { order } = await api.placeOrder({
          items: cart.map((l) => ({ id: l.id, size: l.size, qty: l.qty })),
          orderType, name: $('#coName').value, phone: $('#coPhone').value,
          address: $('#coAddress').value, notes: $('#coNotes').value,
        });
        if (orderType === 'delivery') session.user.address = order.address;
        setSession(session);
        cart = [];
        saveCart();
        $('#coNotes').value = '';
        showDone(order);
      } catch (err) {
        $('#coError').textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Place order';
      }
    });

    $('#reviewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#reviewError').textContent = '';
      try {
        await api.addReview({ name: $('#reviewName').value, text: $('#reviewText').value, rating: reviewRating });
        $('#reviewText').value = '';
        reviewRating = 0;
        renderStarInput();
        toast('Thanks for the review!');
        loadReviews();
      } catch (err) {
        $('#reviewError').textContent = err.message;
      }
    });
  }

  // ------------------------------------------------------------------ opening logo animation

  function intro() {
    const target = $('.nav .brand img');
    if (reduceMotion || !target || !Element.prototype.animate) return;
    const ov = document.createElement('div');
    ov.className = 'intro';
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = '<div class="intro-mark"><img src="img/logo.svg" alt=""></div><span class="intro-name">Dollars<b>Food</b></span>';
    document.body.appendChild(ov);
    target.style.opacity = '0';
    const mark = ov.querySelector('.intro-mark');
    const name = ov.querySelector('.intro-name');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.style.opacity = '';
      ov.remove();
    };
    ov.addEventListener('click', finish);
    setTimeout(finish, 3000); // safety net

    // 1. zoom out: logo starts huge and settles in the centre
    mark.animate([
      { transform: 'scale(4)', opacity: 0, filter: 'blur(8px)' },
      { transform: 'scale(.92)', opacity: 1, filter: 'blur(0)', offset: 0.75 },
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
    ], { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    name.animate([
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 400, delay: 450, easing: 'ease-out', fill: 'forwards' });

    // 2. shrink into the header logo while the page fades in
    setTimeout(() => {
      if (done) return;
      const a = mark.querySelector('img').getBoundingClientRect(), b = target.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      mark.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})` },
      ], { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
      name.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      ov.animate([{ backgroundColor: 'rgba(15,13,12,1)' }, { backgroundColor: 'rgba(15,13,12,0)' }],
        { duration: 650, easing: 'ease-in', fill: 'forwards' }).onfinish = finish;
    }, 1150);
  }

  // ------------------------------------------------------------------ boot

  async function boot() {
    const [menu] = await Promise.all([fetch('menu.json').then((r) => r.json()), api.init()]);
    MENU = menu;
    S = menu.settings;
    menu.items.forEach((i) => { ITEMS[i.id] = i; });
    cart = cart.filter((l) => priceLine(l));

    $$('[data-wa]').forEach((a) => { a.href = waLink('Assalam o Alaikum Dollars Food! I would like to place an order.'); });
    $('#modeFlag').textContent = api.mode === 'server' ? '' : 'Preview mode: accounts and orders are saved in this browser only.';
    setSession(session);
    if (session && api.mode === 'server' && session.token.startsWith('local:')) setSession(null);
    if (session && api.mode === 'local' && !session.token.startsWith('local:')) setSession(null);
    if (session) $('#reviewName').value = session.user.name;

    renderTicker();
    renderHits();
    renderTabs();
    renderMenu();
    renderCart();
    renderOpen();
    setInterval(renderOpen, 30000);
    renderStarInput();
    loadReviews();
    bind();
    seeds();
    reveal();
    setInterval(tick, 1000);
  }

  intro();
  boot().catch((e) => {
    console.error(e);
    $('#menu-groups').innerHTML = '<p class="form-error">The menu could not load. Refresh the page, or call 0340-1219888 to order.</p>';
  });
})();
