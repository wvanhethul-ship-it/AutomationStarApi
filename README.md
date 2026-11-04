# AutomationStar Checkout API

A small E-commerce REST API built with Express and JavaScript. It uses in-memory arrays for users, saved card metadata, products, inventory, and orders. All data resets when the server restarts.

## Requirements

- Node.js 18 or newer
- npm

## Run

```bash
npm install
npm start
```

The API listens on `http://localhost:3000` (override the port with `PORT`).

## Endpoints

The four business endpoints are `POST /register`, `POST /login`, `POST /card`, and `POST /checkout`. The OpenAPI 3.0.3 YAML document is served separately at `GET /openapi.yaml`.

All endpoints accept and return JSON except `/openapi.yaml`. `/card` and `/checkout` require the bearer token returned by registration or login:

```http
Authorization: Bearer <token>
```

### Seed data

| Product ID | Product | Price | Initial stock |
| --- | --- | ---: | ---: |
| `product-1` | Canvas Tote Bag | $24.99 | 20 |
| `product-2` | Ceramic Travel Mug | $18.99 | 15 |
| `product-3` | Everyday Notebook | $9.99 | 30 |

| Email | Password |
| --- | --- |
| `alex@example.com` | `DemoPass123!` |
| `jamie@example.com` | `DemoPass123!` |
| `taylor@example.com` | `DemoPass123!` |

These credentials are for local demonstration only. Passwords are hashed in memory with Node.js `scrypt`.

### Register and log in

`POST /register` expects `name`, `email`, and a password of at least 8 characters. `POST /login` expects `email` and `password`. Both return a public user object and a bearer token.

```json
{
  "name": "Casey Example",
  "email": "casey@example.com",
  "password": "ExamplePass123!"
}
```

### Save card metadata

`POST /card` expects `cardholderName`, `last4`, `expiryMonth`, and `expiryYear`. It returns a `card.id` for checkout. This demo does not process payments and intentionally does not accept or store a full card number or CVV.

### Checkout

`POST /checkout` expects `items` (product IDs and positive quantities) and `paymentMethod` (`cash` or `credit_card`). For `credit_card`, include the ID of a saved card belonging to the authenticated user.

```json
{
  "items": [
    { "productId": "product-1", "quantity": 2 },
    { "productId": "product-3", "quantity": 1 }
  ],
  "paymentMethod": "cash"
}
```

Cash orders receive a 10% discount; credit-card orders do not. Checkout validates the complete order and stock before updating inventory.

## Scope and limitations

This is a local/demo API, not a production payment or identity service. Data and bearer tokens exist only in process memory; use TLS, a persistent database, proper session expiry, and a payment provider before production use.
