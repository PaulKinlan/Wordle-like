// Applies the saved light/dark choice before the page paints, so there's no
// flash of the wrong theme. A classic script (not a module) so it runs at once.
// The setting itself is in Settings (src/main.ts, applyTheme).
(function () {
  var theme = 'system';
  try {
    theme = localStorage.getItem('letterle:theme') || 'system';
  } catch (e) {}
  if (theme === 'light' || theme === 'dark') {
    var root = document.documentElement;
    root.dataset.theme = theme;
    var colors = { light: '#f6f6f3', dark: '#121316' };
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', colors[theme]);
    });
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', theme);
  }
})();

// The installed app on Android: keep the page above the navigation bar.
// With viewport-fit=cover Chrome draws the page edge to edge, behind the
// bar, and relies on env(safe-area-inset-bottom) to keep content clear of
// it; in the installed app that inset has come back as 0, which hid the
// result panel under an opaque bar. Without "cover" Chrome lays the page
// out between the bars. iPhone keeps "cover" for the notch.
(function () {
  try {
    var standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
    if (!standalone || !/Android/i.test(navigator.userAgent)) return;
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', vp.getAttribute('content').replace(/,\s*viewport-fit=cover/, ''));
    document.documentElement.classList.add('android-app');
  } catch (e) {}
})();
