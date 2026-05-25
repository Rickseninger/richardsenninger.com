/* ========== RichardLSenninger.com Store ========== */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var products = [];
  var freeDownloads = [];
  var cart = loadCart();
  var stripe = null;
  var cardElement = null;
  var activeCategory = 'all';
  var modalProduct = null;
  var modalSelectedSize = null;
  var modalSelectedColor = null;
  var modalActiveImageIndex = 0;

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  var productModal = document.getElementById('product-modal');
  var productModalBackdrop = document.getElementById('product-modal-backdrop');
  var productModalClose = document.getElementById('product-modal-close');
  var modalImagePool   = document.getElementById('modal-image-pool');
  var modalThumbStrips = document.getElementById('modal-thumb-strips');
  var modalCategory = document.getElementById('modal-category');
  var modalTitle = document.getElementById('modal-title');
  var modalDescription = document.getElementById('modal-description');
  var modalPrice = document.getElementById('modal-price');
  var modalThumbnails = document.getElementById('modal-thumbnails');
  var modalSizeGroup = document.getElementById('modal-size-group');
  var modalSizes = document.getElementById('modal-sizes');
  var modalColorGroup = document.getElementById('modal-color-group');
  var modalColors = document.getElementById('modal-colors');
  var modalVariantError = document.getElementById('modal-variant-error');
  var modalAddBtn = document.getElementById('modal-add-btn');
  var freeDownloadsGrid = document.getElementById('free-downloads-grid');
  var storeFiltersSection = document.getElementById('store-filters-section');
  var storeProductsSection = document.getElementById('store-products-section');
  var productGrid = document.getElementById('product-grid');
  var cartSidebar = document.getElementById('cart-sidebar');
  var cartOverlay = document.getElementById('cart-overlay');
  var cartItemsEl = document.getElementById('cart-items');
  var cartTotalEl = document.getElementById('cart-total');
  var cartCountEl = document.getElementById('cart-count');
  var cartFab = document.getElementById('cart-fab');
  var cartCloseBtn = document.getElementById('cart-close');
  var checkoutBtn = document.getElementById('checkout-btn');
  var checkoutModal = document.getElementById('checkout-modal');
  var checkoutBackdrop = document.getElementById('checkout-backdrop');
  var checkoutCloseBtn = document.getElementById('checkout-close');
  var checkoutForm = document.getElementById('checkout-form');
  var checkoutTotalEl = document.getElementById('checkout-total');
  var cardErrors = document.getElementById('card-errors');
  var payBtn = document.getElementById('pay-btn');
  var payBtnText = document.getElementById('pay-btn-text');
  var payBtnSpinner = document.getElementById('pay-btn-spinner');
  var checkoutSuccess = document.getElementById('checkout-success');

  // ---------------------------------------------------------------------------
  // Image proxy helper — routes Printify CDN images through our server so they
  // are cached on Railway and served fast without a per-request CDN round-trip
  // ---------------------------------------------------------------------------
  function proxyUrl(src) {
    if (!src) return src;
    if (src.indexOf('images.printify.com') === -1) return src;
    return '/api/image-proxy?url=' + encodeURIComponent(src);
  }

  // ---------------------------------------------------------------------------
  // Cart persistence
  // ---------------------------------------------------------------------------
  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem('rick-cart')) || [];
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem('rick-cart', JSON.stringify(cart));
  }

  // ---------------------------------------------------------------------------
  // Product fetching & rendering
  // ---------------------------------------------------------------------------
  function fetchProducts() {
    return fetch('/api/products')
      .then(function (res) {
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then(function (data) {
        products = data.products || [];
        freeDownloads = data.freeDownloads || [];
        return data;
      });
  }

  function renderFreeDownloads() {
    if (freeDownloads.length === 0) {
      freeDownloadsGrid.innerHTML =
        '<div class="store-empty"><h3>Coming soon</h3><p>Free downloads will be available shortly.</p></div>';
      return;
    }

    var html = '';
    freeDownloads.forEach(function (item, i) {
      var imgSrc = item.image || '';
      html +=
        '<div class="free-download-card" style="animation-delay: ' + Math.min(i * 0.08, 0.25) + 's">' +
          '<div class="product-card-image">' +
            (imgSrc
              ? '<img src="' + escapeHtml(imgSrc) + '" alt="' + escapeHtml(item.title) + '" loading="lazy">'
              : '<div style="padding:2rem;opacity:0.4;text-align:center">No image</div>') +
          '</div>' +
          '<div class="product-card-body">' +
            '<div class="product-card-category">' + escapeHtml(item.type || 'Audio') + '</div>' +
            '<h3 class="product-card-title">' + escapeHtml(item.title) + '</h3>' +
            '<p class="product-card-description">' + escapeHtml(item.description) + '</p>' +
            '<a href="' + escapeHtml(item.file) + '" download class="download-btn">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
              'Free Download' +
            '</a>' +
          '</div>' +
        '</div>';
    });

    freeDownloadsGrid.innerHTML = html;
  }

  function renderProducts(category) {
    activeCategory = category || 'all';

    var filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(function (btn) {
      var btnCat = btn.getAttribute('data-category');
      btn.classList.toggle('active', btnCat === activeCategory);
    });

    var filtered =
      activeCategory === 'all'
        ? products
        : products.filter(function (p) {
            return p.category === activeCategory;
          });

    if (filtered.length === 0 && products.length > 0) {
      productGrid.innerHTML =
        '<div class="store-empty"><h3>No products in this category</h3><p>Check back soon for new items!</p></div>';
      return;
    }

    if (filtered.length === 0) {
      productGrid.innerHTML =
        '<div class="store-empty"><h3>Products coming soon</h3><p>We\'re stocking the shelves — check back shortly!</p></div>';
      return;
    }

    var html = '';
    filtered.forEach(function (product, i) {
      var imgSrc = (product.thumbs && product.thumbs[0]) || (product.images && product.images[0]) || '';
      var priceStr = '$' + product.price.toFixed(2);
      var desc = product.description || '';
      if (desc.length > 100) desc = desc.substring(0, 100) + '...';
      var imgLoading = i < 4 ? 'eager' : 'lazy';

      html +=
        '<div class="product-card" style="animation-delay: ' + Math.min(i * 0.05, 0.3) + 's">' +
          '<div class="product-card-image">' +
            (imgSrc
              ? '<img src="' + escapeHtml(proxyUrl(imgSrc)) + '" alt="' + escapeHtml(product.title) + '" loading="' + imgLoading + '" decoding="async">'
              : '<div style="padding:2rem;opacity:0.4;text-align:center">No image</div>') +
          '</div>' +
          '<div class="product-card-body">' +
            '<div class="product-card-category">' + escapeHtml(product.category) + '</div>' +
            '<h3 class="product-card-title">' + escapeHtml(product.title) + '</h3>' +
            (desc ? '<p class="product-card-description">' + escapeHtml(desc) + '</p>' : '') +
            '<div class="product-card-footer">' +
              '<span class="product-price">' + priceStr + '</span>' +
              '<button class="view-options-btn" data-id="' + escapeHtml(product.id) + '">View Options</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    productGrid.innerHTML = html;
    preloadAllProducts();
  }

  // ---------------------------------------------------------------------------
  // Product detail modal
  // ---------------------------------------------------------------------------
  var SIZE_TOKENS = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','OS','ONE SIZE','ONE-SIZE'];
  var parsedVariantsCache = {};

  function looksLikeSize(str) {
    return SIZE_TOKENS.indexOf(str.toUpperCase().trim()) !== -1;
  }

  function getSplitMeta(variants) {
    var sample = variants.find(function (v) { return v.name && v.name.indexOf(' / ') !== -1; });
    var sampleParts = sample ? sample.name.split(' / ') : [];
    var firstIsSize = sampleParts.length > 0 && looksLikeSize(sampleParts[0]);
    return { firstIsSize: firstIsSize };
  }

  function parseVariants(variants) {
    var cacheKey = variants.map(function (v) { return v.id; }).join(',');
    if (parsedVariantsCache[cacheKey]) return parsedVariantsCache[cacheKey];

    var sizes = [];
    var colors = [];
    var hasSplit = variants.some(function (v) { return v.name && v.name.indexOf(' / ') !== -1; });
    var colorOnly = false;

    if (hasSplit) {
      var meta = getSplitMeta(variants);
      variants.forEach(function (v) {
        if (!v.name) return;
        var parts = v.name.split(' / ');
        var part0 = parts[0].trim();
        var part1 = parts.slice(1).join(' / ').trim();
        var size  = meta.firstIsSize ? part0 : part1;
        var color = meta.firstIsSize ? part1 : part0;
        if (size  && sizes.indexOf(size)   === -1) sizes.push(size);
        if (color && colors.indexOf(color) === -1) colors.push(color);
      });
    } else {
      variants.forEach(function (v) {
        if (v.name && sizes.indexOf(v.name) === -1) sizes.push(v.name);
      });

      var anyRealSize = sizes.some(function (s) {
        return SIZE_TOKENS.indexOf(s.toUpperCase().trim()) !== -1;
      });
      if (!anyRealSize && sizes.length > 1) {
        colors    = sizes.slice();
        sizes     = [];
        hasSplit  = true;
        colorOnly = true;
      }
    }

    sizes.sort(function (a, b) {
      var ai = SIZE_TOKENS.indexOf(a.toUpperCase().trim());
      var bi = SIZE_TOKENS.indexOf(b.toUpperCase().trim());
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    var result = { sizes: sizes, colors: colors, hasSplit: hasSplit, colorOnly: colorOnly };
    parsedVariantsCache[cacheKey] = result;
    return result;
  }

  function findVariant(product, size, color) {
    var parsed = parseVariants(product.variants);
    return product.variants.find(function (v) {
      if (parsed.colorOnly) return v.name === color;
      if (!parsed.hasSplit)  return v.name === size;

      var parts = v.name.split(' / ');
      var meta  = getSplitMeta(product.variants);
      var vSize  = meta.firstIsSize ? parts[0].trim() : parts.slice(1).join(' / ').trim();
      var vColor = meta.firstIsSize ? parts.slice(1).join(' / ').trim() : parts[0].trim();
      return vSize === size && vColor === color;
    }) || null;
  }

  function updateModalPrice() {
    if (!modalProduct) return;
    var parsed = parseVariants(modalProduct.variants);
    var variant = null;

    if (parsed.colorOnly && modalSelectedColor) {
      variant = findVariant(modalProduct, null, modalSelectedColor);
    } else if (parsed.hasSplit && modalSelectedSize && modalSelectedColor) {
      variant = findVariant(modalProduct, modalSelectedSize, modalSelectedColor);
    } else if (!parsed.hasSplit && modalSelectedSize) {
      variant = findVariant(modalProduct, modalSelectedSize, null);
    }

    var price = variant ? variant.retailPrice : modalProduct.price;
    modalPrice.textContent = '$' + price.toFixed(2);
  }

  function getVariantIdsForColor(product, color) {
    var parsed = parseVariants(product.variants);
    var ids = [];

    if (parsed.colorOnly) {
      product.variants.forEach(function (v) {
        if (v.name === color) ids.push(String(v.id));
      });
      return ids;
    }

    if (!parsed.hasSplit) return ids;

    var meta = getSplitMeta(product.variants);
    product.variants.forEach(function (v) {
      if (!v.name || v.name.indexOf(' / ') === -1) return;
      var parts  = v.name.split(' / ');
      var vColor = meta.firstIsSize ? parts.slice(1).join(' / ').trim() : parts[0].trim();
      if (vColor === color) ids.push(String(v.id));
    });
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Image pool — pre-rendered stacked <img> elements; switching is a GPU
  // opacity composite, not a decode step.
  // ---------------------------------------------------------------------------
  function escapeAttr(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function imagesForColor(product, color) {
    var allImages = product.allImages || [];
    var ids = getVariantIdsForColor(product, color);
    var matched = ids.length > 0 ? allImages.filter(function (img) {
      return img.variantIds && img.variantIds.some(function (id) {
        return ids.indexOf(String(id)) !== -1;
      });
    }) : [];
    return matched.length > 0 ? matched : allImages;
  }

  function buildColorPool(product) {
    modalImagePool.innerHTML   = '';
    modalThumbStrips.innerHTML = '';
    modalThumbnails.innerHTML  = '';

    var allImages = product.allImages || [];
    var parsed    = parseVariants(product.variants);

    var defaultSrc = allImages.length > 0
      ? proxyUrl(allImages[0].thumb || (allImages[0].src + '?w=480'))
      : (product.images && product.images[0] ? proxyUrl(product.images[0]) : '');

    if (defaultSrc) {
      var defImg = document.createElement('img');
      defImg.className = 'modal-pool-img pool-active';
      defImg.src = defaultSrc;
      defImg.alt = product.title || '';
      defImg.setAttribute('decoding', 'async');
      defImg.setAttribute('data-pool-default', '');
      defImg.setAttribute('data-pool-src', defaultSrc);
      modalImagePool.appendChild(defImg);
    }

    if (parsed.colors.length === 0) {
      buildThumbStrip(null, allImages);
      return;
    }

    parsed.colors.forEach(function (color) {
      var ids = getVariantIdsForColor(product, color);
      var matched = ids.length > 0 ? allImages.filter(function (img) {
        return img.variantIds && img.variantIds.some(function (id) {
          return ids.indexOf(String(id)) !== -1;
        });
      }) : [];

      if (matched.length === 0) return;

      var first = matched[0];
      var src = proxyUrl(first.thumb || (first.src + '?w=480'));

      var existing = modalImagePool.querySelector('[data-pool-src="' + escapeAttr(src) + '"]');
      if (!existing) {
        var imgEl = document.createElement('img');
        imgEl.className = 'modal-pool-img';
        imgEl.src = src;
        imgEl.alt = '';
        imgEl.setAttribute('decoding', 'async');
        imgEl.setAttribute('data-pool-color', color);
        imgEl.setAttribute('data-pool-src', src);
        modalImagePool.appendChild(imgEl);
      } else {
        if (!existing.getAttribute('data-pool-color')) {
          existing.setAttribute('data-pool-color', color);
        }
      }

      buildThumbStrip(color, matched);
    });

    if (!modalThumbStrips.querySelector('.modal-thumb-strip')) {
      buildThumbStrip(null, allImages);
    }
  }

  function buildThumbStrip(colorName, imgs) {
    if (imgs.length <= 1) return;
    var strip = document.createElement('div');
    strip.className = 'modal-thumb-strip';
    if (colorName !== null) strip.setAttribute('data-strip-color', colorName);

    imgs.forEach(function (img, i) {
      var thumbSrc = proxyUrl(img.thumb || (img.src + '?w=480'));
      var div = document.createElement('div');
      div.className = 'modal-thumb' + (i === 0 ? ' active' : '');
      div.setAttribute('data-src', thumbSrc);
      var imgEl = document.createElement('img');
      imgEl.src = thumbSrc;
      imgEl.alt = '';
      imgEl.setAttribute('loading', 'eager');
      imgEl.setAttribute('decoding', 'async');
      div.appendChild(imgEl);
      strip.appendChild(div);
    });

    modalThumbStrips.appendChild(strip);
  }

  function activatePoolColor(colorName) {
    var target = modalImagePool.querySelector('[data-pool-color="' + escapeAttr(colorName) + '"]');
    if (!target) {
      activateDefaultPool();
      return true;
    }
    var all = modalImagePool.querySelectorAll('.modal-pool-img');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('pool-active');
    target.classList.add('pool-active');
    return true;
  }

  function activateDefaultPool() {
    var def = modalImagePool.querySelector('[data-pool-default]');
    if (!def) return;
    var all = modalImagePool.querySelectorAll('.modal-pool-img');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('pool-active');
    def.classList.add('pool-active');
  }

  function setActivePoolSrc(src, fromStrip) {
    var all    = modalImagePool.querySelectorAll('.modal-pool-img');
    var target = null;
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('pool-active');
      if (all[i].getAttribute('data-pool-src') === src || all[i].src === src) target = all[i];
    }
    if (!target) {
      target = document.createElement('img');
      target.className = 'modal-pool-img';
      target.src = src;
      target.alt = '';
      target.setAttribute('decoding', 'async');
      target.setAttribute('data-pool-src', src);
      modalImagePool.appendChild(target);
    }
    target.classList.add('pool-active');

    if (!fromStrip) {
      var activeStrip = modalThumbStrips.querySelector('.strip-active') || modalThumbnails;
      if (activeStrip) {
        var thumbs = activeStrip.querySelectorAll('.modal-thumb');
        for (var j = 0; j < thumbs.length; j++) {
          thumbs[j].classList.toggle('active', thumbs[j].getAttribute('data-src') === src);
        }
      }
    }
  }

  function activateThumbStrip(colorName) {
    modalThumbnails.innerHTML = '';
    var strips = modalThumbStrips.querySelectorAll('.modal-thumb-strip');
    var found = false;
    for (var i = 0; i < strips.length; i++) {
      var isMatch = strips[i].getAttribute('data-strip-color') === colorName;
      strips[i].classList.toggle('strip-active', isMatch);
      if (isMatch) found = true;
    }
    if (!found) {
      var nullStrip = modalThumbStrips.querySelector('.modal-thumb-strip:not([data-strip-color])');
      if (nullStrip) nullStrip.classList.add('strip-active');
    }
  }

  function renderModalGallery(product, activeColorVariantIds, colorName) {
    if (colorName) {
      activatePoolColor(colorName);
      activateThumbStrip(colorName);
      return;
    }
    activateDefaultPool();
    var nullStrip = modalThumbStrips.querySelector('.modal-thumb-strip:not([data-strip-color])');
    var strips    = modalThumbStrips.querySelectorAll('.modal-thumb-strip');
    for (var i = 0; i < strips.length; i++) strips[i].classList.remove('strip-active');
    if (nullStrip) nullStrip.classList.add('strip-active');
  }

  function renderModalVariants(product) {
    var parsed = parseVariants(product.variants);

    if (parsed.sizes.length <= 1 && parsed.colors.length === 0) {
      modalSizeGroup.style.display = 'none';
      modalColorGroup.style.display = 'none';
      return;
    }

    if (parsed.sizes.length > 0) {
      modalSizeGroup.style.display = '';
      var sizesHtml = '';
      parsed.sizes.forEach(function (size) {
        sizesHtml += '<button class="variant-btn" data-type="size" data-value="' + escapeHtml(size) + '">' + escapeHtml(size) + '</button>';
      });
      modalSizes.innerHTML = sizesHtml;
    } else {
      modalSizeGroup.style.display = 'none';
    }

    if (parsed.hasSplit && parsed.colors.length > 0) {
      modalColorGroup.style.display = '';
      var colorsHtml = '';
      parsed.colors.forEach(function (color) {
        colorsHtml += '<button class="variant-btn" data-type="color" data-value="' + escapeHtml(color) + '">' + escapeHtml(color) + '</button>';
      });
      modalColors.innerHTML = colorsHtml;
    } else {
      modalColorGroup.style.display = 'none';
    }
  }

  var preloadedProductIds = {};

  function preloadProductImages(product) {
    if (preloadedProductIds[product.id]) return;
    preloadedProductIds[product.id] = true;
    var allImages = product.allImages || [];
    allImages.slice(0, 30).forEach(function (img) {
      var src = proxyUrl(img.thumb || (img.src + '?w=480'));
      var loader = new Image();
      loader.src = src;
    });
  }

  function preloadAllProducts() {
    var schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : function (fn) { setTimeout(fn, 80); };
    var i = 0;
    function next(deadline) {
      while (i < products.length) {
        if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 5) break;
        preloadProductImages(products[i]);
        i++;
      }
      if (i < products.length) schedule(next);
    }
    schedule(next);
  }

  function openProductModal(productId) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;

    modalProduct = product;
    modalSelectedSize = null;
    modalSelectedColor = null;

    buildColorPool(product);

    modalCategory.textContent = product.category;
    modalTitle.textContent = product.title;
    modalDescription.textContent = product.description || '';
    modalPrice.textContent = '$' + product.price.toFixed(2);
    modalVariantError.classList.add('hidden');
    modalActiveImageIndex = 0;

    renderModalVariants(product);
    renderModalGallery(product, null);
    preloadProductImages(product);

    var parsed = parseVariants(product.variants);
    var needsSelection = parsed.colorOnly
      ? parsed.colors.length > 1
      : parsed.sizes.length > 1 || (parsed.hasSplit && parsed.colors.length > 1);
    modalAddBtn.disabled = needsSelection;

    productModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeProductModal() {
    productModal.classList.remove('open');
    document.body.style.overflow = '';
    modalProduct = null;
    modalSelectedSize = null;
    modalSelectedColor = null;
  }

  function handleVariantClick(e) {
    var btn = e.target.closest('.variant-btn');
    if (!btn) return;

    var type = btn.getAttribute('data-type');
    var value = btn.getAttribute('data-value');

    var siblings = btn.closest('.variant-options').querySelectorAll('.variant-btn');
    siblings.forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    if (type === 'size') modalSelectedSize = value;
    if (type === 'color') {
      modalSelectedColor = value;
      renderModalGallery(modalProduct, null, value);
    }

    modalVariantError.classList.add('hidden');
    updateModalPrice();

    var parsed = parseVariants(modalProduct.variants);
    var sizeOk  = parsed.colorOnly || parsed.sizes.length <= 1 || modalSelectedSize;
    var colorOk = !parsed.hasSplit || parsed.colors.length <= 1 || modalSelectedColor;
    modalAddBtn.disabled = !(sizeOk && colorOk);
  }

  function addToCartFromModal() {
    if (!modalProduct) return;

    var parsed = parseVariants(modalProduct.variants);
    var needsSize = parsed.sizes.length > 1;
    var needsColor = parsed.hasSplit && parsed.colors.length > 1;

    if ((needsSize && !modalSelectedSize) || (needsColor && !modalSelectedColor)) {
      modalVariantError.classList.remove('hidden');
      return;
    }

    var variant = null;
    if (parsed.colorOnly) {
      variant = findVariant(modalProduct, null, modalSelectedColor || (parsed.colors[0] || null));
    } else if (parsed.hasSplit) {
      var size = modalSelectedSize || (parsed.sizes[0] || null);
      var color = modalSelectedColor || (parsed.colors[0] || null);
      variant = findVariant(modalProduct, size, color);
    } else {
      var selectedSize = modalSelectedSize || (parsed.sizes[0] || null);
      variant = findVariant(modalProduct, selectedSize, null);
    }

    var price = variant ? variant.retailPrice : modalProduct.price;
    var variantId = variant ? variant.id : (modalProduct.variants[0] ? modalProduct.variants[0].id : null);
    var variantName = variant ? variant.name : '';

    var cartTitle = modalProduct.title + (variantName ? ' — ' + variantName : '');
    var cartKey = modalProduct.id + '|' + (variantId || '');
    var cartImage = proxyUrl(
      (modalProduct.thumbs && modalProduct.thumbs[0])
      || (modalProduct.images && modalProduct.images[0] ? modalProduct.images[0] + '?w=480' : '')
    );

    var existing = cart.find(function (item) { return item.cartKey === cartKey; });
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        id: modalProduct.id,
        cartKey: cartKey,
        title: cartTitle,
        price: price,
        quantity: 1,
        image: cartImage,
        variantId: variantId,
      });
    }

    saveCart();
    updateCartUI();
    closeProductModal();
    openCart();
  }

  // ---------------------------------------------------------------------------
  // Cart UI
  // ---------------------------------------------------------------------------
  function updateCartUI() {
    var totalItems = cart.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    var totalPrice = cart.reduce(function (sum, item) { return sum + item.price * item.quantity; }, 0);

    cartCountEl.textContent = totalItems;
    cartTotalEl.textContent = '$' + totalPrice.toFixed(2);
    checkoutTotalEl.textContent = '$' + totalPrice.toFixed(2);
    checkoutBtn.disabled = cart.length === 0;

    if (cart.length === 0) {
      cartItemsEl.innerHTML = '<p class="cart-empty">Your cart is empty</p>';
      return;
    }

    var html = '';
    cart.forEach(function (item, idx) {
      var imgSrc = item.image || '';
      html +=
        '<div class="cart-item">' +
          '<div class="cart-item-image">' +
            (imgSrc ? '<img src="' + escapeHtml(imgSrc) + '" alt="">' : '') +
          '</div>' +
          '<div class="cart-item-details">' +
            '<div class="cart-item-title">' + escapeHtml(item.title) + '</div>' +
            '<div class="cart-item-price">$' + item.price.toFixed(2) + '</div>' +
            '<div class="cart-item-qty">' +
              '<button class="qty-btn" data-action="decrease" data-index="' + idx + '">&#8722;</button>' +
              '<span>' + item.quantity + '</span>' +
              '<button class="qty-btn" data-action="increase" data-index="' + idx + '">&#43;</button>' +
            '</div>' +
          '</div>' +
          '<button class="cart-item-remove" data-index="' + idx + '" aria-label="Remove item">&times;</button>' +
        '</div>';
    });

    cartItemsEl.innerHTML = html;
  }

  function addToCart(productId) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;

    var existing = cart.find(function (item) { return item.id === productId; });
    if (existing) {
      existing.quantity += 1;
    } else {
      var img = proxyUrl(
        (product.thumbs && product.thumbs[0])
        || (product.images && product.images[0] ? product.images[0] + '?w=480' : '')
      );
      cart.push({
        id: product.id,
        title: product.title,
        price: product.price,
        quantity: 1,
        image: img,
        variantId: product.variants && product.variants[0] ? product.variants[0].id : null,
      });
    }

    saveCart();
    updateCartUI();

    var btn = productGrid.querySelector('.add-to-cart-btn[data-id="' + productId + '"]');
    if (btn) {
      btn.textContent = 'Added!';
      btn.classList.add('added');
      setTimeout(function () {
        btn.textContent = 'Add to Cart';
        btn.classList.remove('added');
      }, 1200);
    }
  }

  function removeFromCart(index) {
    cart.splice(index, 1);
    saveCart();
    updateCartUI();
  }

  function updateQuantity(index, delta) {
    if (!cart[index]) return;
    cart[index].quantity += delta;
    if (cart[index].quantity < 1) {
      cart.splice(index, 1);
    }
    saveCart();
    updateCartUI();
  }

  // ---------------------------------------------------------------------------
  // Cart sidebar toggle
  // ---------------------------------------------------------------------------
  function openCart() {
    cartSidebar.classList.add('open');
    cartOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeCart() {
    cartSidebar.classList.remove('open');
    cartOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---------------------------------------------------------------------------
  // Checkout modal
  // ---------------------------------------------------------------------------
  function openCheckout() {
    closeCart();
    checkoutModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!stripe) initStripe();
  }

  function closeCheckout() {
    checkoutModal.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---------------------------------------------------------------------------
  // Stripe initialization — publishable key is fetched from /api/config at
  // runtime, never hardcoded. Server reads it from the STRIPE_PUBLISHABLE_KEY
  // environment variable set in Railway.
  // ---------------------------------------------------------------------------
  function loadStripeScript() {
    if (window.Stripe) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load Stripe.js')); };
      document.head.appendChild(s);
    });
  }

  function initStripe() {
    return loadStripeScript()
      .then(function () { return fetch('/api/config'); })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.publishableKey ||
            data.publishableKey.indexOf('your_') === 0 ||
            (data.publishableKey.indexOf('pk_live_') !== 0 &&
             data.publishableKey.indexOf('pk_test_') !== 0)) {
          console.warn('Stripe publishable key not configured — checkout will be disabled.');
          return;
        }

        stripe = Stripe(data.publishableKey);
        var elements = stripe.elements();
        cardElement = elements.create('card', {
          style: {
            base: {
              fontFamily: "'Aptos', 'Calibri', 'Helvetica Neue', sans-serif",
              fontSize: '16px',
              color: '#111111',
              '::placeholder': { color: '#999' },
            },
            invalid: { color: '#c0392b' },
          },
        });
        cardElement.mount('#card-element');

        cardElement.on('change', function (event) {
          cardErrors.textContent = event.error ? event.error.message : '';
        });
      })
      .catch(function (err) {
        console.error('Stripe init failed:', err);
      });
  }

  // ---------------------------------------------------------------------------
  // Checkout submission
  // ---------------------------------------------------------------------------
  function handleCheckout(e) {
    e.preventDefault();

    if (!stripe || !cardElement) {
      cardErrors.textContent = 'Payment system is not ready. Please try again.';
      return;
    }

    if (cart.length === 0) return;

    payBtn.disabled = true;
    payBtnText.textContent = 'Processing...';
    payBtnSpinner.classList.remove('hidden');

    var shipping = {
      name: document.getElementById('ship-name').value.trim(),
      address: document.getElementById('ship-address').value.trim(),
      city: document.getElementById('ship-city').value.trim(),
      state: document.getElementById('ship-state').value.trim(),
      zip: document.getElementById('ship-zip').value.trim(),
      country: document.getElementById('ship-country').value,
      email: document.getElementById('ship-email').value.trim(),
    };

    var items = cart.map(function (item) {
      return {
        id: item.id,
        quantity: item.quantity,
        variantId: item.variantId || null,
      };
    });

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, shipping: shipping }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            var msg = 'Checkout failed. Please try again.';
            try { var j = JSON.parse(body); if (j.error) msg = j.error; } catch (_) {}
            throw new Error(msg);
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (data.error) {
          throw new Error(data.error);
        }
        return stripe.confirmCardPayment(data.clientSecret, {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: shipping.name,
              email: shipping.email,
              address: {
                line1: shipping.address,
                city: shipping.city,
                state: shipping.state,
                postal_code: shipping.zip,
                country: shipping.country,
              },
            },
          },
        });
      })
      .then(function (result) {
        if (result.error) {
          throw new Error(result.error.message);
        }

        cart = [];
        saveCart();
        updateCartUI();

        checkoutForm.classList.add('hidden');
        checkoutSuccess.classList.remove('hidden');
      })
      .catch(function (err) {
        cardErrors.textContent = err.message || 'Payment failed. Please try again.';
        payBtn.disabled = false;
        payBtnText.textContent = 'Pay Now';
        payBtnSpinner.classList.add('hidden');
      });
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------
  function bindEvents() {
    document.querySelector('.filter-buttons').addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      renderProducts(btn.getAttribute('data-category'));
    });

    productGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('.view-options-btn');
      if (!btn) return;
      openProductModal(btn.getAttribute('data-id'));
    });

    productGrid.addEventListener('mouseover', function (e) {
      var btn = e.target.closest('.view-options-btn');
      if (!btn) return;
      var product = products.find(function (p) { return p.id === btn.getAttribute('data-id'); });
      if (product) preloadProductImages(product);
    }, { passive: true });

    function onThumbClick(e) {
      var thumb = e.target.closest('.modal-thumb');
      if (!thumb) return;
      setActivePoolSrc(thumb.getAttribute('data-src'));
      var strip = thumb.closest('.modal-thumb-strip, .modal-thumbnails');
      if (strip) {
        var all = strip.querySelectorAll('.modal-thumb');
        for (var i = 0; i < all.length; i++) {
          all[i].classList.toggle('active', all[i] === thumb);
        }
      }
    }
    modalThumbStrips.addEventListener('click', onThumbClick);
    modalThumbnails.addEventListener('click', onThumbClick);

    document.getElementById('modal-variants').addEventListener('click', handleVariantClick);

    modalAddBtn.addEventListener('click', addToCartFromModal);

    productModalClose.addEventListener('click', closeProductModal);
    productModalBackdrop.addEventListener('click', closeProductModal);

    cartFab.addEventListener('click', openCart);

    cartCloseBtn.addEventListener('click', closeCart);
    cartOverlay.addEventListener('click', closeCart);

    cartItemsEl.addEventListener('click', function (e) {
      var removeBtn = e.target.closest('.cart-item-remove');
      if (removeBtn) {
        removeFromCart(parseInt(removeBtn.getAttribute('data-index'), 10));
        return;
      }
      var qtyBtn = e.target.closest('.qty-btn');
      if (qtyBtn) {
        var idx = parseInt(qtyBtn.getAttribute('data-index'), 10);
        var action = qtyBtn.getAttribute('data-action');
        updateQuantity(idx, action === 'increase' ? 1 : -1);
      }
    });

    checkoutBtn.addEventListener('click', openCheckout);

    checkoutCloseBtn.addEventListener('click', closeCheckout);
    checkoutBackdrop.addEventListener('click', closeCheckout);

    checkoutForm.addEventListener('submit', handleCheckout);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (productModal.classList.contains('open')) closeProductModal();
        else if (checkoutModal.classList.contains('open')) closeCheckout();
        else if (cartSidebar.classList.contains('open')) closeCart();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------
  var escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var escapeRe = /[&<>"']/g;
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(escapeRe, function (ch) { return escapeMap[ch]; });
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    updateCartUI();
    bindEvents();

    fetchProducts()
      .then(function () {
        renderFreeDownloads();

        if (products.length > 0) {
          storeFiltersSection.style.display = '';
          storeProductsSection.style.display = '';
          renderProducts('all');
        }
      })
      .catch(function () {
        freeDownloadsGrid.innerHTML =
          '<div class="store-error"><p>Unable to load content right now. Please refresh the page.</p></div>';
      });
  });
})();
