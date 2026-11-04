const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require("node:crypto");
const path = require("node:path");
const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;
const openApiPath = path.join(__dirname, "..", "openapi.yaml");

app.use(express.json({ limit: "10kb" }));

const products = [
  { id: "product-1", name: "Canvas Tote Bag", priceCents: 2499, stock: 20 },
  { id: "product-2", name: "Ceramic Travel Mug", priceCents: 1899, stock: 15 },
  { id: "product-3", name: "Everyday Notebook", priceCents: 999, stock: 30 },
];

const users = [];
const cards = [];
const orders = [];
const sessions = new Map();

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function addSeedUser(id, name, email, password) {
  users.push({
    id,
    name,
    email,
    ...hashPassword(password),
  });
}

addSeedUser("user-1", "Alex Morgan", "alex@example.com", "DemoPass123!");
addSeedUser("user-2", "Jamie Lee", "jamie@example.com", "DemoPass123!");
addSeedUser("user-3", "Taylor Kim", "taylor@example.com", "DemoPass123!");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function createSession(user) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, user.id);
  return token;
}

function requireAuthentication(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]+)$/i.exec(authorization);
  const userId = match && sessions.get(match[1]);
  const user = userId && users.find((candidate) => candidate.id === userId);

  if (!user) {
    return res.status(401).json({ error: "A valid bearer token is required." });
  }

  req.user = user;
  return next();
}

function sendBadRequest(res, message) {
  return res.status(400).json({ error: message });
}

function formatMoney(cents) {
  return Number((cents / 100).toFixed(2));
}

app.post("/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    return sendBadRequest(res, "Provide a name, valid email, and password of at least 8 characters.");
  }

  if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const user = {
    id: randomUUID(),
    name: name.trim(),
    email: email.trim(),
    ...hashPassword(password),
  };
  users.push(user);
  return res.status(201).json({ user: publicUser(user), token: createSession(user) });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return sendBadRequest(res, "Provide an email and password.");
  }

  const user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const actualHash = scryptSync(password, user.salt, 64);
  const expectedHash = Buffer.from(user.hash, "hex");
  if (!timingSafeEqual(actualHash, expectedHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  return res.json({ user: publicUser(user), token: createSession(user) });
});

app.post("/card", requireAuthentication, (req, res) => {
  const { cardholderName, last4, expiryMonth, expiryYear } = req.body || {};
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  if (
    typeof cardholderName !== "string" ||
    !cardholderName.trim() ||
    typeof last4 !== "string" ||
    !/^\d{4}$/.test(last4) ||
    !Number.isInteger(expiryMonth) ||
    expiryMonth < 1 ||
    expiryMonth > 12 ||
    !Number.isInteger(expiryYear) ||
    expiryYear < currentYear ||
    (expiryYear === currentYear && expiryMonth < currentMonth)
  ) {
    return sendBadRequest(res, "Provide a cardholder name, last four digits, and a valid future expiry date.");
  }

  const card = {
    id: randomUUID(),
    userId: req.user.id,
    cardholderName: cardholderName.trim(),
    last4,
    expiryMonth,
    expiryYear,
  };
  cards.push(card);

  return res.status(201).json({
    card: {
      id: card.id,
      cardholderName: card.cardholderName,
      last4: card.last4,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
    },
  });
});

app.post("/checkout", requireAuthentication, (req, res) => {
  const { items, paymentMethod, cardId } = req.body || {};
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some(
      (item) =>
        !item ||
        typeof item.productId !== "string" ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return sendBadRequest(res, "Provide at least one item with a productId and a positive integer quantity.");
  }
  if (paymentMethod !== "cash" && paymentMethod !== "credit_card") {
    return sendBadRequest(res, 'paymentMethod must be either "cash" or "credit_card".');
  }

  let paymentCard;
  if (paymentMethod === "credit_card") {
    paymentCard = cards.find((card) => card.id === cardId && card.userId === req.user.id);
    if (!paymentCard) {
      return sendBadRequest(res, "Provide a saved card belonging to the authenticated user.");
    }
  }

  const quantities = new Map();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  }

  const orderItems = [];
  let subtotalCents = 0;
  for (const [productId, quantity] of quantities) {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) {
      return sendBadRequest(res, `Unknown product: ${productId}.`);
    }
    if (product.stock < quantity) {
      return res.status(409).json({ error: `Insufficient stock for ${product.name}.` });
    }

    const lineTotalCents = product.priceCents * quantity;
    subtotalCents += lineTotalCents;
    orderItems.push({
      productId: product.id,
      name: product.name,
      quantity,
      unitPrice: formatMoney(product.priceCents),
      lineTotal: formatMoney(lineTotalCents),
    });
  }

  const discountCents = paymentMethod === "cash" ? Math.round(subtotalCents * 0.1) : 0;
  for (const [productId, quantity] of quantities) {
    products.find((product) => product.id === productId).stock -= quantity;
  }

  const order = {
    id: randomUUID(),
    userId: req.user.id,
    items: orderItems,
    paymentMethod,
    subtotal: formatMoney(subtotalCents),
    discount: formatMoney(discountCents),
    total: formatMoney(subtotalCents - discountCents),
    ...(paymentCard ? { cardLast4: paymentCard.last4 } : {}),
    createdAt: new Date().toISOString(),
  };
  orders.push(order);

  return res.status(201).json({ order });
});

app.get("/openapi.yaml", (req, res, next) => {
  res.type("application/yaml").sendFile(openApiPath, (error) => {
    if (error) next(error);
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return sendBadRequest(res, "Request body must contain valid JSON.");
  }
  console.error(error);
  return res.status(500).json({ error: "Internal server error." });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Checkout API listening on http://localhost:${port}`);
  });
}

module.exports = { app, products, users, cards, orders, sessions };
