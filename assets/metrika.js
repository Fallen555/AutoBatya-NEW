/* Яндекс Метрика загружается только после согласия посетителя. */
(function () {
  'use strict';

  var COUNTER_ID = 112650981;
  var STORAGE_KEY = 'autobatya_analytics_consent_v1';
  var metrikaLoaded = false;

  function readChoice() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveChoice(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Метрика всё равно может работать в текущей вкладке после явного согласия.
    }
  }

  function loadMetrika() {
    if (metrikaLoaded) return;
    metrikaLoaded = true;

    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < e.scripts.length; j++) {
        if (e.scripts[j].src === r) return;
      }
      k = e.createElement(t);
      a = e.getElementsByTagName(t)[0];
      k.async = 1;
      k.src = r;
      a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + COUNTER_ID, 'ym');

    window.ym(COUNTER_ID, 'init', {
      ssr: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: window.location.href,
      accurateTrackBounce: true,
      trackLinks: true
    });
  }

  function buildBanner() {
    var banner = document.createElement('section');
    banner.className = 'analytics-consent';
    banner.hidden = true;
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'analytics-consent-title');
    banner.innerHTML =
      '<div class="analytics-consent__copy">' +
        '<strong id="analytics-consent-title">Статистика посещений</strong>' +
        '<p>Яндекс Метрика помогает нам понять, какие разделы сайта полезны. Счётчик включится только с вашего согласия. <a href="privacy.html#analytics">Подробнее</a></p>' +
      '</div>' +
      '<div class="analytics-consent__actions">' +
        '<button type="button" class="analytics-consent__accept" data-analytics-choice="accepted">Разрешить</button>' +
        '<button type="button" class="analytics-consent__decline" data-analytics-choice="declined">Не разрешать</button>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  var banner = buildBanner();

  function showBanner() {
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  banner.addEventListener('click', function (event) {
    var button = event.target.closest('[data-analytics-choice]');
    if (!button) return;
    var choice = button.getAttribute('data-analytics-choice');
    saveChoice(choice);
    hideBanner();

    if (choice === 'accepted') {
      loadMetrika();
    } else if (metrikaLoaded) {
      window.location.reload();
    }
  });

  var settingsButtons = document.querySelectorAll('[data-analytics-settings]');
  for (var i = 0; i < settingsButtons.length; i++) {
    settingsButtons[i].addEventListener('click', showBanner);
  }

  if (readChoice() === 'accepted') {
    loadMetrika();
  } else if (readChoice() !== 'declined') {
    showBanner();
  }
})();
