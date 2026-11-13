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
    if (small) small.textContent = cfg.reviewPending ? 'Opens after Apple’s review' : 'Open on iPhone or iPad';
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tf-note]'), function (p) {
    p.textContent = cfg.reviewPending
      ? 'Apple is still reviewing the first beta build. The link starts working once Apple approves it, usually within a day or two. If TestFlight says the beta isn’t accepting testers yet, please try again later.'
      : 'Open this page on your iPhone or iPad, then tap the button.';
  });
})();
