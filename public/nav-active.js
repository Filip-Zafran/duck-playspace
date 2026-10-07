(() => {
  const normalizePath = path => path.replace(/\/+$/, '') || '/';
  const pathAliases = {
    '/dashboard': '/home',
    '/quiz-editor': '/communication'
  };
  const currentPath = pathAliases[normalizePath(window.location.pathname)] || normalizePath(window.location.pathname);

  document.querySelectorAll('.navbar .nav-link').forEach(link => {
    const linkPath = normalizePath(new URL(link.href, window.location.origin).pathname);
    const isCurrentPage = linkPath === currentPath;
    link.classList.toggle('active', isCurrentPage);
    if (isCurrentPage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
})();
