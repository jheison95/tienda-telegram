const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const user = tg.initDataUnsafe.user;
const telegram_id = user ? user.id : "demo";

let balance = 0;
let orders = [];
let transactions = [];
let offers = [];
let isBuying = false;
let products = [];
let selectedProduct = null;

if (user) {
  document.getElementById("username").innerText =
    user.username ? "@" + user.username : (user.first_name || "Usuario");

  document.getElementById("userid").innerText =
    "Telegram ID: " + user.id;

  const avatar = document.getElementById("avatar");

  if (user.photo_url) {
    avatar.innerHTML = `<img src="${user.photo_url}" alt="Perfil">`;
  } else {
    avatar.innerText = (user.first_name || user.username || "U")
      .charAt(0)
      .toUpperCase();
  }
}

function showPage(pageId, element) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(pageId).classList.add("active");

  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if (element) element.classList.add("active");

  if (pageId === "orders") renderOrders();
  if (pageId === "wallet") renderTransactions();
}

function goHome() {
  showPage("home", document.querySelectorAll(".nav-item")[0]);
}

function updateBalance() {
  document.getElementById("balance").innerText = balance.toFixed(2);
  document.getElementById("smallBalance").innerText = balance.toFixed(2) + " USDT";
}

function formatPercent(valor) {
  if (valor === "" || valor === null || valor === undefined) return "-";

  const text = String(valor).trim();
  if (text.includes("%")) return text;

  const num = Number(text);
  if (!isNaN(num)) {
    if (num <= 1) return (num * 100).toFixed(2) + "%";
    return num.toFixed(2) + "%";
  }

  return text;
}

function formatFecha(fecha) {
  if (!fecha) return "Fecha no disponible";

  const meses = {
    Jan: "ene",
    Feb: "feb",
    Mar: "mar",
    Apr: "abr",
    May: "may",
    Jun: "jun",
    Jul: "jul",
    Aug: "ago",
    Sep: "sep",
    Oct: "oct",
    Nov: "nov",
    Dec: "dic"
  };

  const text = String(fecha);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (iso) {
    const m = [
      "",
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic"
    ];

    return `${Number(iso[3])} ${m[Number(iso[2])]} ${iso[1]}`;
  }

  const match = text.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) return text;

  return `${Number(match[1])} ${meses[match[2]] || match[2].toLowerCase()} ${match[3]}`;
}

async function loadUser() {
  const res = await fetch("/user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      telegram_id
    })
  });

  const data = await res.json();

  balance = Number(data.balance || 0);
  orders = data.orders || [];
  transactions = data.transactions || [];

  updateBalance();

  if (typeof renderOrders === "function") {
    renderOrders();
  }

  if (typeof renderTransactions === "function") {
    renderTransactions();
  }
}

async function loadProducts() {
  const res = await fetch("/products");
  products = await res.json();

  await renderProducts();
}

async function loadOffers(productId) {
  const res = await fetch(`/offers/${productId}`);
  offers = await res.json();
}

async function renderProducts() {
  const grid = document.getElementById("productsGrid");

  if (!products.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/3">
        No hay productos disponibles.
      </div>
    `;
    return;
  }

  const productsWithInfo = await Promise.all(
    products.map(async p => {
      const res = await fetch(`/offers/${p.id}`);
      const productOffers = await res.json();

      const prices = productOffers
        .map(o => Number(o.precio_venta || 0))
        .filter(Boolean);

      const minPrice = prices.length
        ? Math.min(...prices)
        : Number(p.price || 0);

      const totalStock = productOffers.reduce(
        (sum, o) => sum + Number(o.stock || 0),
        0
      );

      p.offersCache = productOffers;

      return {
        ...p,
        minPrice,
        totalStock
      };
    })
  );

  grid.innerHTML = productsWithInfo.map((p, index) => `
    <div class="product" onclick="openProduct(products[${index}])">
      <div class="image-box">
        <img src="${p.image}">
      </div>

      <h3>${p.name}</h3>

      <div class="product-row">
        <div>
          <div class="meta">Precio inicial</div>
          <span class="price">$${Number(p.minPrice || 0).toFixed(2)}</span>
        </div>

        <span class="badge green">${p.totalStock} stock</span>
      </div>

      <button class="main-btn" onclick="event.stopPropagation(); openProduct(products[${index}])">
        Ver vendedores
      </button>
    </div>
  `).join("");
}

async function openProduct(product) {
  selectedProduct = product;
  offers = product.offersCache || [];

  if (!offers.length) {
    await loadOffers(product.id);
  }

  if (!offers.length) {
    document.getElementById("detailContent").innerHTML = `
      <div class="detail-image">
        <img src="${product.image}">
      </div>

      <h1>${product.name}</h1>

      <div class="empty">
        No hay vendedores disponibles para este producto.
      </div>
    `;

    showPage("detail", null);
    return;
  }

  const prices = offers.map(o => Number(o.precio_venta || 0)).filter(Boolean);
  const minPrice = Math.min(...prices);
  const totalStock = offers.reduce((sum, o) => sum + Number(o.stock || 0), 0);

  document.getElementById("detailContent").innerHTML = `
    <div class="detail-image">
      <img src="${product.image}">
    </div>

    <h1>${product.name}</h1>

    <div class="product-row">
      <div>
        <div class="meta">Mejor precio disponible</div>
        <span class="price">Desde $${minPrice.toFixed(2)}</span>
        <span style="color:#6b7280;margin-left:6px">USDT</span>
      </div>

      <span class="badge green">${totalStock} disponibles</span>
    </div>

    <div class="hero-info" style="display:block">
      Elige el proveedor que prefieras. Puedes revisar reputación, nivel, entrega, fecha como vendedor y feedbacks antes de comprar.
    </div>

    <div class="title">Vendedores disponibles</div>
    <div id="offersBox"></div>
  `;

  renderOffers();
  showPage("detail", null);
}

function renderOffers() {
  const box = document.getElementById("offersBox");

  box.innerHTML = offers.map((o, index) => {
    const price = Number(o.precio_venta || 0);

    const feedbacks = [
      o.feedback_1,
      o.feedback_2,
      o.feedback_3,
      o.feedback_4,
    ].filter(Boolean);

    return `
      <div class="offer">
        <div class="offer-head" onclick="toggleDetails(${index})">
          <div>
            <div class="seller">${o.vendedor}</div>

            <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
              <span class="badge purple">Nivel ${o.nivel}</span>
              <span class="badge green">${o.entregas_exitosas || "Entrega verificada"}</span>
              <span class="badge blue">${o.entrega}</span>
            </div>

            <div class="meta">
              ${o.ventas} ventas · ${o.insignia || "Vendedor verificado"}
            </div>
          </div>

          <div style="text-align:right;min-width:92px">
            <div class="small-price">$${price.toFixed(2)}</div>
            <small>USDT</small>
          </div>
        </div>

        <div class="product-row">
          <span class="badge gray">Min. ${o.compra_minima || 1}</span>
          <span class="badge">${o.stock} stock</span>
          <span class="badge orange">${formatPercent(o.rating_total || o.reputacion)}</span>

          ${
            String(o.destacada).toLowerCase() === "si"
              ? `<span class="badge red">Top precio</span>`
              : ""
          }
        </div>

        <button class="secondary-btn" onclick="toggleDetails(${index})">
          Ver detalles del vendedor
        </button>

        <div id="details-${index}" style="display:none;margin-top:14px">
          <div class="stats-grid">
            <div class="stat">
              <b>Reputación</b>
              <span>${formatPercent(o.reputacion)}</span>
            </div>

            <div class="stat">
              <b>Rating total</b>
              <span>${o.rating_total || "-"}</span>
            </div>

            <div class="stat">
              <b>Vendedor desde</b>
              <span>${formatFecha(o.fecha_vendedor)}</span>
            </div>

            <div class="stat">
              <b>Insignia</b>
              <span>${o.insignia || "Verificado"}</span>
            </div>
          </div>

          <div class="qty-box">
            <button class="qty-btn" onclick="changeOfferQty(${index}, -1)">-</button>
            <div class="qty-number" id="offer-qty-${index}">${o.compra_minima || 1}</div>
            <button class="qty-btn" onclick="changeOfferQty(${index}, 1)">+</button>
          </div>

          ${
            o.reglas_formato || o.reglas
              ? `<div class="rules">${(o.reglas_formato || o.reglas).replace(/\n/g, "<br>")}</div>`
              : ""
          }

          ${
            feedbacks.length
              ? `
                <div style="margin-top:10px">
                  ${feedbacks.map(f => {
                    const parts = f.split("·");
                    const base = parts.slice(0, 2).join(" · ");
                    const extra = parts.slice(2).join(" · ");

                    return `
                      <div class="feedback-item">
                        <div class="feedback-main">${base}</div>
                        ${
                          extra
                            ? `<div class="feedback-extra">${extra}</div>`
                            : ""
                        }
                      </div>
                    `;
                  }).join("")}
                </div>
              `
              : ""
          }

          <button id="buy-offer-${index}" class="main-btn" style="margin-top:12px" onclick="buyOffer(${index})">
            Comprar con ${o.vendedor}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function toggleDetails(index) {
  const el = document.getElementById(`details-${index}`);
  if (!el) return;

  el.style.display = el.style.display === "none" ? "block" : "none";
}

function changeOfferQty(index, change) {
  const el = document.getElementById(`offer-qty-${index}`);

  let qty = Number(el.innerText);

  const max = Number(offers[index].stock || 1);
  const min = Number(offers[index].compra_minima || 1);

  qty += change;

  if (qty < min) qty = min;
  if (qty > max) qty = max;

  el.innerText = qty;
}

async function buyOffer(index) {
  if (isBuying) return;

  const offer = offers[index];
  const qty = Number(document.getElementById(`offer-qty-${index}`).innerText);
  const price = Number(offer.precio_venta || 0);
  const total = price * qty;

  if (balance < total) {
    tg.showAlert("Saldo insuficiente. Recarga tu wallet primero.");
    return;
  }

  isBuying = true;

  const btn = document.getElementById(`buy-offer-${index}`);
  btn.disabled = true;
  btn.innerText = "Procesando...";

  const res = await fetch("/buy-offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegram_id,
      offer: {
        ...offer,
        quantity: qty,
        product_name: selectedProduct?.name || "Producto digital"
      }
    })
  });

  const data = await res.json();

  isBuying = false;
  btn.disabled = false;
  btn.innerText = `Comprar con ${offer.vendedor}`;

  if (!data.success) {
    tg.showAlert(data.message || "Compra fallida");
    return;
  }

  balance = Number(data.balance || 0);
  orders.unshift(data.order);

  await loadOffers(offer.producto_id);

  if (selectedProduct) {
    selectedProduct.offersCache = offers;
  }

  renderOffers();

  await loadProducts();

  if (selectedProduct) {
    const updated = products.find(
      p => String(p.id) === String(selectedProduct.id)
    );

    if (updated) {
      selectedProduct = updated;
      selectedProduct.offersCache = offers;
    }
  }

  transactions.unshift({
    type: "Compra",
    amount: -data.order.total,
    date: new Date().toLocaleString()
  });

  updateBalance();

  tg.showAlert("Orden creada ✅");
}

async function topup() {
  const res = await fetch("/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegram_id,
      amount: 10
    })
  });

  const data = await res.json();

  balance = Number(data.balance || balance);

  transactions.unshift({
    type: "Top up",
    amount: 10,
    date: new Date().toLocaleString()
  });

  updateBalance();
  renderTransactions();
  tg.showAlert("Recarga agregada ✅");
}

function renderOrders() {
  const box = document.getElementById("ordersList");

  if (!orders.length) {
    box.className = "empty";
    box.innerHTML = "No tienes órdenes todavía.";
    return;
  }

  box.className = "";

  box.innerHTML = orders.map(o => `
    <div class="box">
      <b>${o.product || o.product_name || "Producto digital"}</b>
      <p>Vendedor: ${o.vendedor || "-"}</p>
      <p>Cantidad: ${o.quantity || 1}</p>
      <p>Total: $${Number(o.total || 0).toFixed(2)} USDT</p>
      <p>Estado: ${o.status === "pending_supplier" ? "Procesando proveedor" : o.status}</p>
      <p>${o.message || ""}</p>
      <p>${o.date}</p>
    </div>
  `).join("");
}

function renderTransactions() {
  const box = document.getElementById("transactionsList");

  if (!transactions.length) {
    box.className = "empty";
    box.innerHTML = "Sin transacciones.";
    return;
  }

  box.className = "";

  box.innerHTML = transactions.map(t => `
    <div class="box">
      <b>${t.type}</b>
      <p>${t.amount > 0 ? "+" : ""}${t.amount} USDT</p>
      <p>${t.date}</p>
    </div>
  `).join("");
}

function openSupport() {
  tg.openTelegramLink("https://t.me/DigitalFilme");
}

loadUser();
loadProducts();
