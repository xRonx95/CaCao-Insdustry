// Shared motion enhancement. Content stays visible if JavaScript is unavailable.
(() => {
  const header = document.querySelector('.topbar');
  let scrollPending = false;
  function updateHeader() {
    header?.classList.toggle('is-scrolled', window.scrollY > 12);
    scrollPending = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollPending) {
      scrollPending = true;
      requestAnimationFrame(updateHeader);
    }
  }, { passive: true });
  updateHeader();

  if (!window.matchMedia || !window.IntersectionObserver || !Element.prototype.animate) return;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet();
  const active = new Set();
  const selector = [
    '.hero-copy', '.hero-visual', '.about-hero > div', '.about-hero > img',
    '.impact-hero', '.auth-panel', '.auth-form', '.page-heading',
    '.stat', '.post-card', '.farm-item', '.about-grid > article',
    '.impact-grid > details', '.capability-grid > article', '.about-questions', '.about-invite',
    '.impact-note', '.impact-invite', '.dashboard-links > a', '.post-form'
  ].join(',');

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (motionPreference.matches) continue;
      const siblings = Array.from(entry.target.parentElement.children);
      const delay = Math.min(siblings.indexOf(entry.target) % 3, 2) * 65;
      const animation = entry.target.animate([
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 480, delay, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' });
      active.add(animation);
      animation.finished.then(() => active.delete(animation), () => active.delete(animation));
    }
  }, { threshold: 0.08 });

  function register(root) {
    if (!(root instanceof Element)) return;
    const elements = root.matches(selector) ? [root] : [];
    elements.push(...root.querySelectorAll(selector));
    for (const element of elements) {
      if (seen.has(element)) continue;
      seen.add(element);
      observer.observe(element);
    }
  }
  register(document.body);

  // Include newly fetched feed cards and plantation directory links.
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        observer.unobserve(node);
        node.querySelectorAll(selector).forEach(element => observer.unobserve(element));
      }
      for (const node of record.addedNodes) register(node);
    }
  });
  mutations.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });

  function stopAnimations() {
    for (const animation of active) animation.cancel();
    active.clear();
  }
  motionPreference.addEventListener('change', () => {
    if (motionPreference.matches) stopAnimations();
  });
  // Keyboard users see focused controls immediately, even during an entrance.
  document.addEventListener('focusin', stopAnimations);
})();
