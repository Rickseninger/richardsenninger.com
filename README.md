# RichardLSenninger.com

Personal brand authority site for Richard L. Senninger — Clinical Hypnotherapist, Author, Speaker, and Consciousness Researcher.

Express + static HTML/CSS/JS, with integrated Stripe checkout, Printify-backed merch, and a Brevo newsletter signup.

## Stack

- **Backend:** Node 20 + Express 4
- **Frontend:** vanilla HTML/CSS/JS (no build step)
- **Integrations:** Stripe (checkout), Printify (POD products), Brevo (newsletter)
- **Container:** Dockerfile, deployable to Railway / any container host

## Local development

```bash
# 1. Copy env template and fill in real keys
cp .env.example .env
# (edit .env — never commit this file)

# 2. Install deps
npm install

# 3. Run dev server (auto-reloads on changes)
npm run dev

# Server runs at http://localhost:3456
```

## Railway deployment

1. Connect this GitHub repo to a new Railway project — Railway will auto-detect the Dockerfile and build.
2. In **Variables** → add every key from `.env.example` (paste real values, never the placeholders).
3. Railway sets `PORT` automatically — the server already binds to `process.env.PORT`.
4. Generate a Railway-provided domain or attach a custom domain in **Settings** → **Networking**.

### Required environment variables

See [`.env.example`](.env.example) for the full list. Critical for first deploy:

- `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` (store checkout)
- `BREVO_API_KEY` + `BREVO_LIST_ID` (newsletter / "Inspired Thinking" toast)
- `PRINTIFY_API_KEY` + `PRINTIFY_SHOP_ID` (merch listings — optional, store falls back to manual products if absent)

## Repo layout

```
.
├── server.js              # Express server + all API routes
├── products.json          # Manual product catalogue + free downloads
├── package.json
├── Dockerfile             # Railway build target
├── .env.example           # Env var documentation
└── site/                  # Static frontend
    ├── index.html         # Home
    ├── meet-rick.html
    ├── speaker-media.html # Media (speaker bookings)
    ├── podcasts-video.html # TIPTV (podcasts + video)
    ├── books-store.html   # Store
    ├── contact.html
    ├── css/styles.css
    ├── js/
    │   ├── animations.js  # Hero canvas, nav indicator, scroll anims, toast
    │   └── store.js       # Cart + checkout + product rendering
    └── images/
```

## API surface (Express routes)

- `GET  /api/config`              — Stripe publishable key (so frontend never hardcodes it)
- `GET  /api/products`            — manual + Printify products + free downloads
- `POST /api/create-payment-intent` — Stripe checkout
- `POST /api/subscribe`           — Brevo newsletter signup
- `POST /api/printify-webhook`    — Stripe webhook for order fulfillment

## Notes

- `products.json` is loaded once at startup. Edits require a server restart (Railway redeploy triggers this automatically on each git push).
- The store frontend cache-busts `/api/products` per page load, so admin edits to `products.json` appear immediately on the next deploy.
