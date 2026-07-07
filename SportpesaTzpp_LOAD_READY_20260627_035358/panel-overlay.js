// Injects the extension panel (sidepanel.html) as a fixed-width overlay iframe
// docked to the right edge of the SportPesa page. This gives a fixed narrow panel
// that stays open, without relying on Chrome's side panel width.
(function () {
  // Only run in the top frame of the real page (never inside our own iframe).
  if (window.top !== window) return;
  if (document.getElementById('sp-prematch-overlay-host')) return;

  var PANEL_WIDTH = 220;

  var host = document.createElement('div');
  host.id = 'sp-prematch-overlay-host';
  host.style.cssText = [
    'position: fixed',
    'top: 0',
    'right: 0',
    'width: ' + PANEL_WIDTH + 'px',
    'height: 100vh',
    'z-index: 2147483647',
    'margin: 0',
    'padding: 0',
    'background: #f5f5f5',
    'border-left: 1px solid #cccccc',
    'box-shadow: -2px 0 8px rgba(0,0,0,0.25)',
    'transition: transform 0.2s ease'
  ].join(';');

  var iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('sidepanel.html');
  iframe.setAttribute('title', 'SportPesa panel');
  iframe.style.cssText = 'width: 100%; height: 100%; border: 0; margin: 0; padding: 0; display: block; background: #f5f5f5;';
  host.appendChild(iframe);

  var toggle = document.createElement('button');
  toggle.id = 'sp-prematch-overlay-toggle';
  toggle.type = 'button';
  toggle.textContent = '\u276F'; // >
  toggle.title = 'Sakrij / prikazi panel';
  toggle.style.cssText = [
    'position: fixed',
    'top: 8px',
    'right: ' + (PANEL_WIDTH + 4) + 'px',
    'z-index: 2147483647',
    'width: 22px',
    'height: 28px',
    'border: none',
    'border-radius: 4px 0 0 4px',
    'background: #6f42c1',
    'color: #ffffff',
    'cursor: pointer',
    'font-size: 14px',
    'line-height: 28px',
    'padding: 0',
    'box-shadow: -1px 1px 4px rgba(0,0,0,0.3)'
  ].join(';');

  // Reserve space so the panel does NOT cover the site: push the page left by PANEL_WIDTH.
  var applyReserve = function (on) {
    var root = document.documentElement;
    if (!root) return;
    root.style.setProperty('transition', 'margin-right 0.2s ease');
    root.style.setProperty('margin-right', on ? (PANEL_WIDTH + 'px') : '0px', 'important');
    // Keep the left side anchored so the page's left edge does not scroll out of
    // view when the reserved area overflows (e.g. on browser zoom-out).
    if (on) {
      root.style.setProperty('overflow-x', 'hidden', 'important');
    } else {
      root.style.removeProperty('overflow-x');
    }
  };

  var hidden = false;
  toggle.addEventListener('click', function () {
    hidden = !hidden;
    host.style.transform = hidden ? ('translateX(' + PANEL_WIDTH + 'px)') : 'translateX(0)';
    toggle.style.right = hidden ? '4px' : (PANEL_WIDTH + 4 + 'px');
    toggle.textContent = hidden ? '\u276E' : '\u276F'; // < : >
    applyReserve(!hidden);
  });

  var mount = function () {
    var root = document.documentElement;
    if (!root) return;
    root.appendChild(host);
    root.appendChild(toggle);
    applyReserve(true);
  };

  mount();
})();
