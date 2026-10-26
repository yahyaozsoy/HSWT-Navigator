// Resolve the theme before first paint so dark mode doesn't flash white.
try {
  const t = JSON.parse(localStorage.getItem('hswt.theme'));
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch {}
