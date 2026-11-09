if (/^\/admin\/?$/.test(location.pathname)) {
  const { initAdmin } = await import('./admin');
  initAdmin();
} else if (/^\/markets\/?$/.test(location.pathname)) {
  const { initMarketsPage } = await import('./markets-page');
  initMarketsPage();
} else if (/^\/support\/?$/.test(location.pathname)) {
  const { initSupportPage } = await import('./support-page');
  initSupportPage();
} else {
  await import('./main');
}

export {};
