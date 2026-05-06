const { chromium } = require("playwright");
const fs = require("fs");

const URL = "https://www.g2g.com/categories/cgpt-accounts/offer/group?fa=e96208ce%3Aecf4ece7&region_id=0f76ac42-3267-4d77-9fba-f9d9d719dac9";

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

async function extraerFechaVendedor(page) {
  const textos = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span.text-body2.text-font-default")];
    return spans.map(span => span.innerText || span.textContent || "");
  });

  console.log("SPANS ENCONTRADOS:");
  console.log(textos);

  for (const texto of textos) {
    const limpio = String(texto || "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

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

function extraerReglas(texto) {
  const match = texto.match(
    /CGPT Plus 1 Month - Private Account \(Global\)\s*([\s\S]*?)(?:View less|Ver menos|Free Insurance|Seguro gratis|Total Amount|Buy now|Comprar ahora)/i
  );

  return match ? limpiarLinea(match[1]).slice(0, 1500) : "";
}

function extraerFeedbacks(texto) {
  const lines = texto
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  console.log("LINEAS PARA FEEDBACK:");
  console.log(lines);

  const feedbacks = [];

  for (let i = 0; i < lines.length; i++) {

    const nombre = lines[i];

    const pareceUsuario =
      /^[A-Za-z0-9]\*{3,}[A-Za-z0-9]?$/.test(nombre);

    if (pareceUsuario) {

      for (let j = i + 1; j <= i + 5; j++) {

        const posibleFecha = lines[j] || "";

        const match = posibleFecha.match(
          /(\d{1,2}\s+[A-Za-z]{3,12}\s+\d{4})/i
        );

        if (match) {

          feedbacks.push(
            `👍 ${nombre} · ${match[1]}`
          );

          break;
        }
      }
    }
  }

  return feedbacks.slice(0, 5);
}

async function run() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
  });

  const page = await browser.newPage();

  await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  const vendedor = "StoreDwi";

  const ok = await abrirAnuncioPorFila(page, vendedor);

  if (!ok) {
    console.log("No se pudo abrir el anuncio.");
    await browser.close();
    return;
  }

  await page.waitForTimeout(8000);

  try {
    const viewMore = page.getByText(/View more|Ver más/i).first();
    await viewMore.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await viewMore.click();
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log("No encontré View more / Ver más");
  }

  const detalle = await page.locator("body").innerText();

  fs.writeFileSync("detalle-body.txt", detalle, "utf8");

  const info = {
    vendedor,

    reglas: extraerReglas(detalle),

    entregas_exitosas: limpiarLinea(
      extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Successful delivery)/i) ||
      extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Entrega exitosa)/i)
    ),

    fecha_vendedor: await extraerFechaVendedor(page),

    rating_total: limpiarLinea(
      extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*All time rating)/i) ||
      extraerDato(detalle, /(\d{1,3}(?:\.\d{1,2})?%\s*Calificación de todos los tiempos)/i)
    ),

    insignia: detalle.includes("Legendary Seller")
      ? "Legendary Seller"
      : detalle.includes("Normal Seller")
      ? "Normal Seller"
      : detalle.includes("Common Seller")
      ? "Common Seller"
      : "",

    feedback_1: "",
    feedback_2: "",
    feedback_3: "",
    feedback_4: "",
    feedback_5: ""
  };

  try {

  const compras = page
    .getByText(
      /Compras verificadas recientes|Recent verified purchases/i
    )
    .first();

  await compras.scrollIntoViewIfNeeded();

  await page.waitForTimeout(1000);

  // buscar botón flecha
  const flecha = compras
    .locator("xpath=..")
    .locator("button")
    .first();

  await flecha.waitFor({
    timeout: 10000
  });

  await flecha.click();

  await page.waitForTimeout(3000);

  const modalTexto = await page
    .locator("body")
    .innerText();

  const feedbacks =
    extraerFeedbacks(modalTexto);

  info.feedback_1 = feedbacks[0] || "";
  info.feedback_2 = feedbacks[1] || "";
  info.feedback_3 = feedbacks[2] || "";
  info.feedback_4 = feedbacks[3] || "";
  info.feedback_5 = feedbacks[4] || "";

} catch (e) {

  console.log("No pude leer feedbacks.");
  console.log(e);

}

  fs.writeFileSync(
    "detalle-extra-test.json",
    JSON.stringify(info, null, 2),
    "utf8"
  );

  console.log("INFORMACIÓN EXTRA:");
  console.log(info);

  await page.waitForTimeout(5000);
  await browser.close();
}

run();