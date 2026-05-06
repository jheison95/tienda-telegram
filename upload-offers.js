const fs = require("fs");
const axios = require("axios");

// TU LINK DE APPS SCRIPT
const API_URL = "https://script.google.com/macros/s/AKfycbzngRRQgSCQ-bU4KhkA8VlLbz5C8fZ4ZmRhpmuW9F8nwM6EjjvRuBOjKCeNYmwXuwbZHQ/exec";

async function uploadOffers() {
  try {

    const offers = JSON.parse(
      fs.readFileSync("g2g-offers.json", "utf8")
    );

    console.log("Enviando ofertas...");
    console.log("Cantidad:", offers.length);

    const response = await axios.post(API_URL, {
      action: "save_offers",
      offers
    });

    console.log("RESPUESTA:");
    console.log(response.data);

  } catch (error) {
    console.log("ERROR:");

    if (error.response) {
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}

uploadOffers();