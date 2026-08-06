(function () {
  // Inject a style rule to hide <vg-pause-f> elements. The vg-pause-f tag creates an ad placeholder which will be displayed when video is paused.
  const style = document.createElement('style');
  style.id = 'remove-iyf-ads-style';
  style.textContent = 'vg-pause-f { display: none !important; }';

  function injectStyle() {
    const target = document.head || document.documentElement;
    if (target && style.parentNode !== target) {
      target.appendChild(style);
    }
  }

  // Try to inject immediately
  injectStyle();

  // Watch for any DOM mutations. If our style tag is removed or if the head/body changes,
  // ensure the style tag is still attached.
  const observer = new MutationObserver(() => {
    injectStyle();
  });
  observer.observe(document, { childList: true, subtree: true });
})();
