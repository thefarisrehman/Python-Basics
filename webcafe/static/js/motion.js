/* WebCafe motion: opening intro, scroll effects and touch/pointer gestures.
   Everything here is decoration. The site works the same without it, and it
   switches itself off for visitors who ask for reduced motion. */
(function () {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  if (reduce) { root.classList.add("loaded"); return; }
  root.classList.add("motion");

  /* ---------- Split headings into words that rise into place ---------- */
  function splitWords(el) {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) return frag.append(part);
            const wrap = document.createElement("span");
            wrap.className = "w-wrap";
            const w = document.createElement("span");
            w.className = "w";
            w.style.setProperty("--i", i++);
            w.textContent = part;
            wrap.append(w);
            frag.append(wrap);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          walk(child);
        }
      });
    };
    walk(el);
    el.classList.add("split");
  }
  $$(".hero h1, .section-head h2, .band h2, #visit h2").forEach(splitWords);

  /* ---------- Opening intro (once per visit) ---------- */
  let seen = false;
  try { seen = sessionStorage.getItem("wc-intro") === "1"; } catch { /* storage blocked */ }

  function start() {
    root.classList.add("loaded");
    countUp();
  }

  if (seen) {
    start();
  } else {
    try { sessionStorage.setItem("wc-intro", "1"); } catch { /* storage blocked */ }
    const emblem = $(".logo-emblem");
    const intro = document.createElement("div");
    intro.className = "intro";
    intro.setAttribute("aria-hidden", "true");
    intro.innerHTML = `
      <div class="intro-inner">
        <div class="intro-emblem">${emblem ? emblem.outerHTML : ""}</div>
        <div class="intro-word">${[..."Web"].map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")}<em>${[..."Cafe"].map((c, i) => `<span style="--i:${i + 3}">${c}</span>`).join("")}</em></div>
        <div class="intro-tag">Peshawar Cantt · Coffee &amp; bites</div>
        <div class="intro-bar"><i></i></div>
      </div>`;
    document.body.append(intro);
    root.classList.add("intro-on");
    const finish = () => {
      if (intro.classList.contains("out")) return;
      intro.classList.add("out");
      root.classList.remove("intro-on");
      start();
      setTimeout(() => intro.remove(), 900);
    };
    intro.addEventListener("click", finish);
    setTimeout(finish, 1900);
  }

  /* ---------- Hero numbers count up ---------- */
  function countUp() {
    $$(".hero-stats strong").forEach((el, k) => {
      const m = el.textContent.match(/^(\d+(?:\.\d+)?)(.*)$/);
      if (!m) return;
      const target = parseFloat(m[1]), suffix = m[2], dec = (m[1].split(".")[1] || "").length;
      const t0 = performance.now() + 500 + k * 120, dur = 1200;
      const tick = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * e).toFixed(dec) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ---------- Scroll: progress bar, hero parallax, marquee lean ---------- */
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  document.body.append(bar);
  const heroArt = $(".hero-art"), heroCopy = $(".hero-copy"), marquee = $(".marquee");
  let lastY = scrollY, lean = 0, ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
      if (y < innerHeight * 1.2) {
        if (heroArt) heroArt.style.translate = `0 ${y * 0.18}px`;
        if (heroCopy) { heroCopy.style.translate = `0 ${y * 0.06}px`; heroCopy.style.opacity = Math.max(0, 1 - y / (innerHeight * 0.9)); }
      }
      lean += Math.max(-8, Math.min(8, (y - lastY) * 0.25));
      lastY = y;
      ticking = false;
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  (function settle() {
    lean *= 0.88;
    if (marquee) marquee.style.transform = `skewX(${(-lean).toFixed(2)}deg)`;
    requestAnimationFrame(settle);
  })();

  /* ---------- Reveal sections as they scroll in (staggered) ---------- */
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  $$(".features .feature, .testimonials blockquote").forEach((el, i) => el.style.setProperty("--d", `${(i % 4) * 110}ms`));
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------- Pointer gestures: card tilt, magnetic buttons ---------- */
  if (finePointer) {
    document.addEventListener("pointermove", (e) => {
      const card = e.target.closest && e.target.closest(".card");
      if (card) {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
        card.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
        card.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
      }
    });
    document.addEventListener("pointerout", (e) => {
      const card = e.target.closest && e.target.closest(".card");
      if (card && !card.contains(e.relatedTarget)) { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); }
    });
    $$(".hero-cta .btn, .cart-btn, .band .btn").forEach((btn) => {
      btn.classList.add("magnetic");
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.25}px ${(e.clientY - r.top - r.height / 2) * 0.35}px`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.translate = "0 0"; });
    });
  }

  /* ---------- Ripple on every button press ---------- */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest && e.target.closest(".btn, .chip");
    if (!btn) return;
    const r = btn.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2;
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    btn.append(dot);
    setTimeout(() => dot.remove(), 650);
  });

  /* ---------- Added to order: the picture flies into the cart ---------- */
  function flyToCart(fromEl) {
    const cartBtn = $("#cartBtn");
    if (!fromEl || !cartBtn) return;
    const a = fromEl.getBoundingClientRect(), b = cartBtn.getBoundingClientRect();
    if (!a.width) return;
    const ghost = fromEl.cloneNode(true);
    ghost.classList.add("fly");
    ghost.removeAttribute("id");
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy - 120}px) scale(.55)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: 0.2 },
    ], { duration: 850, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => {
      ghost.remove();
      cartBtn.animate([{ transform: "rotate(0)" }, { transform: "rotate(-10deg) scale(1.08)" }, { transform: "rotate(8deg)" }, { transform: "rotate(0)" }], { duration: 450 });
    };
  }
  document.addEventListener("click", (e) => {
    const quick = e.target.closest("[data-quick]");
    if (quick) return flyToCart(quick.closest(".card")?.querySelector(".card-art .drink"));
    if (e.target.closest("#pmAdd")) flyToCart($("#pmArt .drink"));
  }, true);

  /* ---------- Touch gestures: swipe the cart right / the product down to close ---------- */
  function swipeToClose(panel, axis, closeBtnSel) {
    let start = null, delta = 0;
    panel.addEventListener("touchstart", (e) => {
      const scroller = e.target.closest(".drawer-step, .modal");
      if (axis === "y" && scroller && scroller.scrollTop > 0) return;
      start = axis === "x" ? e.touches[0].clientX : e.touches[0].clientY;
      delta = 0;
      panel.style.transition = "none";
    }, { passive: true });
    panel.addEventListener("touchmove", (e) => {
      if (start === null) return;
      delta = Math.max(0, (axis === "x" ? e.touches[0].clientX : e.touches[0].clientY) - start);
      panel.style.transform = axis === "x" ? `translateX(${delta}px)` : `translateY(${delta}px)`;
    }, { passive: true });
    panel.addEventListener("touchend", () => {
      if (start === null) return;
      start = null;
      panel.style.transition = "transform .3s cubic-bezier(.22,.8,.25,1)";
      if (delta > 90) {
        panel.style.transform = axis === "x" ? "translateX(110%)" : "translateY(110%)";
        setTimeout(() => { panel.parentElement.querySelector(closeBtnSel)?.click(); panel.style.transform = ""; }, 260);
      } else {
        panel.style.transform = "";
      }
    });
  }
  const drawer = $(".drawer"), modal = $(".modal");
  if (drawer) swipeToClose(drawer, "x", "[data-close]");
  if (modal) swipeToClose(modal, "y", "[data-close]");
})();
