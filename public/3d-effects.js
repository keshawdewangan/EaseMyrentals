/* EaseMyRentals — 3D Effects Engine */
(function () {
  'use strict';

  /* ── 1. Mouse-tracked card tilt ──────────────────── */
  function applyTilt(card) {
    card.classList.add('tilt-card');

    card.addEventListener('mousemove', function (e) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rotX = ((y - cy) / cy) * -10;
      const rotY = ((x - cx) / cx) * 10;
      card.style.setProperty('--rotX', rotX.toFixed(2) + 'deg');
      card.style.setProperty('--rotY', rotY.toFixed(2) + 'deg');
    });

    card.addEventListener('mouseleave', function () {
      card.style.setProperty('--rotX', '0deg');
      card.style.setProperty('--rotY', '0deg');
    });
  }

  function initTiltCards() {
    const selectors = [
      '.data-card',
      '.listing-card',
      '.stat-card',
      '.process-grid article',
      '.owner-grid article',
      '.testimonial-grid figure'
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(applyTilt);
    });
  }

  /* ── 2. Scroll reveal with 3D entrance ───────────── */
  function initScrollReveal() {
    const targets = document.querySelectorAll(
      '.section-heading, .process-grid article, .owner-grid article, ' +
      '.testimonial-grid figure, .listing-card, .data-card, .stat-card, .contact-form'
    );

    if (!targets.length) return;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-3d', 'is-visible');
          observer.unobserve(entry.target);
        } else {
          entry.target.classList.add('reveal-3d');
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(function (el) {
      el.classList.add('reveal-3d');
      observer.observe(el);
    });
  }

  /* ── 3. Hero parallax on mouse move ─────────────── */
  function initHeroParallax() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    hero.addEventListener('mousemove', function (e) {
      const rect = hero.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = (e.clientX - rect.left - cx) / cx;
      const dy = (e.clientY - rect.top - cy) / cy;

      const h1 = hero.querySelector('h1');
      const eyebrow = hero.querySelector('.eyebrow');
      const copy = hero.querySelector('.hero-copy');
      const actions = hero.querySelector('.hero-actions');
      const metrics = hero.querySelector('.hero-metrics');

      if (h1)      h1.style.transform      = `translateZ(30px) translate(${dx * -8}px, ${dy * -8}px)`;
      if (eyebrow) eyebrow.style.transform = `translateZ(40px) translate(${dx * -12}px, ${dy * -12}px)`;
      if (copy)    copy.style.transform    = `translateZ(20px) translate(${dx * -5}px, ${dy * -5}px)`;
      if (actions) actions.style.transform = `translateZ(35px) translate(${dx * -10}px, ${dy * -10}px)`;
      if (metrics) metrics.style.transform = `translateZ(15px) translate(${dx * -4}px, ${dy * -4}px)`;
    });

    hero.addEventListener('mouseleave', function () {
      ['h1', '.eyebrow', '.hero-copy', '.hero-actions', '.hero-metrics'].forEach(function (sel) {
        const el = hero.querySelector(sel);
        if (el) el.style.transform = '';
      });
    });
  }

  /* ── 4. Re-init on dynamic content (portal renders) ── */
  function observeDOMChanges() {
    const observer = new MutationObserver(function (mutations) {
      let shouldReinit = false;
      mutations.forEach(function (m) {
        if (m.addedNodes.length) shouldReinit = true;
      });
      if (shouldReinit) {
        if (!isTouchDevice()) initTiltCards();
        initScrollReveal();
      }
    });
    const target = document.getElementById('app') || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  /* ── 5. Init ─────────────────────────────────────── */
  function isTouchDevice() {
    return window.matchMedia('(hover: none)').matches || window.innerWidth <= 768;
  }

  function init() {
    if (!isTouchDevice()) {
      initTiltCards();
      initHeroParallax();
    }
    initScrollReveal();
    observeDOMChanges();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
