require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3456;
const BASE_DIR = path.join(__dirname, 'site');

// Gzip all responses
app.use(compression());

// ---------------------------------------------------------------------------
// Stripe setup — lazy init so missing key doesn't crash on startup
// ---------------------------------------------------------------------------
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === 'your_stripe_secret_key_here' || key.includes('your_stripe')) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    _stripe = require('stripe')(key);
  }
  return _stripe;
}

// ---------------------------------------------------------------------------
// Printify helpers
// ---------------------------------------------------------------------------
const PRINTIFY_BASE = 'https://api.printify.com/v1';

function printifyHeaders() {
  return {
    Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Resolve shop ID — use env var if set, otherwise fetch the first shop
let resolvedShopId = process.env.PRINTIFY_SHOP_ID || null;

async function getShopId() {
  if (resolvedShopId) return resolvedShopId;

  const res = await fetch(`${PRINTIFY_BASE}/shops.json`, { headers: printifyHeaders() });
  if (!res.ok) throw new Error(`Printify shops: ${res.status}`);
  const shops = await res.json();
  if (!shops || shops.length === 0) throw new Error('No Printify shops found for this API key');
  resolvedShopId = String(shops[0].id);
  console.log(`Printify shop auto-detected: "${shops[0].title}" (id: ${resolvedShopId})`);
  return resolvedShopId;
}

// Determine category from product title / tags
function detectCategory(title, tags) {
  const text = [title, ...(tags || [])].join(' ').toLowerCase();
  if (text.includes('mug') || text.includes('cup') || text.includes('tumbler') || text.includes('bottle')) {
    return 'Drinkware';
  }
  if (
    text.includes('shirt') || text.includes('hoodie') || text.includes('tee') ||
    text.includes('tank') || text.includes('sweatshirt') || text.includes('jacket') ||
    text.includes('apparel') || text.includes('hat') || text.includes('cap')
  ) {
    return 'Apparel';
  }
  if (text.includes('book') || text.includes('journal') || text.includes('notebook') || text.includes('guide')) {
    return 'Books';
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// Product caches
// ---------------------------------------------------------------------------
let printifyCache = { products: [], timestamp: 0 };
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Manual products / free downloads — loaded once at startup, stable until restart
let manualCache = { products: [], freeDownloads: [], loaded: false };

function loadManualProducts() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8');
    const data = JSON.parse(raw);
    manualCache.products = (data.products || []).map((p) => ({ ...p, source: 'manual' }));
    manualCache.freeDownloads = data.freeDownloads || [];
    manualCache.loaded = true;
  } catch (err) {
    console.error('[products.json] Failed to load — using empty catalogue:', err.message);
  }
}

// ---------------------------------------------------------------------------
// In-memory order store — primary source for webhook order data
// Avoids Stripe's 500-char metadata limit. Metadata kept as fallback only.
// Entries auto-expire after 24 h to prevent memory creep.
// ---------------------------------------------------------------------------
const pendingOrders = new Map();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of pendingOrders.entries()) {
    if (val.createdAt < cutoff) pendingOrders.delete(key);
  }
}, 60 * 60 * 1000);

async function warmImageProxyCache(products) {
  let warmed = 0;
  for (const product of products) {
    for (const img of (product.allImages || []).slice(0, 8)) {
      const url = img.thumb;
      if (!url || !url.startsWith('https://images.printify.com/') || imageProxyCache.has(url)) continue;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          imageProxyCache.set(url, { buf, contentType: res.headers.get('content-type') || 'image/jpeg', ts: Date.now() });
          warmed++;
        }
      } catch { /* skip */ }
      // Gentle throttle — avoid hammering Printify CDN
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  console.log(`[ImageProxy] Warmed ${warmed} thumbnail images`);
}

async function fetchPrintifyProducts() {
  const apiKey = process.env.PRINTIFY_API_KEY;
  if (!apiKey || apiKey === 'your_printify_api_key_here') {
    console.warn('[Printify] PRINTIFY_API_KEY is not set — skipping product fetch');
    return [];
  }
  console.log('[Printify] Fetching products from Printify API...');

  // Load whitelist from products.json (empty = show all)
  let whitelist = [];
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8');
    whitelist = JSON.parse(raw).printifyWhitelist || [];
  } catch { /* ignore */ }

  try {
    const shopId = await getShopId();

    // Fetch all published products (paginated — grab up to 6 pages / 300 products)
    let allProducts = [];
    let page = 1;
    const limit = 50; // Printify max is 50 per page

    while (page <= 6) {
      const res = await fetch(
        `${PRINTIFY_BASE}/shops/${shopId}/products.json?limit=${limit}&page=${page}`,
        { headers: printifyHeaders() }
      );
      if (!res.ok) throw new Error(`Printify products page ${page}: ${res.status}`);
      const data = await res.json();
      const items = data.data || [];
      allProducts = allProducts.concat(items);
      if (page >= (data.last_page || 1)) break;
      page++;
    }

    const products = [];
    for (const item of allProducts) {
      try {
        // Skip products not in the whitelist
        if (whitelist.length > 0 && !whitelist.includes(String(item.id))) continue;

        const variants = (item.variants || [])
          .filter((v) => v.is_enabled === true && v.is_available !== false)
          .map((v) => ({
            id: v.id,
            name: v.title,
            retailPrice: v.price / 100, // Printify prices are in cents
            sku: v.sku || '',
            currency: 'USD',
          }));

        if (variants.length === 0) continue;

        const prices = variants.map((v) => v.retailPrice).filter(Boolean);
        const displayPrice = prices.length > 0 ? Math.min(...prices) : 0;

        // All images with variant associations for gallery/color switching
        const allImages = (item.images || []).map((img) => ({
          src: img.src,
          thumb: img.src + '?w=480',   // smaller for grid cards
          variantIds: img.variant_ids || [],
          isDefault: img.is_default || false,
          position: img.position || '',
        }));
        const firstImage = allImages.length > 0 ? allImages[0].src : '';
        const firstThumb = allImages.length > 0 ? allImages[0].thumb : '';

        products.push({
          id: `printify-${item.id}`,
          source: 'printify',
          printifyId: item.id,
          title: item.title,
          description: (item.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
          price: displayPrice,
          images: firstImage ? [firstImage] : [],
          thumbs: firstThumb ? [firstThumb] : [],
          allImages: allImages,
          category: detectCategory(item.title, item.tags),
          variants,
          inStock: true,
        });
      } catch {
        // Skip individual product failures
      }
    }

    console.log(`[Printify] Loaded ${products.length} products (whitelist: ${whitelist.length})`);

    // Warm image proxy cache in background — so first visitor never hits cold CDN
    setImmediate(() => warmImageProxyCache(products));

    return products;
  } catch (err) {
    console.error('[Printify] API error:', err.message);
    return null; // null signals failure — keep stale cache
  }
}

async function getProducts() {
  const now = Date.now();

  // Refresh Printify cache if stale
  if (now - printifyCache.timestamp > CACHE_TTL) {
    const fresh = await fetchPrintifyProducts();
    if (fresh !== null) {
      printifyCache = { products: fresh, timestamp: now };
    }
    // If fresh is null (API error), keep stale cache
  }

  if (!manualCache.loaded) loadManualProducts();

  return {
    products: [...printifyCache.products, ...manualCache.products],
    freeDownloads: manualCache.freeDownloads,
  };
}

// Load all product data into memory at startup
loadManualProducts();
getProducts().then(() => console.log('Product cache initialized'));

// ---------------------------------------------------------------------------
// Stripe webhook — must be before express.json() for raw body
// ---------------------------------------------------------------------------
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const metadata = paymentIntent.metadata || {};
      console.log('Payment succeeded:', paymentIntent.id);

      // Resolve order data from in-memory store.
      // NOTE: metadata no longer carries full order data (only orderRef for
      // tracing). If the server restarted between checkout and webhook delivery
      // the entry will be missing — log clearly so it can be fulfilled manually.
      const stored = pendingOrders.get(paymentIntent.id);
      if (stored) pendingOrders.delete(paymentIntent.id);

      if (!stored) {
        console.error(
          `ALERT: No order data found for payment ${paymentIntent.id} ` +
          `(ref: ${metadata.orderRef || 'none'}) — server may have restarted. ` +
          `MANUAL FULFILLMENT REQUIRED.`
        );
      }

      const printifyItemsRaw = stored ? stored.printifyItems : [];
      const shippingData = stored ? stored.shipping : {};

      // SAFETY GUARD: Printify has no test/sandbox environment. Every Printify order
      // is real, charges the merchant, and ships. When Stripe is in test mode (any key
      // starting with sk_test_), we MUST NOT create Printify orders — log the would-be
      // order so QA flows still complete visually, but no real fulfillment fires.
      const isStripeTestMode = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
      if (isStripeTestMode) {
        console.log(
          `[TEST MODE] Stripe is in test mode — SKIPPING Printify order creation. ` +
          `Items that WOULD have been ordered:`,
          JSON.stringify(printifyItemsRaw || [], null, 2)
        );
      }

      // Create Printify order for POD items
      const apiKey = process.env.PRINTIFY_API_KEY;
      if (
        !isStripeTestMode &&
        printifyItemsRaw && printifyItemsRaw.length > 0 &&
        apiKey &&
        apiKey !== 'your_printify_api_key_here'
      ) {
        try {
          const shopId = await getShopId();

          // Split shipping name into first/last — default lastName to '' not firstName
          const nameParts = (shippingData.name || '').trim().split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          const orderPayload = {
            label: `RLS-${paymentIntent.id}`,
            line_items: printifyItemsRaw.map((item) => ({
              product_id: item.productId,
              variant_id: Number(item.variantId),
              quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
            })),
            shipping_method: 1, // standard shipping
            address_to: {
              first_name: firstName,
              last_name: lastName,
              email: shippingData.email || '',
              phone: shippingData.phone || '',
              country: shippingData.country || 'US',
              region: shippingData.state || '',
              address1: shippingData.address || '',
              city: shippingData.city || '',
              zip: shippingData.zip || '',
            },
          };

          const pfRes = await fetch(`${PRINTIFY_BASE}/shops/${shopId}/orders.json`, {
            method: 'POST',
            headers: printifyHeaders(),
            body: JSON.stringify(orderPayload),
          });

          if (pfRes.ok) {
            const order = await pfRes.json();
            console.log('Printify order created:', order.id, 'for payment:', paymentIntent.id);

            // Auto-submit to production — without this orders sit in pending,
            // no customer confirmation email, and no tracking email.
            // Retry up to 3 times with backoff before giving up.
            let prodOk = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
              if (attempt > 1) await new Promise((r) => setTimeout(r, attempt * 1000));
              const prodRes = await fetch(
                `${PRINTIFY_BASE}/shops/${shopId}/orders/${order.id}/send_to_production.json`,
                { method: 'POST', headers: printifyHeaders() }
              );
              if (prodRes.ok) {
                console.log('Printify order sent to production:', order.id);
                prodOk = true;
                break;
              }
              const prodErr = await prodRes.text();
              console.error(`Printify send_to_production attempt ${attempt} failed:`, prodErr);
            }
            if (!prodOk) {
              console.error(
                `ALERT: Printify order ${order.id} (payment ${paymentIntent.id}) ` +
                `failed to send_to_production after 3 attempts — MANUAL ACTION REQUIRED`
              );
            }
          } else {
            const errBody = await pfRes.text();
            console.error('Printify order creation failed:', errBody, '| payment:', paymentIntent.id);
          }
        } catch (err) {
          console.error('Printify order creation error:', err.message, '| payment:', paymentIntent.id);
        }
      }

      // Manual items — fulfillment handled outside the system
      if (metadata.manualItems) {
        console.log('Manual items to fulfill:', metadata.manualItems);
      }
    }

    res.json({ received: true });
  }
);

// ---------------------------------------------------------------------------
// Printify webhook (order status updates)
// ---------------------------------------------------------------------------
app.post('/api/webhooks/printify', express.json(), (req, res) => {
  console.log('Printify webhook event:', req.body.type, req.body.resource);
  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// JSON body parsing for remaining routes
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// Return Stripe publishable key to frontend — only send valid pk_ keys
app.get('/api/config', (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || '';
  const validKey = (key.startsWith('pk_live_') || key.startsWith('pk_test_')) ? key : null;
  res.json({ publishableKey: validKey });
});

// Safe status/diagnostic endpoint — shows config state without exposing secrets
app.get('/api/status', async (req, res) => {
  const printifyKey = process.env.PRINTIFY_API_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  const status = {
    printify: {
      keySet: !!(printifyKey && printifyKey !== 'your_printify_api_key_here'),
      shopId: resolvedShopId || 'not resolved yet',
      cachedProducts: printifyCache.products.length,
      cacheAge: printifyCache.timestamp
        ? Math.round((Date.now() - printifyCache.timestamp) / 1000) + 's ago'
        : 'never loaded',
    },
    stripe: {
      keySet: !!(stripeKey && !stripeKey.includes('your_stripe')),
    },
    node: process.version,
    uptime: Math.round(process.uptime()) + 's',
  };

  // If Printify key is set but cache is empty, try a live fetch now
  if (status.printify.keySet && printifyCache.products.length === 0) {
    try {
      const shopId = await getShopId();
      status.printify.shopId = shopId;
      status.printify.liveShopTest = 'shop ID resolved OK';
    } catch (err) {
      status.printify.liveShopTest = 'ERROR: ' + err.message;
    }
  }

  res.json(status);
});

// Force-refresh Printify cache — requires REFRESH_TOKEN env var to prevent abuse.
// If REFRESH_TOKEN is not set the endpoint is blocked entirely.
app.get('/api/refresh-products', async (req, res) => {
  const token = process.env.REFRESH_TOKEN;
  if (!token || req.query.token !== token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    printifyCache.timestamp = 0; // Invalidate cache
    const data = await getProducts();
    res.json({ ok: true, productCount: data.products.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// YouTube live status — checks if Rick is currently streaming on @Tiphypnosis
// ---------------------------------------------------------------------------
// Uses channels.list + playlistItems.list + videos.list (with
// liveStreamingDetails) instead of search.list, because search.list has a
// 10–30 min indexing lag. The uploads-playlist route picks up streams within
// seconds and costs only ~2 quota units per check (vs 100 for search).
const YT_HANDLE = 'Tiphypnosis';
let ytChannelDataCache = null;
let ytLiveCache = { data: null, timestamp: 0 };
const YT_LIVE_TTL = 90 * 1000;

async function resolveYouTubeChannel(apiKey) {
  if (ytChannelDataCache) return ytChannelDataCache;
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=%40${encodeURIComponent(YT_HANDLE)}&key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube channel resolve failed: ${r.status}`);
  const data = await r.json();
  const item = data.items && data.items[0];
  if (!item) throw new Error('YouTube channel handle could not be resolved');
  ytChannelDataCache = {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
  console.log(`[YT] Resolved @${YT_HANDLE} -> channel=${item.id}`);
  return ytChannelDataCache;
}

app.get('/api/youtube/live', async (req, res) => {
  const apiKey = process.env.GOOGLE_API_KEY;
  const forceRefresh = req.query.refresh === '1';
  const debug = req.query.debug === '1';
  if (!apiKey) {
    return res.set('Cache-Control', 'public, max-age=60').json({ live: false });
  }

  const now = Date.now();
  if (!forceRefresh && !debug && ytLiveCache.data && now - ytLiveCache.timestamp < YT_LIVE_TTL) {
    return res.set('Cache-Control', 'public, max-age=60').json(ytLiveCache.data);
  }

  try {
    const { uploadsPlaylistId } = await resolveYouTubeChannel(apiKey);

    // Step 1: latest 5 uploads (catches a live stream within seconds of starting)
    const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=5&key=${encodeURIComponent(apiKey)}`;
    const plRes = await fetch(plUrl);
    if (!plRes.ok) throw new Error(`playlistItems failed: ${plRes.status}`);
    const plData = await plRes.json();
    const videoIds = (plData.items || []).map(i => i.contentDetails.videoId).filter(Boolean);

    if (!videoIds.length) {
      const payload = { live: false };
      ytLiveCache = { data: payload, timestamp: now };
      return res.set('Cache-Control', 'public, max-age=60').json(payload);
    }

    // Step 2: which (if any) is currently live
    const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoIds.join(',')}&key=${encodeURIComponent(apiKey)}`;
    const vRes = await fetch(vUrl);
    if (!vRes.ok) throw new Error(`videos.list failed: ${vRes.status}`);
    const vData = await vRes.json();

    const liveItem = (vData.items || []).find(v => {
      const d = v.liveStreamingDetails;
      return d && d.actualStartTime && !d.actualEndTime;
    });

    const payload = liveItem
      ? {
          live: true,
          videoId: liveItem.id,
          title: liveItem.snippet.title,
          thumbnail: ((liveItem.snippet.thumbnails || {}).maxres
                   || (liveItem.snippet.thumbnails || {}).high
                   || (liveItem.snippet.thumbnails || {}).default || {}).url || null,
          watchUrl: `https://www.youtube.com/watch?v=${liveItem.id}`,
          startedAt: liveItem.liveStreamingDetails.actualStartTime,
        }
      : { live: false };

    ytLiveCache = { data: payload, timestamp: now };
    res.set('Cache-Control', 'public, max-age=60').json(payload);
  } catch (err) {
    console.error('[YT] live check error:', err.message);
    res.set('Cache-Control', 'no-store').json(ytLiveCache.data || { live: false });
  }
});

// Google Calendar events
let gcalCache = { events: [], timestamp: 0 };
const GCAL_TTL = 15 * 60 * 1000;

app.get('/api/events', async (req, res) => {
  const apiKey    = process.env.GOOGLE_API_KEY;
  const calId     = process.env.GOOGLE_CALENDAR_ID;

  if (!apiKey || !calId) {
    console.warn('[GCal] GOOGLE_API_KEY or GOOGLE_CALENDAR_ID not set — returning empty events');
    return res.set('Cache-Control', 'public, max-age=60').json({ events: [] });
  }

  const now = Date.now();
  if (now - gcalCache.timestamp < GCAL_TTL) {
    return res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600').json({ events: gcalCache.events });
  }

  try {
    const timeMin = new Date().toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
      `?key=${encodeURIComponent(apiKey)}&timeMin=${encodeURIComponent(timeMin)}` +
      `&orderBy=startTime&singleEvents=true&maxResults=20`;

    const gcalRes = await fetch(url);
    if (!gcalRes.ok) {
      const body = await gcalRes.text();
      throw new Error(`Google Calendar API ${gcalRes.status}: ${body.substring(0, 200)}`);
    }

    const data   = await gcalRes.json();
    const events = (data.items || []).map((item) => ({
      id:          item.id,
      title:       item.summary || 'Rick Senninger Event',
      start:       item.start.dateTime || item.start.date,
      end:         item.end ? (item.end.dateTime || item.end.date) : null,
      location:    item.location || '',
      description: item.description
        ? item.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        : '',
      url:         item.htmlLink || '',
    }));

    gcalCache = { events, timestamp: now };
    console.log(`[GCal] Loaded ${events.length} upcoming events`);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ events });
  } catch (err) {
    console.error('[GCal] Events fetch error:', err.message);
    res.set('Cache-Control', 'no-store');
    res.json({ events: gcalCache.events }); // return stale if available
  }
});

// ---------------------------------------------------------------------------
// Printify image proxy — caches CDN images on Railway to eliminate per-request
// Printify CDN latency for store visitors
// ---------------------------------------------------------------------------
const imageProxyCache = new Map(); // url → { buf, contentType, ts }
const PROXY_TTL  = 24 * 60 * 60 * 1000; // 24 h
const PROXY_MAX  = 300; // max cached images

app.get('/api/image-proxy', async (req, res) => {
  const url = req.query.url;

  // Strict allowlist — only proxy Printify CDN images
  if (
    !url ||
    !url.startsWith('https://images.printify.com/') ||
    url.length > 512
  ) {
    return res.status(400).end();
  }

  const now = Date.now();
  const cached = imageProxyCache.get(url);
  if (cached && now - cached.ts < PROXY_TTL) {
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('Content-Type', cached.contentType);
    return res.send(cached.buf);
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      // Fall back to redirect so the browser still gets the image
      return res.redirect(302, url);
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());

    // Evict oldest entry when cache is full
    if (imageProxyCache.size >= PROXY_MAX) {
      let oldest = null;
      let oldestTs = Infinity;
      for (const [k, v] of imageProxyCache) {
        if (v.ts < oldestTs) { oldestTs = v.ts; oldest = k; }
      }
      if (oldest) imageProxyCache.delete(oldest);
    }

    imageProxyCache.set(url, { buf, contentType, ts: now });

    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('Content-Type', contentType);
    res.send(buf);
  } catch (err) {
    console.error('[ImageProxy] Error fetching', url, err.message);
    res.redirect(302, url); // graceful fallback
  }
});

// Newsletter signup — adds subscriber to Brevo
app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[Brevo] BREVO_API_KEY not set — subscriber not added:', email);
    return res.json({ ok: true }); // degrade gracefully until key is configured
  }

  try {
    const body = { email, updateEnabled: true };
    const listId = process.env.BREVO_LIST_ID;
    if (listId) body.listIds = [Number(listId)];

    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 204 = updated existing contact, 201 = created new — both are success
    if (brevoRes.status === 201 || brevoRes.status === 204) {
      return res.json({ ok: true });
    }

    const errText = await brevoRes.text();
    console.error('[Brevo] Subscribe error:', brevoRes.status, errText);
    res.status(500).json({ ok: false, error: 'Could not complete subscription. Please try again.' });
  } catch (err) {
    console.error('[Brevo] Subscribe fetch error:', err.message);
    res.status(500).json({ ok: false, error: 'Could not complete subscription. Please try again.' });
  }
});

// Product listing
app.get('/api/products', async (req, res) => {
  try {
    const data = await getProducts();
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ products: data.products, freeDownloads: data.freeDownloads });
  } catch (err) {
    console.error('Products fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// Create Stripe PaymentIntent
app.post('/api/checkout', async (req, res) => {
  try {
    const { items, shipping } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate and recalculate prices server-side
    const allData = await getProducts();
    const allProducts = allData.products;
    const productMap = {};
    for (const p of allProducts) {
      productMap[p.id] = p;
    }

    let totalCents = 0;
    const printifyItems = [];
    const manualItems = [];

    for (const cartItem of items) {
      const product = productMap[cartItem.id];
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${cartItem.id}` });
      }

      let price = product.price;

      // If a specific variant is selected, use its price
      if (cartItem.variantId && product.variants) {
        const variant = product.variants.find((v) => String(v.id) === String(cartItem.variantId));
        if (variant) price = variant.retailPrice;
      }

      const qty = Math.max(1, parseInt(cartItem.quantity, 10) || 1);
      totalCents += Math.round(price * 100) * qty;

      if (product.source === 'printify') {
        printifyItems.push({
          productId: product.printifyId,
          variantId: cartItem.variantId,
          quantity: qty,
        });
      } else {
        manualItems.push({
          id: product.id,
          title: product.title,
          quantity: qty,
        });
      }
    }

    if (totalCents < 50) {
      return res.status(400).json({ error: 'Order total must be at least $0.50' });
    }

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      // Metadata kept as a fallback only — primary order data stored in
      // pendingOrders map to avoid Stripe's 500-char per-value limit.
      metadata: {
        orderRef: `RLS-${Date.now()}`,
      },
    });

    // Store full order data server-side keyed by payment intent ID
    pendingOrders.set(paymentIntent.id, {
      printifyItems,
      manualItems,
      shipping: shipping || {},
      createdAt: Date.now(),
    });

    res.json({ clientSecret: paymentIntent.client_secret, total: totalCents });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Static file serving — must come AFTER API routes
// ---------------------------------------------------------------------------
// Long cache for versioned assets (images, audio, fonts)
app.use('/images', express.static(path.join(BASE_DIR, 'images'), {
  maxAge: '30d',
  immutable: true,
}));
app.use('/audio', express.static(path.join(BASE_DIR, 'audio'), {
  maxAge: '30d',
  immutable: true,
}));
// Medium cache for CSS/JS (may change between deploys)
app.use('/css', express.static(path.join(BASE_DIR, 'css'), {
  maxAge: '7d',
}));
app.use('/js', express.static(path.join(BASE_DIR, 'js'), {
  maxAge: '7d',
}));
// PDFs / docs — moderate cache
app.use(express.static(BASE_DIR, {
  extensions: ['html'],
  maxAge: '1h',
}));

// Fallback — serve index.html for page routes, real 404 for assets
app.use((req, res) => {
  const ext = path.extname(req.path);
  // If the request looks like a static asset (has a file extension that isn't .html),
  // return a proper 404 so broken images/CSS/JS are easy to diagnose
  if (ext && ext !== '.html') {
    return res.status(404).send('Not found');
  }
  // Unknown page routes fall back to homepage
  res.status(404).sendFile(path.join(BASE_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`RichardLSenninger.com server running at http://localhost:${PORT}`);

  // Warn loudly about missing critical env vars so Railway logs make it obvious
  const required = [
    ['STRIPE_SECRET_KEY', 'payments will not work'],
    ['STRIPE_WEBHOOK_SECRET', 'Printify orders will NEVER be created — webhook signature check will always fail'],
    ['PRINTIFY_API_KEY', 'store products and order creation will not work'],
  ];
  for (const [key, impact] of required) {
    const val = process.env[key];
    if (!val || val.includes('your_')) {
      console.warn(`WARNING: ${key} is not set — ${impact}`);
    }
  }
});
