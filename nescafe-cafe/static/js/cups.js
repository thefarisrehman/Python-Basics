/* Vector drink illustrations: crisp at any resolution, white background,
   with animated steam (hot drinks) and floating ice / beans (iced drinks). */
(function () {
  let uid = 0;

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function steam(hot) {
    if (!hot) return "";
    return `<g class="steam" fill="none" stroke="#b9aaa0" stroke-width="7" stroke-linecap="round" opacity=".55">
      <path class="s1" d="M175 120 c-14 -20 14 -34 0 -56 c-10 -16 8 -28 2 -40"/>
      <path class="s2" d="M205 112 c-14 -22 16 -36 0 -60 c-10 -16 8 -30 2 -44"/>
      <path class="s3" d="M235 120 c-14 -20 14 -34 0 -56 c-10 -16 8 -28 2 -40"/>
    </g>`;
  }

  function latteArt(kind, liquid, id) {
    const foam = "#fbf3e6";
    switch (kind) {
      case "heart":
        return `<g transform="translate(200 172) scale(1 .24)">
          <path fill="${foam}" d="M0 70 C-60 30 -70 -30 -36 -48 C-16 -58 -2 -44 0 -30 C2 -44 16 -58 36 -48 C70 -30 60 30 0 70Z"/>
          <path fill="${liquid}" opacity=".55" d="M0 40 C-30 18 -34 -12 -18 -22 C-8 -27 -2 -20 0 -12 C2 -20 8 -27 18 -22 C34 -12 30 18 0 40Z"/>
        </g>`;
      case "rosetta": {
        let leaves = "";
        for (let i = 0; i < 6; i++) {
          const y = -60 + i * 20, w = 62 - i * 8;
          leaves += `<path fill="none" stroke="${foam}" stroke-width="9" stroke-linecap="round"
            d="M${-w} ${y + 14} Q0 ${y - 16} ${w} ${y + 14}"/>`;
        }
        return `<g transform="translate(200 172) scale(1 .24)">${leaves}
          <path stroke="${foam}" stroke-width="6" d="M0 -70 L0 70"/>
          <circle cx="0" cy="-64" r="12" fill="${foam}"/></g>`;
      }
      case "cocoa": {
        let dots = "";
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 62;
          dots += `<circle cx="${(200 + Math.cos(a) * r).toFixed(1)}" cy="${(172 + Math.sin(a) * r * 0.2).toFixed(1)}" r="${(1 + Math.random() * 1.6).toFixed(1)}" fill="#5b3a26" opacity=".7"/>`;
        }
        return `<ellipse cx="200" cy="172" rx="92" ry="19" fill="url(#foam${id})"/>${dots}`;
      }
      case "cream":
        return `<g class="cream">
          <ellipse cx="200" cy="168" rx="80" ry="20" fill="#fffaf2"/>
          <circle cx="170" cy="156" r="26" fill="#fffdf8"/><circle cx="230" cy="156" r="26" fill="#fffdf8"/>
          <circle cx="200" cy="140" r="30" fill="#ffffff"/><circle cx="200" cy="116" r="18" fill="#fffefb"/>
          <path d="M160 150 q20 -8 40 2 q20 10 40 -2" stroke="#efe3d3" stroke-width="3" fill="none"/>
          <path d="M175 130 q25 -10 50 0" stroke="#efe3d3" stroke-width="3" fill="none"/>
          <g fill="#3a1f12"><rect x="180" y="128" width="8" height="3" rx="1.5" transform="rotate(-20 184 129)"/>
          <rect x="210" y="120" width="9" height="3" rx="1.5" transform="rotate(25 214 121)"/>
          <rect x="196" y="104" width="7" height="3" rx="1.5" transform="rotate(-8 199 105)"/>
          <rect x="222" y="142" width="8" height="3" rx="1.5" transform="rotate(12 226 143)"/>
          <rect x="166" y="146" width="7" height="3" rx="1.5" transform="rotate(35 169 147)"/></g>
        </g>`;
      default: // crema
        return `<ellipse cx="200" cy="172" rx="94" ry="19" fill="url(#crema${id})"/>
          <ellipse cx="185" cy="168" rx="26" ry="5" fill="#e3b77e" opacity=".35"/>`;
    }
  }

  function ceramic(v, id, small) {
    const liquid = v.liquid;
    const t = small ? 'transform="translate(200 250) scale(.72) translate(-200 -250)"' : "";
    return `
    <defs>
      <linearGradient id="body${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#e8e4df"/><stop offset=".22" stop-color="#ffffff"/>
        <stop offset=".6" stop-color="#f7f4f0"/><stop offset="1" stop-color="#d6d0c9"/>
      </linearGradient>
      <radialGradient id="crema${id}" cx=".45" cy=".4" r=".7">
        <stop offset="0" stop-color="${shade(liquid, 0.28)}"/><stop offset=".7" stop-color="${shade(liquid, 0.12)}"/>
        <stop offset="1" stop-color="${shade(liquid, -0.05)}"/>
      </radialGradient>
      <radialGradient id="foam${id}" cx=".5" cy=".45" r=".6">
        <stop offset="0" stop-color="#fff8ee"/><stop offset=".8" stop-color="#f1dcc0"/><stop offset="1" stop-color="${shade(liquid, 0.15)}"/>
      </radialGradient>
      <radialGradient id="shadow${id}"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="200" cy="336" rx="170" ry="22" fill="url(#shadow${id})"/>
    <g class="cup-body" ${t}>
      <ellipse cx="200" cy="318" rx="155" ry="26" fill="#e7e2dc"/>
      <ellipse cx="200" cy="312" rx="152" ry="24" fill="url(#body${id})"/>
      <ellipse cx="200" cy="309" rx="88" ry="12" fill="#ebe6e0"/>
      <path d="M302 198 c62 -8 64 72 -6 70" fill="none" stroke="#dcd6cf" stroke-width="20" stroke-linecap="round"/>
      <path d="M302 198 c62 -8 64 72 -6 70" fill="none" stroke="#fbfaf8" stroke-width="13" stroke-linecap="round"/>
      <path d="M90 170 C92 250 120 300 160 306 L240 306 C280 300 308 250 310 170 Z" fill="url(#body${id})"/>
      <path d="M112 200 C118 255 138 288 162 296" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".9"/>
      <ellipse cx="200" cy="170" rx="110" ry="26" fill="#f4f1ed"/>
      <ellipse cx="200" cy="172" rx="101" ry="21" fill="${shade(liquid, -0.08)}"/>
      <ellipse cx="200" cy="173" rx="97" ry="19.5" fill="${liquid}"/>
      ${latteArt(v.art, liquid, id)}
      <ellipse cx="200" cy="170" rx="110" ry="26" fill="none" stroke="#e2ddd7" stroke-width="2"/>
      ${steam(true)}
    </g>`;
  }

  function glass(v, id) {
    const top = 78, bottom = 330;
    const shape = "M92 78 L308 78 L284 322 Q282 330 274 330 L126 330 Q118 330 116 322 Z";
    let y = bottom, layers = "";
    v.layers.forEach(([color, frac], i) => {
      const h = frac * (bottom - top);
      y -= h;
      layers += `<rect x="80" y="${y.toFixed(1)}" width="240" height="${(h + 2).toFixed(1)}" fill="url(#lay${id}_${i})"/>`;
    });
    const surface = y;
    const grads = v.layers.map(([c], i) => `<linearGradient id="lay${id}_${i}" x1="0" x2="1">
        <stop offset="0" stop-color="${shade(c, -0.06)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.1)}"/>
      </linearGradient>`).join("");

    let ice = "";
    if (v.ice) {
      const cubes = [[130, surface - 6, -12], [196, surface + 4, 10], [252, surface - 2, -4], [158, surface + 46, 18], [230, surface + 52, -16]];
      ice = cubes.map(([x, cy, r], i) => `<g class="ice i${i}"><rect x="${x - 26}" y="${cy - 22}" width="52" height="46" rx="9"
        transform="rotate(${r} ${x} ${cy})" fill="#ffffff" fill-opacity=".38" stroke="#ffffff" stroke-opacity=".85" stroke-width="2.5"/></g>`).join("");
    }

    const straw = v.straw ? `<g class="straw"><rect x="232" y="18" width="14" height="250" rx="7" transform="rotate(14 239 140)" fill="#1b1b1b"/>
      <rect x="235" y="18" width="4" height="250" rx="2" transform="rotate(14 239 140)" fill="#555"/></g>` : "";

    const cream = v.cream ? `<g class="cream">
      <ellipse cx="200" cy="80" rx="108" ry="18" fill="#f6efe6"/>
      <circle cx="140" cy="68" r="28" fill="#fffdf9"/><circle cx="260" cy="68" r="28" fill="#fffdf9"/>
      <circle cx="175" cy="52" r="34" fill="#fff"/><circle cx="228" cy="52" r="32" fill="#fffefc"/>
      <circle cx="202" cy="28" r="26" fill="#fff"/><circle cx="204" cy="6" r="14" fill="#fffefb"/>
      <path d="M150 60 q24 -12 50 0 q26 12 50 -2" stroke="#ece2d4" stroke-width="3" fill="none"/></g>` : "";

    const dz = v.drizzle ? `<path class="drizzle" d="M${v.cream ? "140 52 L176 30 L168 62 L210 18 L206 58 L244 34 L232 66 L262 54" : "112 " + (surface + 6) + " L150 " + (surface - 4) + " L176 " + (surface + 8) + " L210 " + (surface - 6) + " L240 " + (surface + 8) + " L272 " + (surface - 4) + " L292 " + (surface + 4)}"
      fill="none" stroke="${v.drizzle}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : "";

    return `
    <defs>
      <clipPath id="clip${id}"><path d="${shape}"/></clipPath>
      ${grads}
      <linearGradient id="gl${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".18" stop-color="#fff" stop-opacity=".05"/>
        <stop offset=".82" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".4"/>
      </linearGradient>
      <radialGradient id="shadow${id}"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="200" cy="340" rx="140" ry="18" fill="url(#shadow${id})"/>
    ${v.cream ? "" : straw}
    <g clip-path="url(#clip${id})">
      <rect x="80" y="70" width="240" height="270" fill="#f6f4f1"/>
      ${layers}
      <ellipse cx="200" cy="${surface.toFixed(1)}" rx="104" ry="7" fill="#fff" opacity=".25"/>
      ${ice}
      ${v.cream ? "" : dz}
      <rect x="80" y="70" width="240" height="270" fill="url(#gl${id})"/>
    </g>
    <path d="${shape}" fill="none" stroke="#d8d2cb" stroke-width="3"/>
    <ellipse cx="200" cy="78" rx="108" ry="10" fill="none" stroke="#d8d2cb" stroke-width="3"/>
    <path d="M108 100 L128 312" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/>
    <rect x="114" y="322" width="172" height="10" rx="5" fill="#ece8e3"/>
    ${v.cream ? straw : ""}${cream}${v.cream ? dz : ""}`;
  }

  window.drinkSVG = function (visual, opts = {}) {
    const id = ++uid;
    const body = visual.type === "glass" ? glass(visual, id) : ceramic(visual, id, visual.type === "espresso");
    return `<svg class="drink ${visual.type === "glass" ? "is-iced" : "is-hot"}" viewBox="0 -20 400 380"
      role="img" aria-label="${opts.label || "Coffee"}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  };
})();
