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

app.post("/user", async (req, res) => {
  try {
    const { telegram_id } = req.body;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", telegram_id)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([
          {
            id: telegram_id,
            balance: 0
          }
        ])
        .select()
        .single();

      if (error) throw error;

      user = newUser;
    }

    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("*")
      .eq("telegram_id", telegram_id)
      .order("created_at", { ascending: false });

    if (ordersError) throw ordersError;

    const orders = (ordersData || []).map(o => ({
      id: o.id,
      product: o.product_name || o.product_id || "Producto digital",
      product_id: o.product_id,
      vendedor: o.vendedor,
      nivel: o.nivel,
      quantity: o.quantity,
      price: o.price,
      total: o.total,
      status: o.status,
      message: o.message,
      date: new Date(o.created_at).toLocaleString()
    }));

    const { data: transactionsData, error: transactionsError } = await supabase
      .from("transactions")
      .select("*")
      .eq("telegram_id", telegram_id)
      .order("created_at", { ascending: false });

    if (transactionsError) throw transactionsError;

    const transactions = (transactionsData || []).map(t => ({
      type: t.type === "topup" ? "Top up" : t.type,
      amount: Number(t.amount),
      date: new Date(t.created_at).toLocaleString()
    }));

    res.json({
      balance: Number(user.balance || 0),
      orders,
      transactions
    });

  } catch (error) {
    console.log("Error /user:", error);

    res.status(500).json({
      error: "Error cargando usuario"
    });
  }
});
app.post("/topup", async (req, res) => {
  try {
    const { telegram_id, amount } = req.body;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", telegram_id)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([
          {
            id: telegram_id,
            balance: 0
          }
        ])
        .select()
        .single();

      if (error) throw error;

      user = newUser;
    }

    const newBalance =
      Number(user.balance || 0) + Number(amount || 0);

    const { error: updateError } = await supabase
      .from("users")
      .update({
        balance: newBalance
      })
      .eq("id", telegram_id);

    if (updateError) throw updateError;

    const { error: transactionError } = await supabase
      .from("transactions")
      .insert([
        {
          telegram_id,
          type: "topup",
          amount
        }
      ]);

    if (transactionError) throw transactionError;

    res.json({
      success: true,
      balance: newBalance
    });

  } catch (error) {
    console.log("Error /topup:", error);

    res.status(500).json({
      success: false,
      message: "Error agregando saldo"
    });
  }
});
app.post("/buy-offer", async (req, res) => {
  const { telegram_id, offer } = req.body;

  if (purchaseLocks[telegram_id]) {
    return res.json({
      success: false,
      message: "Compra en proceso, espera un momento"
    });
  }

  purchaseLocks[telegram_id] = true;

  try {
    const quantity = Number(offer.quantity || 1);
    const price = Number(offer.precio_venta || offer.price || 0);
    const total = price * quantity;

    let { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", telegram_id)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([
          {
            id: telegram_id,
            balance: 0
          }
        ])
        .select()
        .single();

      if (error) throw error;
      user = newUser;
    }

    const currentBalance = Number(user.balance || 0);

    if (quantity < 1) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "Cantidad inválida",
        balance: currentBalance
      });
    }

    if (quantity > Number(offer.stock || 0)) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "No hay stock suficiente",
        balance: currentBalance
      });
    }

    if (currentBalance < total) {
      purchaseLocks[telegram_id] = false;

      return res.json({
        success: false,
        message: "Saldo insuficiente",
        balance: currentBalance
      });
    }

    const newBalance = currentBalance - total;

    const { error: balanceError } = await supabase
      .from("users")
      .update({
        balance: newBalance
      })
      .eq("id", telegram_id);

    if (balanceError) throw balanceError;

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

    const { data: savedOrder, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          telegram_id,
          product_id: offer.producto_id,
          product_name: offer.product_name || offer.name,
          vendedor: offer.vendedor,
          nivel: offer.nivel,
          quantity,
          price,
          total,
          status: "pending_supplier",
          message: "Pedido recibido. Estamos procesando tu acceso."
        }
      ])
      .select()
      .single();

    if (orderError) throw orderError;

    const order = {
      id: savedOrder.id,
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
      date: new Date(savedOrder.created_at).toLocaleString()
    };

    purchaseLocks[telegram_id] = false;

    res.json({
      success: true,
      balance: newBalance,
      order
    });

  } catch (error) {
    console.log("Error comprando oferta:", error);

    purchaseLocks[telegram_id] = false;

    res.json({
      success: false,
      message: "Error procesando compra"
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