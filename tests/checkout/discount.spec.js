const { expect } = require("chai");
const cases = require("../data/discount-cases.json");
const { api, login, saveDemoCard } = require("../helpers/auth");

describe("Checkout discount equivalence partitions", function () {
  for (const testCase of cases) {
    it(testCase.title, async function () {
      const token = await login();
      const payload = {
        items: testCase.items,
        paymentMethod: testCase.paymentMethod,
      };

      if (testCase.requiresSavedCard) {
        payload.cardId = await saveDemoCard(token);
      }

      const response = await api
        .post("/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send(payload);

      expect(response.status, `${testCase.partition} response status`).to.equal(testCase.expectedStatus);

      if (testCase.expectedStatus === 201) {
        expect(response.body.order).to.include({
          paymentMethod: testCase.paymentMethod,
          subtotal: testCase.expectedSubtotal,
          discount: testCase.expectedDiscount,
          total: testCase.expectedTotal,
        });
      } else {
        expect(response.body.error).to.include(testCase.expectedError);
      }
    });
  }
});
