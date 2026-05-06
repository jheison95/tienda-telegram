require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const SHEET_URL = "https://script.google.com/macros/s/AKfycbwJs8UWS6_kJVhEgb3CMuyE5AeBSXANM2L57PlcG9HUV718pPn5ag_ysXNV8Tm1GKrE7g/exec";

let users = {};
let purchaseLocks = {};

app.get("/products", async (req, res) => {
  try {
    const response = await fetch(SHEET_URL + "?action=products");
    const products = await response.json();
    res.json(products);
  } catch (error) {
    console.log("Error cargando productos:", error);
    res.status(500).json({ error: "No se pudieron cargar productos" });
  }
});

app.get("/offers/:productId", async (req, res) => {
  try {
    const productId = req.params.productId;

    const response = await fetch(
      SHEET_URL + `?action=offers&product_id=${productId}`
    );

    const offers = await response.json();

    res.json(offers);
  } catch (error) {
    console.log("Error cargando ofertas:", error);
    res.status(500).json({ error: "No se pudieron cargar ofertas" });
  }
});

app.post("/user", (req, res) => {
  const { telegram_id } = req.body;

  if (!users[telegram_id]) {
    users[telegram_id] = {
      balance: 0,
      orders: []
    };
  }

  res.json(users[telegram_id]);
});

app.post("/topup", (req, res) => {
  const { telegram_id, amount } = req.body;

  if (!users[telegram_id]) {
    users[telegram_id] = {
      balance: 0,
      orders: []
    };
  }

  users[telegram_id].balance += Number(amount);

  res.json({
    success: true,
    balance: users[telegram_id].balance
  });
});

app.post("/buy-offer", async (req, res) => {
  const { telegram_id, offer } = req.body;

  if (!users[telegram_id]) {
    users[telegram_id] = {
      balance: 0,
      orders: []
    };
  }

  if (purchaseLocks[telegram_id]) {
    return res.json({
      success: false,
      message: "Compra en proceso, espera un momento",
      balance: users[telegram_id].balance
    });
  }

  purchaseLocks[telegram_id] = true;

  try {
    const quantity = Number(offer.quantity || 1);
    const price = Number(offer.precio_venta || offer.price || 0);
    const total = price * quantity;

    if (quantity < 1) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "Cantidad inválida",
        balance: users[telegram_id].balance
      });
    }

    if (quantity > Number(offer.stock || 0)) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "No hay stock suficiente",
        balance: users[telegram_id].balance
      });
    }

    if (users[telegram_id].balance < total) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "Saldo insuficiente",
        balance: users[telegram_id].balance
      });
    }

    users[telegram_id].balance -= total;

    await fetch(SHEET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "discount_offer_stock",
        producto_id: offer.producto_id,
        vendedor: offer.vendedor,
        quantity
      })
    });

    const order = {
      id: Date.now(),
      product: offer.product_name || "Producto digital",
      product_name: offer.product_name || "Producto digital",
      product_id: offer.producto_id,
      vendedor: offer.vendedor,
      nivel: offer.nivel,
      price,
      precio_proveedor: offer.precio,
      quantity,
      total,
      status: "pending_supplier",
      message: "Pedido recibido. Estamos procesando tu acceso.",
      date: new Date().toLocaleString()
    };

    users[telegram_id].orders.unshift(order);

    purchaseLocks[telegram_id] = false;

    res.json({
      success: true,
      balance: users[telegram_id].balance,
      order
    });

  } catch (error) {
    console.log("Error comprando oferta:", error);

    purchaseLocks[telegram_id] = false;

    res.json({
      success: false,
      message: "Error procesando compra",
      balance: users[telegram_id].balance
    });
  }
});

app.post("/orders", (req, res) => {
  const { telegram_id } = req.body;

  if (!users[telegram_id]) {
    users[telegram_id] = {
      balance: 0,
      orders: []
    };
  }

  res.json(users[telegram_id].orders);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});