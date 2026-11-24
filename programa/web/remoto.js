'use strict';
// (0.0.13) O programa completo no tablet do operador. No computador a tela conversa com o programa por
// window.chrome.webview; no tablet (página servida pela Mesa na rede, em /app/) este arquivo faz o mesmo papel
// por HTTP: POST /api/msg manda, GET /api/ev espera as mensagens (long-poll). Precisa vir ANTES de app.js.
(function () {
  if (window.chrome && window.chrome.webview) return;   // dentro do programa: nada a fazer
  let token = '';
  try { token = localStorage.getItem('mesa.celular.token') || ''; } catch (_) { }
  if (!token) { location.replace('/'); return; }        // sem pareamento: volta para a página de parear
  const sessao = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ouvintes = [];
  const q = () => '?t=' + encodeURIComponent(token) + '&s=' + sessao;
  let fila = [], mandando = false;
  async function esvaziar() {
    if (mandando || !fila.length) return;
    mandando = true;
    const lote = fila; fila = [];
    try {
      const r = await fetch('/api/msg' + q(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lote) });
      if (r.status === 401) return sair();
    } catch (_) { estado(false); }
    finally { mandando = false; if (fila.length) setTimeout(esvaziar, 0); }
  }
  function postMessage(o) {
    // vários "definir" da mesma chave no mesmo lote: só o último vale
    if (o && o.tipo === 'definir') fila = fila.filter(x => !(x.tipo === 'definir' && x.k === o.k));
    fila.push(o);
    if (fila.length === 1) setTimeout(esvaziar, 15);
  }
  function sair() { try { localStorage.removeItem('mesa.celular.token'); } catch (_) { } location.replace('/'); }
  function estado(ok) { document.documentElement.classList.toggle('sem-rede', !ok); }
  async function ouvir() {
    for (;;) {
      try {
        const r = await fetch('/api/ev' + q(), { cache: 'no-store' });
        if (r.status === 401) return sair();
        if (!r.ok) throw new Error(r.status);
        const lista = await r.json();
        estado(true);
        for (const m of lista) for (const f of ouvintes) { try { f({ data: m }); } catch (e) { console.error(e); } }
      } catch (_) { estado(false); await new Promise(z => setTimeout(z, 1500)); }
    }
  }
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage, addEventListener: (tipo, f) => { if (tipo === 'message') ouvintes.push(f); } };
  window.MESA_REMOTO = true;
  document.documentElement.classList.add('remoto');
  setTimeout(ouvir, 0);
})();
