/* ========== RichardLSenninger.com — Animations ========== */
(function () {
  'use strict';

  // =========================================================
  // HERO CANVAS — Animated constellation / starfield
  // =========================================================
  var canvas = document.getElementById('hero-canvas');

  if (canvas) {
    var ctx = canvas.getContext('2d');
    var W, H, stars = [], RAF;
    var mouse = { x: -9999, y: -9999 };

    var STAR_COUNT = window.innerWidth < 768 ? 80 : 200;
    var CONNECT_DIST = 130;
    var MOUSE_DIST   = 160;

    function resize() {
      W = canvas.width  = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    }

    function mkStar() {
      return {
        x:  Math.random() * W,
        y:  Math.random() * H,
        r:  Math.random() * 1.5 + 0.5,
        a:  Math.random() * 0.65 + 0.35,
        vx: (Math.random() - 0.5) * 0.10,
        vy: (Math.random() - 0.5) * 0.10,
        tw: Math.random() * Math.PI * 2,
        ts: 0.007 + Math.random() * 0.014,
      };
    }

    function initStars() {
      stars = [];
      for (var i = 0; i < STAR_COUNT; i++) stars.push(mkStar());
    }

    function drawFrame() {
      ctx.clearRect(0, 0, W, H);

      // Drift stars
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.x += s.vx;
        s.y += s.vy;
        s.tw += s.ts;
        if (s.x < 0) s.x = W;
        if (s.x > W) s.x = 0;
        if (s.y < 0) s.y = H;
        if (s.y > H) s.y = 0;
      }

      // Constellation lines between nearby stars
      ctx.lineWidth = 0.55;
      for (var i = 0; i < stars.length - 1; i++) {
        for (var j = i + 1; j < stars.length; j++) {
          var dx = stars[i].x - stars[j].x;
          var dy = stars[i].y - stars[j].y;
          var d  = Math.sqrt(dx * dx + dy * dy);
          if (d < CONNECT_DIST) {
            var alpha = (1 - d / CONNECT_DIST) * 0.28;
            ctx.strokeStyle = 'rgba(201,149,42,' + alpha + ')';
            ctx.beginPath();
            ctx.moveTo(stars[i].x, stars[i].y);
            ctx.lineTo(stars[j].x, stars[j].y);
            ctx.stroke();
          }
        }
      }

      // Mouse-attraction lines
      if (mouse.x > 0) {
        ctx.lineWidth = 0.4;
        for (var i = 0; i < stars.length; i++) {
          var s  = stars[i];
          var dx = s.x - mouse.x;
          var dy = s.y - mouse.y;
          var d  = Math.sqrt(dx * dx + dy * dy);
          if (d < MOUSE_DIST) {
            var alpha = (1 - d / MOUSE_DIST) * 0.55;
            ctx.strokeStyle = 'rgba(240,192,64,' + alpha + ')';
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      // Stars — glow + core
      for (var i = 0; i < stars.length; i++) {
        var s  = stars[i];
        var tw = s.a * (0.6 + 0.4 * Math.sin(s.tw));

        // Soft glow for larger stars
        if (s.r > 1.1) {
          var grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
          grd.addColorStop(0, 'rgba(240,192,64,' + (tw * 0.55) + ')');
          grd.addColorStop(1, 'rgba(240,192,64,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Star core
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(240,200,70,' + tw + ')';
        ctx.fill();
      }

      RAF = requestAnimationFrame(drawFrame);
    }

    // Pause when tab is hidden to save battery
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        cancelAnimationFrame(RAF);
      } else {
        drawFrame();
      }
    });

    window.addEventListener('resize', function () {
      resize();
      initStars();
    }, { passive: true });

    canvas.addEventListener('mousemove', function (e) {
      var rect  = canvas.getBoundingClientRect();
      mouse.x   = e.clientX - rect.left;
      mouse.y   = e.clientY - rect.top;
    }, { passive: true });

    canvas.addEventListener('mouseleave', function () {
      mouse.x = -9999;
      mouse.y = -9999;
    });

    // Touch: draw toward finger
    canvas.addEventListener('touchmove', function (e) {
      var rect  = canvas.getBoundingClientRect();
      var t     = e.touches[0];
      mouse.x   = t.clientX - rect.left;
      mouse.y   = t.clientY - rect.top;
    }, { passive: true });

    canvas.addEventListener('touchend', function () {
      mouse.x = -9999;
      mouse.y = -9999;
    }, { passive: true });

    resize();
    initStars();
    drawFrame();
  }

  // =========================================================
  // NAV — Sliding pill indicator + entrance stagger + click particles
  // =========================================================
  (function () {
    var ul = document.querySelector('nav ul');
    if (!ul) return;

    // --- Sliding indicator ---
    var indicator = document.createElement('span');
    indicator.className = 'nav-indicator';
    indicator.style.opacity = '0';
    ul.insertBefore(indicator, ul.firstChild);

    var links = Array.prototype.slice.call(ul.querySelectorAll('a'));
    var activeLink = ul.querySelector('a.active') || links[0];
    var placed = false;

    function place(el, instant, reveal) {
      // Skip the pill on mobile dropdown — CSS hides it via display:none anyway
      if (getComputedStyle(indicator).display === 'none') return;
      var ulRect  = ul.getBoundingClientRect();
      var elRect  = el.getBoundingClientRect();
      if (instant) indicator.style.transition = 'none';
      indicator.style.left   = (elRect.left   - ulRect.left)   + 'px';
      indicator.style.top    = (elRect.top    - ulRect.top)    + 'px';
      indicator.style.width  = elRect.width  + 'px';
      indicator.style.height = elRect.height + 'px';
      if (reveal) indicator.style.opacity = '1';
      if (instant) {
        indicator.getBoundingClientRect(); // force reflow
        indicator.style.transition = '';
      }
      placed = true;
    }

    function refresh() { if (activeLink) place(activeLink, true, true); }

    // First placement strategy: keep pill invisible until fonts are ready, then snap
    // into final position with a quick fade-in. Great Vibes loading shifts header
    // layout on non-home pages where the active link is further right, so we MUST
    // wait for fonts before revealing — otherwise the pill flashes at a stale spot.
    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      if (!activeLink) return;
      // Smooth fade in over 200ms, snap position with no animation
      indicator.style.transition = 'opacity 0.22s ease';
      place(activeLink, false, true);  // position set, opacity 1 (fades in via transition)
      // Once opacity transition ends, restore full transition rules for hover slide
      setTimeout(function () { indicator.style.transition = ''; }, 260);
    }

    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    fontsReady.then(reveal);

    // Safety net: if fonts never resolve (offline, blocked), reveal anyway
    setTimeout(reveal, 800);

    window.addEventListener('load', function () { if (revealed) refresh(); });
    window.addEventListener('resize', function () { if (revealed) refresh(); }, { passive: true });

    links.forEach(function (link) {
      link.addEventListener('mouseenter', function () {
        if (!placed) refresh();
        place(link, false);
      });
    });
    ul.addEventListener('mouseleave', function () { if (activeLink && placed) place(activeLink, false); });

    // --- Staggered entrance: opacity ONLY (no transform). A translate would shift
    // the link's bounding rect and the pill would snap to a stale Y position if the
    // user hovered the link mid-animation. Skip the active link entirely. ---
    links.forEach(function (link, i) {
      if (link === activeLink) return;
      link.style.opacity = '0';
      setTimeout(function () {
        link.style.transition = 'opacity 0.4s ease, color 0.22s ease, text-shadow 0.22s ease';
        link.style.opacity = '';
      }, i * 55 + 50);
    });

    // --- Click particles ---
    function burst(x, y) {
      for (var i = 0; i < 9; i++) {
        var p = document.createElement('span');
        var size = 3 + Math.random() * 3;
        p.style.cssText =
          'position:fixed;pointer-events:none;z-index:9999;border-radius:50%;' +
          'width:' + size + 'px;height:' + size + 'px;' +
          'left:' + x + 'px;top:' + y + 'px;' +
          'background:rgba(201,149,42,' + (0.7 + Math.random() * 0.3) + ');' +
          'transform:translate(-50%,-50%);';
        document.body.appendChild(p);
        var angle = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
        var dist  = 24 + Math.random() * 36;
        var tx = Math.cos(angle) * dist;
        var ty = Math.sin(angle) * dist;
        p.getBoundingClientRect();
        p.style.transition = 'transform 0.55s cubic-bezier(0,.9,.57,1), opacity 0.55s ease';
        p.style.transform = 'translate(calc(-50% + ' + tx + 'px), calc(-50% + ' + ty + 'px))';
        p.style.opacity = '0';
        setTimeout(function (el) { el.parentNode && el.parentNode.removeChild(el); }, 600, p);
      }
    }

    links.forEach(function (link) {
      link.addEventListener('click', function (e) { burst(e.clientX, e.clientY); });
    });
  })();

  // =========================================================
  // INSPIRED THINKING SUBSCRIBE TOAST
  // Triggers after 18s OR 35% scroll (whichever first). Persists
  // dismissal/subscription in localStorage so it shows once per device.
  // =========================================================
  (function () {
    var toast = document.querySelector('.subscribe-toast');
    if (!toast) return;

    var KEY = 'rls-toast-state';
    var state;
    try { state = localStorage.getItem(KEY); } catch (e) { state = null; }
    if (state === 'subscribed' || state === 'dismissed') return;

    var SHOW_DELAY_MS  = 18000;
    var SHOW_SCROLL_PCT = 0.35;
    var shown = false;

    function show() {
      if (shown) return;
      shown = true;
      toast.classList.add('visible');
    }

    function persist(value) {
      try { localStorage.setItem(KEY, value); } catch (e) {}
    }

    function dismiss() {
      toast.classList.remove('visible');
      persist('dismissed');
    }

    setTimeout(show, SHOW_DELAY_MS);
    window.addEventListener('scroll', function () {
      if (shown) return;
      var docH = document.documentElement.scrollHeight;
      var pct  = (window.scrollY + window.innerHeight) / docH;
      if (pct >= SHOW_SCROLL_PCT) show();
    }, { passive: true });

    var closeBtn = toast.querySelector('.subscribe-toast-close');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    var form = toast.querySelector('.subscribe-toast-form');
    if (form) {
      var input = form.querySelector('input[type="email"]');
      var btn   = form.querySelector('button');
      var fb    = toast.querySelector('.subscribe-toast-feedback');
      var btnDefaultText = btn.textContent;

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = (input.value || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          fb.className = 'subscribe-toast-feedback error';
          fb.textContent = 'Please enter a valid email address.';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Sending…';
        fb.textContent = '';

        fetch('/api/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email: email })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            btn.disabled = false;
            btn.textContent = btnDefaultText;
            if (data && data.ok) {
              fb.className = 'subscribe-toast-feedback success';
              fb.textContent = "You're in — welcome to Rick's circle.";
              input.value = '';
              persist('subscribed');
              setTimeout(function () { toast.classList.remove('visible'); }, 2800);
            } else {
              fb.className = 'subscribe-toast-feedback error';
              fb.textContent = (data && data.error) || 'Something went wrong. Please try again.';
            }
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = btnDefaultText;
            fb.className = 'subscribe-toast-feedback error';
            fb.textContent = 'Connection error. Please try again.';
          });
      });
    }
  })();

  // =========================================================
  // SCROLL ANIMATIONS — IntersectionObserver
  // =========================================================
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('anim-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.10, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.anim-up, .anim-fade, .anim-left, .anim-right').forEach(function (el) {
      io.observe(el);
    });
  } else {
    // Fallback: show everything immediately
    document.querySelectorAll('.anim-up, .anim-fade, .anim-left, .anim-right').forEach(function (el) {
      el.classList.add('anim-visible');
    });
  }

})();
