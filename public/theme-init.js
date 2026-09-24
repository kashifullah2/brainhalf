/* Apply the saved appearance before styles paint; no inline script is required. */
(() => {
  let preference;
  try { preference = localStorage.getItem('brainhalf_theme'); } catch {}
  const theme = preference === 'light' || preference === 'dark'
    ? preference : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111722' : '#f8f9fc');
})();
