const { expect } = require("chai");
const request = require("supertest");

const api = request(process.env.API_BASE_URL);

async function login() {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD in .env before running the tests.");
  }

  const response = await api.post("/login").send({ email, password });
  expect(response.status, "demo-user login status").to.equal(200);
  expect(response.body.token, "demo-user bearer token").to.be.a("string").and.not.empty;
  return response.body.token;
}

async function saveDemoCard(token) {
  const response = await api
    .post("/card")
    .set("Authorization", `Bearer ${token}`)
    .send({
      cardholderName: "Alex Morgan",
      last4: "4242",
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
    });
  expect(response.status, "save demo card status").to.equal(201);
  expect(response.body.card.id, "saved card ID").to.be.a("string").and.not.empty;
  return response.body.card.id;
}

module.exports = { api, login, saveDemoCard };
