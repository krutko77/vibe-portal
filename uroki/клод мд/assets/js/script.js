// ===== Шпаргалка .md / CLAUDE.md — скрипты интерфейса =====

document.addEventListener('DOMContentLoaded', function () {

  /* --- 1. Подсветка активного пункта меню при прокрутке --- */
  const links = Array.from(document.querySelectorAll('.nav__link'));
  const sections = links
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  function setActive(id) {
    links.forEach(link => {
      link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      // Берём самую верхнюю видимую секцию
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

    sections.forEach(section => observer.observe(section));
  }

  /* --- 2. Мобильное меню (открыть / закрыть) --- */
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menuToggle');
  const overlay = document.getElementById('overlay');

  function openMenu() {
    sidebar.classList.add('is-open');
    overlay.classList.add('is-open');
  }
  function closeMenu() {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-open');
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.contains('is-open') ? closeMenu() : openMenu();
    });
  }
  if (overlay) overlay.addEventListener('click', closeMenu);
  // На телефоне после клика по разделу меню закрывается
  links.forEach(link => link.addEventListener('click', closeMenu));

  /* --- 3. Кнопки «Копировать» у блоков кода --- */
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const block = btn.closest('.code-block');
      const codeEl = block && block.querySelector('code');
      if (!codeEl) return;

      const text = codeEl.innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        // Запасной способ, если буфер обмена недоступен
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      const original = btn.textContent;
      btn.textContent = 'Скопировано ✓';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1600);
    });
  });

});
