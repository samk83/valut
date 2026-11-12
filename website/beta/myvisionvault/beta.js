/* Private Vision Vault beta page: turns on the TestFlight buttons when config.js has a link.
   No tracking and no requests of its own. */
(function () {
  var cfg = window.PVV_CONFIG || {};
  var url = String(cfg.testflightUrl || '').trim();
  // Only accept Apple's TestFlight invite links.
  if (!/^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+\/?$/.test(url)) return;

  Array.prototype.forEach.call(document.querySelectorAll('[data-testflight]'), function (a) {
    a.href = url;
    a.rel = 'noopener';
    a.classList.add('is-live');
    var small = a.querySelector('[data-tf-small]');
    if (small) small.textContent = 'Open on iPhone or iPad';
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tf-note]'), function (p) {
    p.textContent = 'Open this page on your iPhone or iPad, then tap the button.';
  });
})();
