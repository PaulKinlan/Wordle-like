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
