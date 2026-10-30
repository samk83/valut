/* PrivateVault site: scroll story screen switching + intro film placeholder. No tracking, no requests of its own. */
(function () {
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var screens = Array.prototype.slice.call(document.querySelectorAll('#phone-screen .scr'));
  var screenWrap = document.getElementById('phone-screen');

  // Phones (narrow layout): put a still copy of each screen under its step.
  steps.forEach(function (step) {
    var shot = step.querySelector('.step-shot');
    var src = screens[Number(step.dataset.step)];
    if (!shot || !src) return;
    var phone = document.createElement('div');
    phone.className = 'phone';
    phone.setAttribute('aria-hidden', 'true');
    var scr = document.createElement('div');
    scr.className = 'phone-screen';
    var copy = src.cloneNode(true);
    copy.classList.add('is-active');
    scr.appendChild(copy);
    phone.appendChild(scr);
    shot.appendChild(phone);
  });

  function activate(i) {
    steps.forEach(function (s, n) { s.classList.toggle('is-current', n === i); });
    screens.forEach(function (s, n) { s.classList.toggle('is-active', n === i); });
  }

  if ('IntersectionObserver' in window && screenWrap) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) activate(Number(e.target.dataset.step));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { io.observe(s); });
  }

  var play = document.getElementById('film-play');
  var status = document.getElementById('film-status');
  if (play && status) {
    play.addEventListener('click', function () {
      status.textContent = '';
      setTimeout(function () { status.textContent = '소개 영상은 출시 전에 공개됩니다.'; }, 50);
    });
  }
})();
