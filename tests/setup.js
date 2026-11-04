const path = require("node:path");
const dotenv = require("dotenv");
const { app, products, cards, orders, sessions } = require("../src/server");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const apiUrl = new URL(process.env.API_BASE_URL || "http://127.0.0.1:3000");
let server;

function resetApiState() {
  const initialStock = {
    "product-1": 20,
    "product-2": 15,
    "product-3": 30,
  };
  for (const product of products) {
    product.stock = initialStock[product.id];
  }
  cards.length = 0;
  orders.length = 0;
  sessions.clear();
}

exports.mochaHooks = {
  async beforeAll() {
    if (apiUrl.protocol !== "http:") {
      throw new Error(`Unsupported API_BASE_URL protocol: ${apiUrl.protocol}`);
    }

    resetApiState();
    server = app.listen(Number(apiUrl.port) || 80, apiUrl.hostname);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  },

  async afterAll() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  },
};
