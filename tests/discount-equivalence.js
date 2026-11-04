const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { randomInt } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "discount-equivalence-report.html");
const products = [
  { id: "product-1", name: "Canvas Tote Bag", priceCents: 2499 },
  { id: "product-2", name: "Ceramic Travel Mug", priceCents: 1899 },
  { id: "product-3", name: "Everyday Notebook", priceCents: 999 },
];

function money(cents) {
  return Number((cents / 100).toFixed(2));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key.toLowerCase() === "token" ? "[REDACTED]" : redact(child),
      ]),
    );
  }
  return value;
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForApi(baseUrl, processHandle) {
  const deadline = Date.now() + 15000;
  let lastError = "API did not become ready.";
  while (Date.now() < deadline) {
    if (processHandle?.exitCode !== null && processHandle?.exitCode !== undefined) {
      throw new Error(`API process exited with code ${processHandle.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/openapi.yaml`);
      if (response.ok) return;
      lastError = `Readiness endpoint returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API readiness timed out: ${lastError}`);
}

async function send(baseUrl, token, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const rawBody = await response.text();
  let responseBody;
  try {
    responseBody = JSON.parse(rawBody);
  } catch {
    responseBody = rawBody;
  }
  return { status: response.status, body: responseBody };
}

function renderReport({ generatedAt, baseUrl, cases, startup, fatalError }) {
  const passed = cases.filter((test) => test.status === "PASS").length;
  const failed = cases.length - passed;
  const caseRows = cases
    .map(
      (test) => `<section class="case ${test.status.toLowerCase()}">
        <h3>${escapeHtml(test.id)} — ${escapeHtml(test.partition)} <span class="badge">${test.status}</span></h3>
        <p><strong>Representative:</strong> <code>${escapeHtml(test.representative)}</code></p>
        <p><strong>Expected:</strong> ${escapeHtml(test.expectedSummary)}</p>
        <p><strong>Observed:</strong> ${escapeHtml(test.observedSummary || test.error || "No response")}</p>
        <details><summary>HTTP evidence</summary><pre>${escapeHtml(JSON.stringify(test.evidence || {}, null, 2))}</pre></details>
      </section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Discount Equivalence Partitioning Report</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #172033; background: #f4f6fa; }
    body { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
    header, .case, .summary { background: white; border: 1px solid #d8deea; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
    h1 { margin-bottom: .2rem; } h2 { margin-top: 1.8rem; }
    .summary { display: flex; gap: 2rem; flex-wrap: wrap; }
    .badge { float: right; border-radius: 1rem; padding: .1rem .7rem; font-size: .85rem; }
    .pass { border-left: 5px solid #218739; } .pass .badge { background: #e2f5e7; color: #17652a; }
    .fail { border-left: 5px solid #b42318; } .fail .badge { background: #ffebe9; color: #8e1c13; }
    code, pre { background: #f1f3f7; border-radius: 4px; } code { padding: .1rem .3rem; }
    pre { padding: 1rem; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
    table { border-collapse: collapse; width: 100%; background: white; }
    th, td { text-align: left; border: 1px solid #d8deea; padding: .6rem; }
  </style>
</head>
<body>
  <header>
    <h1>Discount Equivalence Partitioning</h1>
    <p>Generated ${escapeHtml(generatedAt)} · Target API: ${escapeHtml(baseUrl)}</p>
    <p>Design technique: equivalence partitioning only. No boundary-value, decision-table, or other test-design technique was used.</p>
    <p>Startup: <strong>${startup ? "PASS" : "FAIL"}</strong>${fatalError ? ` — ${escapeHtml(fatalError)}` : ""}</p>
  </header>
  <div class="summary">
    <div><strong>Test cases:</strong> ${cases.length}</div>
    <div><strong>Passed:</strong> ${passed}</div>
    <div><strong>Failed:</strong> ${failed}</div>
    <div><strong>Overall:</strong> ${failed === 0 && startup && !fatalError && cases.length === 3 ? "PASS" : "FAIL"}</div>
  </div>
  <h2>Equivalence classes and test evidence</h2>
  <table>
    <thead><tr><th>Class</th><th>Representative value</th><th>Expected behavior</th></tr></thead>
    <tbody>
      <tr><td>Valid cash method</td><td><code>cash</code></td><td>10% discount</td></tr>
      <tr><td>Valid credit-card method</td><td><code>credit_card</code></td><td>No discount</td></tr>
      <tr><td>Invalid payment method</td><td>Randomly selected unsupported value</td><td>HTTP 400; order rejected</td></tr>
    </tbody>
  </table>
  ${caseRows}
  <h2>Sampling and data</h2>
  <p>One representative was exercised from each payment-method partition. The valid method partitions each contain one specified enum value. The invalid representative was randomly selected from unsupported method names. Product IDs and quantities were randomly sampled from the README seed products (quantities 1–2), without reusing a product. Expected amounts are calculated in cents from the documented seed prices.</p>
  <p>Authentication used the README seed account. The password and bearer token are omitted/redacted from this report. Cash/card orders are successful API responses; the invalid-method 400 response is an expected negative result.</p>
  <h2>Execution details</h2>
  <p>Command: <code>npm run test:discount</code></p>
  <p>Assertions: API status code, order payment method, subtotal, discount, and total for valid classes; HTTP 400 for the invalid class.</p>
</body>
</html>`;
}

async function main() {
  const cases = [];
  let serverProcess;
  let baseUrl = process.env.API_BASE_URL;
  let startup = false;
  let fatalError;
  const startedAt = Date.now();

  try {
    if (!baseUrl) {
      const port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      serverProcess = spawn(process.execPath, [path.join(root, "src", "server.js")], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    await waitForApi(baseUrl, serverProcess);
    startup = true;

    const loginBody = { email: "alex@example.com", password: "DemoPass123!" };
    const login = await send(baseUrl, undefined, "/login", loginBody);
    assert.equal(login.status, 200, "Seed account login should succeed.");
    const token = login.body?.token;
    assert.equal(typeof token, "string", "Login should return a bearer token.");

    const currentYear = new Date().getFullYear();
    const cardResult = await send(baseUrl, token, "/card", {
      cardholderName: "Alex Morgan",
      last4: "4242",
      expiryMonth: 12,
      expiryYear: currentYear + 2,
    });
    assert.equal(cardResult.status, 201, "Saving demo card metadata should succeed.");
    const cardId = cardResult.body?.card?.id;
    assert.equal(typeof cardId, "string", "Saved card response should include an ID.");

    const available = [...products];
    const invalidValues = ["crypto", "voucher", "barter"];
    const casesToRun = [
      { id: "EP-1", partition: "Valid cash method", paymentMethod: "cash" },
      { id: "EP-2", partition: "Valid credit-card method", paymentMethod: "credit_card" },
      {
        id: "EP-3",
        partition: "Invalid payment method",
        paymentMethod: invalidValues[randomInt(invalidValues.length)],
      },
    ];

    for (const test of casesToRun) {
      const productIndex = randomInt(available.length);
      const product = available.splice(productIndex, 1)[0];
      const quantity = randomInt(1, 3);
      const requestBody = {
        items: [{ productId: product.id, quantity }],
        paymentMethod: test.paymentMethod,
        ...(test.paymentMethod === "credit_card" ? { cardId } : {}),
      };
      const subtotalCents = product.priceCents * quantity;
      const discountCents = test.paymentMethod === "cash" ? Math.round(subtotalCents * 0.1) : 0;
      const expectedStatus = test.paymentMethod === "cash" || test.paymentMethod === "credit_card" ? 201 : 400;
      const record = {
        ...test,
        representative: `${test.paymentMethod}; ${product.id} × ${quantity}`,
        expectedSummary:
          expectedStatus === 201
            ? `HTTP 201; subtotal ${money(subtotalCents).toFixed(2)}, discount ${money(discountCents).toFixed(2)}, total ${money(subtotalCents - discountCents).toFixed(2)}`
            : "HTTP 400; unsupported payment method is rejected",
        evidence: {
          request: { method: "POST", path: "/checkout", headers: { authorization: "Bearer [REDACTED]" }, body: requestBody },
        },
      };
      cases.push(record);
      try {
        const result = await send(baseUrl, token, "/checkout", requestBody);
        record.evidence.response = redact(result);
        assert.equal(result.status, expectedStatus, "Checkout should return the status for this partition.");
        if (expectedStatus === 201) {
          const order = result.body?.order;
          assert.equal(order?.paymentMethod, test.paymentMethod);
          assert.equal(order?.subtotal, money(subtotalCents));
          assert.equal(order?.discount, money(discountCents));
          assert.equal(order?.total, money(subtotalCents - discountCents));
          record.observedSummary = `HTTP ${result.status}; subtotal ${order.subtotal.toFixed(2)}, discount ${order.discount.toFixed(2)}, total ${order.total.toFixed(2)}`;
        } else {
          assert.equal(typeof result.body?.error, "string", "Rejected request should explain the failure.");
          record.observedSummary = `HTTP ${result.status}; ${result.body.error}`;
        }
        record.status = "PASS";
      } catch (error) {
        record.status = "FAIL";
        record.error = error.message;
      }
    }
  } catch (error) {
    fatalError = error.message;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
      await new Promise((resolve) => {
        serverProcess.once("exit", resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
    const html = renderReport({
      generatedAt: new Date().toISOString(),
      baseUrl: baseUrl || "not started",
      cases,
      startup,
      fatalError,
    });
    await fs.writeFile(reportPath, html, "utf8");
  }

  const passed = cases.filter((test) => test.status === "PASS").length;
  const failed = cases.length - passed;
  console.log(`API startup: ${startup ? "PASS" : "FAIL"} (${Date.now() - startedAt}ms)`);
  if (fatalError) console.error(`Setup failure: ${fatalError}`);
  for (const test of cases) {
    console.log(`${test.status || "FAIL"} ${test.id} ${test.partition}: ${test.observedSummary || test.error}`);
  }
  console.log(`Result: ${passed} passed, ${failed} failed. HTML report: ${reportPath}`);
  if (!startup || fatalError || failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
