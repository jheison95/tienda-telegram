const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");

const API_URL = "https://script.google.com/macros/s/AKfycbwJs8UWS6_kJVhEgb3CMuyE5AeBSXANM2L57PlcG9HUV718pPn5ag_ysXNV8Tm1GKrE7g/exec";


const MAX_OFERTAS = 5;

function cleanNumber(value) {
  if (!value) return 0;
  const text = String(value).toLowerCase().replace(",", ".");
  if (text.includes("k")) return Math.round(parseFloat(text) * 1000);
  if (text.includes("m")) return Math.round(parseFloat(text) * 1000000);
  return Number(text.replace(/[^\d.]/g, "")) || 0;
}

function isInstantDelivery(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("instant") || text.includes("instantáneo") || text.includes("instantaneo");
}

function limpiarLinea(valor) {
  return String(valor || "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extraerDato(texto, regex) {
  const match = texto.match(regex);
  return match ? match[1] || match[0] : "";
}

function extraerReglas(texto) {
  if (!texto) return "";

  const limpio = String(texto);

  const match = limpio.match(
    /(?:Información del producto|Product information|Product Information|Description|Descripción)\s*([\s\S]*?)(?:View less|Ver menos|Free Insurance|Seguro gratis|Total Amount|Buy now|Comprar ahora|Cantidad total|Comprar)/i
  );

  if (match) {
    return limpiarLinea(match[1]).slice(0, 1500);
  }

  const match2 = limpio.match(
    /(?:Rules:|Rule:|Warranty:|Guarantee:|Note:|Important:|Delivery:|How does it work\?)([\s\S]*?)(?:View less|Ver menos|Total Amount|Buy now|Comprar ahora|Free Insurance|Seguro gratis)/i
  );

  if (match2) {
    return limpiarLinea(match2[0]).slice(0, 1500);
  }

  return "";
}

async function extraerFechaVendedor(page) {
  const textos = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span.text-body2.text-font-default")];
    return spans.map(span => span.innerText || span.textContent || "");
  });

  for (const texto of textos) {
    const limpio = limpiarLinea(texto);

    if (
      limpio.toLowerCase().includes("joined") ||
      limpio.toLowerCase().includes("unido") ||
      limpio.toLowerCase().includes("miembro")
    ) {
      return limpio
        .replace(/joined,?/i, "")
        .replace(/unido,?/i, "")
        .replace(/miembro desde,?/i, "")
        .trim();
    }
  }

  return "";
}

function extraerFeedbacks(texto) {
  const lines = texto
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const feedbacks = [];

  for (let i = 0; i < lines.length; i++) {
    const nombre = lines[i];

    if (
      nombre.includes("*") &&
      !nombre.includes("%") &&
      !nombre.toLowerCase().includes("offer rating") &&
      !nombre.toLowerCase().includes("calificación")
    ) {
      let fecha = "";
      let comentarios = [];

      for (let j = i + 1; j < i + 12; j++) {
        const line = lines[j];
        if (!line) continue;

        if (/^\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]{3,12}\s+\d{4}$/i.test(line)) {
          fecha = line;
          continue;
        }

        if (
          fecha &&
          !line.includes("*") &&
          !line.toLowerCase().includes("mostrar más") &&
          !line.toLowerCase().includes("show more") &&
          !line.toLowerCase().includes("pedidos") &&
          !line.toLowerCase().includes("últimos") &&
          !line.toLowerCase().includes("thumb_up")
        ) {
          if (line.length >= 3 && line.length <= 80) {
            comentarios.push(line);
          }
        }

        if (fecha && lines[j + 1] && lines[j + 1].includes("*")) break;
      }

      if (fecha) {
        const extra = comentarios.length
          ? " · " + comentarios.slice(0, 2).join(" · ")
          : "";

        feedbacks.push(`👍 ${nombre} · ${fecha}${extra}`);
      }
    }
  }

  return feedbacks.slice(0, 5);
}

async function abrirAnuncioPorFila(page, vendedor) {
  const card = page.locator("div.g-card-hover").filter({
    hasText: vendedor
  }).first();

  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();

  const box = await card.boundingBox();
  if (!box) return false;

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function extraerDetallesOferta(page, vendedor) {
  const detalleInfo = {
    reglas: "",
    entregas_exitosas: "",
    fecha_vendedor: "",
    rating_total: "",
    insignia: "",
    feedback_1: "",
    feedback_2: "",
    feedback_3: "",
    feedback_4: "",
    feedback_5: ""
  };

  const ok = await abrirAnuncioPorFila(page, vendedor);

  if (!ok) {
    console.log("No se pudo abrir:", vendedor);
    return detalleInfo;
  }

  await page.waitForTimeout(5000);

  try {
    const viewMore = page.getByText(/View more|Ver más/i).first();

    const existeViewMore = await viewMore.isVisible({
      timeout: 2500
    });

    if (existeViewMore) {
      await viewMore.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await viewMore.click();
      await page.waitForTimeout(1200);
    } else {
      console.log("No encontré View more:", vendedor);
    }
  } catch (e) {
    console.log("No encontré View more:", vendedor);
  }

  const detalle = await page.locator("body").innerText();

  detalleInfo.reglas = limpiarReglas(extraerReglas(detalle));

  detalleInfo.entregas_exitosas = limpiarLinea(
    extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Successful delivery)/i) ||
    extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Entrega exitosa)/i)
  );

  detalleInfo.fecha_vendedor = await extraerFechaVendedor(page);

  detalleInfo.rating_total = limpiarLinea(
    extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*All time rating)/i) ||
    extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Calificación de todos los tiempos)/i)
  );

  detalleInfo.insignia = detalle.includes("Legendary Seller")
    ? "Legendary Seller"
    : detalle.includes("Normal Seller")
    ? "Normal Seller"
    : detalle.includes("Common Seller")
    ? "Common Seller"
    : "";

  try {
    const compras = page
      .getByText(/Compras verificadas recientes|Recent verified purchases/i)
      .first();

    const existeCompras = await compras.isVisible({
      timeout: 3500
    });

    if (!existeCompras) {
      console.log("No encontré compras recientes:", vendedor);
      return detalleInfo;
    }

    await compras.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const flecha = compras
      .locator("xpath=..")
      .locator("button")
      .first();

    const existeFlecha = await flecha.isVisible({
      timeout: 3500
    });

    if (!existeFlecha) {
      console.log("No encontré flecha feedbacks:", vendedor);
      return detalleInfo;
    }

    await flecha.click();
    await page.waitForTimeout(1800);

    const modalTexto = await page.locator("body").innerText();
    const feedbacks = extraerFeedbacks(modalTexto);

    detalleInfo.feedback_1 = feedbacks[0] || "";
    detalleInfo.feedback_2 = feedbacks[1] || "";
    detalleInfo.feedback_3 = feedbacks[2] || "";
    detalleInfo.feedback_4 = feedbacks[3] || "";
    detalleInfo.feedback_5 = feedbacks[4] || "";
  } catch (e) {
    console.log("No pude leer feedbacks:", vendedor);
  }

  return detalleInfo;
}
function limpiarReglas(texto) {
  if (!texto) return "";

  texto = String(texto)
    .replace(/\r/g, "")
    .replace(/\n/g, "\n\n")
    .trim();

  // Quitar bloque repetido de info del producto
  texto = texto.replace(
    /Información del producto\s+Velocidad de entrega\s+.*?Account\s+CGPT Plus 1 Month\s*-\s*Private Account\s*\(Global\)/i,
    ""
  );

  texto = texto.replace(
    /Velocidad de entrega Instantáneo Método de entrega Entrega automática Se puede activar en Colombia Account/gi,
    ""
  );

  // Agregar saltos e iconos sin cambiar el texto original
  texto = texto
    .replace(/Rules:/gi, "\n📜 Rules:")
    .replace(/Rule:/gi, "\n📜 Rule:")
    .replace(/Warranty:/gi, "\n🛡️ Warranty:")
    .replace(/Guarantee:/gi, "\n🛡️ Guarantee:")
    .replace(/Note:/gi, "\n📝 Note:")
    .replace(/Important:/gi, "\n⚠️ Important:")
    .replace(/Replacement:/gi, "\n🔁 Replacement:")
    .replace(/Replace:/gi, "\n🔁 Replace:")
    .replace(/Refund:/gi, "\n💰 Refund:")
    .replace(/Delivery:/gi, "\n⚡ Delivery:")
    .replace(/How does it work\?/gi, "\n❓ How does it work?")
    .replace(/Why Choose Us:/gi, "\n✅ Why Choose Us:");

  const partes = texto
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  return [...new Set(partes)].join("\n");
}
async function run() {

  console.log("Cargando productos...");

  const productsResponse = await axios.get(
    API_URL + "?action=products_scan"
  );

  const products = productsResponse.data || [];

  console.log("Productos encontrados:", products.length);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  for (const product of products) {

    const PRODUCTO_ID = product.id;
    const URL = product.url_g2g;

    console.log("================================");
    console.log("Escaneando:", product.name);
    console.log("Producto ID:", PRODUCTO_ID);

    try {

      await page.goto(URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(12000);

      const text = await page.locator("body").innerText();

      const lines = text
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

      let offers = [];

      for (let i = 0; i < lines.length; i++) {

        if (
          lines[i + 1]?.startsWith("Nivel") &&
          lines[i + 2] === "thumb_up"
        ) {

          const delivery = lines[i + 8] || "";
          const priceRaw = lines[i + 9] || "";
          const currency = lines[i + 10] || "";
          const stockRaw = lines[i + 7] || "";
          const compraMinimaRaw = lines[i + 5] || "1";

          const precio =
            Number(String(priceRaw).replace(",", ".")) || 0;

          const stock = cleanNumber(stockRaw);

          const compraMinima =
            cleanNumber(compraMinimaRaw) || 1;

          if (
            currency === "USD" &&
            precio > 0 &&
            stock > 0 &&
            isInstantDelivery(delivery)
          ) {

            offers.push({
              producto_id: PRODUCTO_ID,
              vendedor: lines[i],
              nivel: lines[i + 1]
                .replace("Nivel", "")
                .trim(),
              reputacion: lines[i + 3] || "",
              ventas: cleanNumber(lines[i + 4] || ""),
              stock,
              entrega: delivery,
              precio,
              fuente: "g2g",
              activo: "si",
              reglas: "",
              entregas_exitosas: "",
              fecha_vendedor: "",
              rating_total: "",
              insignia: "",
              feedback_1: "",
              feedback_2: "",
              feedback_3: "",
              feedback_4: "",
              feedback_5: "",
              destacada: "no",
              compra_minima: compraMinima
            });

          }
        }
      }

      offers = offers.slice(0, MAX_OFERTAS);

      const masBaratas = [...offers]
        .sort((a, b) => a.precio - b.precio)
        .slice(0, 5)
        .map(o => `${o.vendedor}-${o.precio}`);

      offers.forEach(o => {
        if (
          masBaratas.includes(
            `${o.vendedor}-${o.precio}`
          )
        ) {
          o.destacada = "si";
        }
      });

      console.log("Ofertas encontradas:", offers.length);

      const resultado = [];

      for (const oferta of offers) {

        console.log(
          "Procesando vendedor:",
          oferta.vendedor
        );

        try {

          await page.goto(URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
          });

          await page.waitForTimeout(7000);

          const detalles =
            await extraerDetallesOferta(
              page,
              oferta.vendedor
            );

          resultado.push({
            ...oferta,
            ...detalles
          });

          console.log("OK:", oferta.vendedor);

        } catch (e) {

          console.log(
            "Error vendedor:",
            oferta.vendedor
          );

          console.log(e.message);

          resultado.push(oferta);
        }
      }

      fs.writeFileSync(
        `g2g-${PRODUCTO_ID}.json`,
        JSON.stringify(resultado, null, 2),
        "utf8"
      );

      console.log("Subiendo a Google Sheets...");

      const response = await axios.post(API_URL, {
        action: "save_offers_product",
        producto_id: PRODUCTO_ID,
        offers: resultado
      });

      console.log(response.data);

    } catch (e) {

      console.log(
        "ERROR PRODUCTO:",
        product.name
      );

      console.log(e.message);
    }
  }

  console.log("ESCANEO FINALIZADO");

  await browser.close();
}

async function startScanner() {
  console.log("SCANNER G2G 24/7 INICIADO");

  while (true) {
    try {
      console.log("NUEVO ESCANEO:", new Date().toLocaleString());

      await run();

      console.log("ESCANEO COMPLETO. Reiniciando en 30 segundos...");

      await new Promise(resolve => setTimeout(resolve, 30 * 1000));

    } catch (error) {
      console.log("ERROR EN SCANNER:", error);
      console.log("Reintentando en 60 segundos...");

      await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    }
  }
}

startScanner();