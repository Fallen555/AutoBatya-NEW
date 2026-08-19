/* АвтоБатя. Прокрутка героя, появления, свет в боксе. Ванильный JS, без библиотек. */
(function () {
  'use strict';

  var VIDEO_URL = 'assets/hero-scrub.mp4';
  var VIDEO_BYTES = 5980812;
  var POSTER_URL = 'assets/hero-poster.jpg';

  var stage = document.getElementById('stage');
  var heroSec = document.getElementById('hero-sec');
  var video = document.getElementById('hero');
  var poster = document.getElementById('poster');
  var ring = document.getElementById('ring');
  var hint = document.getElementById('hint');
  var lamps = document.getElementById('lamps');
  var dust = document.getElementById('dust');
  var nav = document.getElementById('nav');

  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var smoothstep = function (p, e0, e1) {
    var t = clamp((p - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function rng(seed) {
    var s = seed >>> 0;
    return function () { return (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
  }
  var reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

  /* ----------------------------------------------------------
     1. Разбор заголовков на слова и буквы
     ---------------------------------------------------------- */
  var rand = rng(20250819);

  function buildVisual(text, entrance, spread) {
    var vis = document.createElement('span');
    vis.className = 'vis';
    vis.setAttribute('aria-hidden', 'true');
    var words = text.split(' ');
    var perChar = entrance === 'grid';
    var totalChars = text.replace(/ /g, '').length;
    var charSeen = 0;

    for (var i = 0; i < words.length; i++) {
      var w = document.createElement('span');
      w.className = 'w';
      if (!perChar) {
        w.style.setProperty('--th', ((i / Math.max(1, words.length)) * (entrance === 'depth' ? 0.34 : 0.42)).toFixed(3));
        w.textContent = words[i] + (i < words.length - 1 ? ' ' : '');
      } else {
        var letters = words[i].split('');
        for (var j = 0; j < letters.length; j++) {
          var c = document.createElement('span');
          c.className = 'c';
          c.textContent = letters[j];
          var th = (charSeen / Math.max(1, totalChars)) * spread + rand() * 0.06;
          c.style.setProperty('--th', th.toFixed(3));
          c.style.setProperty('--jx', (24 + rand() * 34).toFixed(1) + 'px');
          w.appendChild(c);
          charSeen++;
        }
        if (i < words.length - 1) {
          var sp = document.createElement('span');
          sp.className = 'c';
          sp.textContent = ' ';
          w.appendChild(sp);
        }
      }
      vis.appendChild(w);
    }
    return vis;
  }

  function splitInto(el, entrance, spread) {
    var text = el.textContent.trim();
    el.textContent = '';
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.appendChild(sr);

    if (entrance === 'blur') {
      var soft = buildVisual(text, entrance, spread);
      soft.classList.add('vis--soft');
      var sharp = buildVisual(text, entrance, spread);
      sharp.classList.add('vis--sharp');
      var holder = document.createElement('span');
      holder.className = 'vis';
      holder.setAttribute('aria-hidden', 'true');
      holder.appendChild(soft);
      holder.appendChild(sharp);
      el.appendChild(holder);
    } else {
      el.appendChild(buildVisual(text, entrance, spread));
    }
  }

  /* ----------------------------------------------------------
     2. Полосы текста
     ---------------------------------------------------------- */
  var bands = [];
  (function setupBands() {
    var nodes = document.querySelectorAll('.band');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var parts = (el.getAttribute('data-band') || '0,1').split(',');
      var a = parseFloat(parts[0]);
      var b = parseFloat(parts[1]);
      var entrance = el.getAttribute('data-entrance') || 'rise';
      var spread = parseFloat(el.getAttribute('data-spread') || '0.45');
      var ramp = parseFloat(el.getAttribute('data-ramp') || '0') || Math.min(0.025, (b - a) * 0.35);
      var title = el.querySelector('.split');
      if (title) splitInto(title, entrance, spread);
      bands.push({
        el: el, a: a, b: b, ramp: ramp,
        first: i === 0, last: i === nodes.length - 1,
        op: -1, k: -1, live: false
      });
    }
  })();

  var loadK = 0;
  var loadStart = 0;

  function updateCaptions(p) {
    for (var i = 0; i < bands.length; i++) {
      var bd = bands[i];
      var f = Math.min(0.02, (bd.b - bd.a) / 3);
      var inEase = bd.first ? 1 : smoothstep(p, bd.a, bd.a + f);
      var outEase = bd.last ? 1 : (1 - smoothstep(p, bd.b - f, bd.b));
      var op = inEase * outEase;
      var k = clamp((p - bd.a) / bd.ramp, 0, 1);
      if (bd.first) k = Math.max(k, loadK);

      if (Math.abs(op - bd.op) > 0.004) {
        bd.op = op;
        bd.el.style.opacity = op.toFixed(3);
        var live = op > 0.55;
        if (live !== bd.live) {
          bd.live = live;
          bd.el.classList.toggle('live', live);
        }
      }
      if (Math.abs(k - bd.k) > 0.008) {
        bd.k = k;
        bd.el.style.setProperty('--k', k.toFixed(3));
      }
    }
  }

  /* ----------------------------------------------------------
     3. Ворота на перемотку видео
     ---------------------------------------------------------- */
  var seekBusy = false;
  var pendingTime = null;

  function requestSeek(t) {
    if (!video.duration) return;
    if (seekBusy) { pendingTime = t; return; }
    seekBusy = true;
    video.currentTime = t;
  }
  video.addEventListener('seeked', function () {
    seekBusy = false;
    if (pendingTime !== null) {
      var t = pendingTime;
      pendingTime = null;
      requestSeek(t);
    }
  });
  video.addEventListener('error', function () {
    seekBusy = false;
    pendingTime = null;
    failVideo();
  });

  /* ----------------------------------------------------------
     4. Ход прокрутки героя
     ---------------------------------------------------------- */
  var target = 0, shown = 0, rafId = null, lastTick = 0;
  var heroOnScreen = true;
  var lastSp = -1, lastHint = -1;

  function heroProgress() {
    if (!heroSec.offsetHeight) return 0;
    var r = heroSec.getBoundingClientRect();
    var range = heroSec.offsetHeight - window.innerHeight;
    if (range <= 0) return 0;
    return clamp(-r.top / range, 0, 1);
  }

  function paintProgress(p) {
    if (Math.abs(p - lastSp) > 0.002) {
      lastSp = p;
      stage.style.setProperty('--sp', p.toFixed(3));
    }
    var h = p > 0.02 ? 0 : 1;
    if (h !== lastHint) {
      lastHint = h;
      if (hint) hint.style.setProperty('--hintO', h);
    }
  }

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    var k = 0.16;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));

    if (loadK < 1 && loadStart) {
      loadK = clamp((now - loadStart) / 1100, 0, 1);
      loadK = loadK * loadK * (3 - 2 * loadK);
    }

    var converged = Math.abs(target - shown) < 0.0005 && loadK >= 1;
    if (converged) {
      shown = target;
      rafId = null;
      lastTick = 0;
    } else {
      rafId = requestAnimationFrame(tick);
    }
    if (video.duration) requestSeek(shown * video.duration);
    updateCaptions(shown);
    paintProgress(shown);
  }

  function kick() {
    if (rafId === null && heroOnScreen && scrubOn) {
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function onHeroScroll() {
    target = heroProgress();
    kick();
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      heroOnScreen = entries[0].isIntersecting;
      if (heroOnScreen) kick();
    }, { rootMargin: '10px' }).observe(heroSec);
  }

  /* ----------------------------------------------------------
     5. Видео как Blob, с кольцом загрузки
     ---------------------------------------------------------- */
  var heroInited = false;
  var fetchStarted = false;

  function makeScrollChevron() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'chev');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M5 9l7 7 7-7');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    s.appendChild(p);
    return s;
  }

  function failVideo() {
    if (ring && ring.parentNode) ring.replaceWith(makeScrollChevron());
    stage.classList.add('video-failed');
  }

  function startBlobFetch() {
    if (fetchStarted) return;
    fetchStarted = true;
    loadHeroBlob().catch(failVideo);
  }

  function loadHeroBlob() {
    var ctrl = new AbortController();
    var watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch(VIDEO_URL, { signal: ctrl.signal }).then(function (res) {
      if (!res.ok || !res.body) throw new Error('no body');
      var total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0, lastRing = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
          chunks.push(r.value);
          got += r.value.length;
          var frac = Math.min(1, got / total);
          var now = performance.now();
          if (now - lastRing > 100 || frac === 1) {
            lastRing = now;
            if (ring) ring.style.setProperty('--ld', Math.round(126 * (1 - frac)));
          }
          return pump();
        });
      }
      return pump().then(function () {
        clearTimeout(watchdog);
        if (ring) ring.style.setProperty('--ld', 0);
        video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
        video.load();
        video.addEventListener('canplay', function () {
          requestSeek(heroProgress() * video.duration);
          stage.classList.add('video-ready');
        }, { once: true });
      });
    });
  }

  function initHeroOnce() {
    if (heroInited) return;
    heroInited = true;
    poster.style.backgroundImage = "url('" + POSTER_URL + "')";
    var img = new Image();
    img.onload = startBlobFetch;
    img.onerror = startBlobFetch;
    img.src = POSTER_URL;
    setTimeout(startBlobFetch, 4000);

    loadStart = performance.now();
    buildDust();
  }

  function buildDust() {
    if (!dust || dust.childNodes.length) return;
    if (matchMedia('(pointer: coarse)').matches) return;
    var r = rng(4242);
    for (var i = 0; i < 16; i++) {
      var d = document.createElement('i');
      d.style.left = (r() * 100).toFixed(1) + '%';
      d.style.top = (40 + r() * 60).toFixed(1) + '%';
      d.style.animationDuration = (16 + r() * 16).toFixed(1) + 's';
      d.style.animationDelay = (-r() * 26).toFixed(1) + 's';
      d.style.opacity = (0.25 + r() * 0.5).toFixed(2);
      dust.appendChild(d);
    }
  }

  /* ----------------------------------------------------------
     6. Пять условий статичного героя, живыми слушателями
     ---------------------------------------------------------- */
  var GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  var MQLS = GATES.map(function (q) { return matchMedia(q); });
  var scrubOn = false;

  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    initHeroOnce();
    window.addEventListener('scroll', onHeroScroll, { passive: true });
    for (var i = 0; i < bands.length; i++) { bands[i].op = -1; bands[i].k = -1; }
    unpinFinalStates();
    target = heroProgress();
    shown = target;
    updateCaptions(target);
    paintProgress(target);
    onHeroScroll();
  }

  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    window.removeEventListener('scroll', onHeroScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function applyHeroMode() {
    var gated = MQLS.some(function (m) { return m.matches; });
    if (gated) disableScrub(); else enableScrub();
  }
  MQLS.forEach(function (m) {
    if (m.addEventListener) m.addEventListener('change', applyHeroMode);
    else m.addListener(applyHeroMode);
  });

  /* ----------------------------------------------------------
     7. Появление секций, провод, шапка
     ---------------------------------------------------------- */
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.classList.add('in');
        setTimeout(function () { el.classList.add('done'); }, 1400);
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });

    var svcs = [].slice.call(document.querySelectorAll('.svc'));
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io2.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -18% 0px', threshold: 0.2 });
    svcs.forEach(function (el) { io2.observe(el); });

    var flickers = [].slice.call(document.querySelectorAll('.tube, .lamp'));
    var io3 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle('off', !e.isIntersecting); });
    }, { rootMargin: '60px' });
    flickers.forEach(function (el) { io3.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in', 'done'); });
    [].slice.call(document.querySelectorAll('.svc')).forEach(function (el) { el.classList.add('in'); });
  }

  var wireSvg = document.querySelector('.wire svg');
  var stepsBox = document.querySelector('.steps');
  var lastDraw = -1;
  if (wireSvg) wireSvg.style.setProperty('--len', 420);

  var lastNavSolid = null;
  function onPageScroll() {
    var solid = window.scrollY > 40;
    if (solid !== lastNavSolid) {
      lastNavSolid = solid;
      nav.classList.toggle('solid', solid);
    }
    if (wireSvg && stepsBox && !pinned) {
      var r = stepsBox.getBoundingClientRect();
      var d = clamp((window.innerHeight * 0.72 - r.top) / Math.max(1, r.height * 0.86), 0, 1);
      if (Math.abs(d - lastDraw) > 0.01) {
        lastDraw = d;
        wireSvg.style.setProperty('--draw', d.toFixed(3));
      }
    }
  }
  window.addEventListener('scroll', onPageScroll, { passive: true });
  window.addEventListener('resize', function () {
    lastDraw = -1;
    onPageScroll();
    if (scrubOn) onHeroScroll();
  }, { passive: true });

  /* ----------------------------------------------------------
     8. Живой момент: свет в боксе
     ---------------------------------------------------------- */
  var lightSec = document.getElementById('light');
  var hold = document.getElementById('hold');
  var lit = 0, holding = false, latched = false, holdRaf = null, holdLast = 0;

  var checkItems = [].slice.call(document.querySelectorAll('.checks li')).map(function (el) {
    return { el: el, d: parseFloat(el.style.getPropertyValue('--d') || '0'), on: false };
  });

  function paintLit() {
    if (lightSec) lightSec.style.setProperty('--lit', lit.toFixed(3));
    for (var i = 0; i < checkItems.length; i++) {
      var it = checkItems[i];
      var on = lit > it.d + 0.06;
      if (on !== it.on) {
        it.on = on;
        it.el.classList.toggle('on', on);
      }
    }
  }
  function holdTick(now) {
    var dt = Math.min(100, now - (holdLast || now));
    holdLast = now;
    if (holding) lit += dt / 1500; else lit -= dt / 900;
    lit = clamp(lit, 0, 1);
    if (lit >= 1) latched = true;
    if (latched) lit = 1;
    paintLit();
    if ((holding && lit < 1) || (!holding && lit > 0 && !latched)) {
      holdRaf = requestAnimationFrame(holdTick);
    } else {
      holdRaf = null;
      holdLast = 0;
    }
  }
  function startHold() {
    if (latched || holding) return;
    holding = true;
    if (holdRaf === null) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); }
  }
  function endHold() {
    if (!holding) return;
    holding = false;
    if (holdRaf === null && lit > 0 && !latched) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); }
  }
  function latchNow() {
    latched = true;
    lit = 1;
    paintLit();
  }
  if (hold) {
    hold.addEventListener('pointerdown', function (e) { e.preventDefault(); startHold(); });
    hold.addEventListener('pointerup', endHold);
    hold.addEventListener('pointercancel', endHold);
    hold.addEventListener('pointerleave', endHold);
    hold.addEventListener('blur', endHold);
    hold.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); startHold(); }
      else if (e.key === 'Enter') { e.preventDefault(); latchNow(); }
    });
    hold.addEventListener('keyup', function (e) {
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); endHold(); }
    });
    hold.addEventListener('click', function (e) { e.preventDefault(); });
  }

  /* ----------------------------------------------------------
     9. Меньше движения, в обе стороны
     ---------------------------------------------------------- */
  var pinned = false;

  function pinToFinalStates() {
    pinned = true;
    reveals.forEach(function (el) { el.classList.add('in', 'done'); });
    [].slice.call(document.querySelectorAll('.svc')).forEach(function (el) { el.classList.add('in'); });
    if (wireSvg) wireSvg.style.setProperty('--draw', 1);
    latchNow();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (holdRaf !== null) { cancelAnimationFrame(holdRaf); holdRaf = null; }
  }

  function unpinFinalStates() {
    if (!pinned) return;
    pinned = false;
    lastDraw = -1;
    latched = false;
    lit = 0;
    paintLit();
    onPageScroll();
  }

  reduceQuery.addEventListener ?
    reduceQuery.addEventListener('change', function (e) {
      if (e.matches) pinToFinalStates(); else applyHeroMode();
    }) :
    reduceQuery.addListener(function (e) {
      if (e.matches) pinToFinalStates(); else applyHeroMode();
    });

  /* ----------------------------------------------------------
     10. Пуск
     ---------------------------------------------------------- */
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
  });

  if (reduceQuery.matches) {
    pinToFinalStates();
  } else {
    applyHeroMode();
  }
  onPageScroll();
  paintLit();
})();
