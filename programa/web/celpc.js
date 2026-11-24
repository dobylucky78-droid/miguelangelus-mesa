'use strict';
// (0.0.10) Ajustes › 📱 Celulares e tablets: ligar, para quem é o próximo código (operador ou o retorno de um músico),
// QR code e os aparelhos pareados. O servidor é o Motor\Celular.cs.
(() => {
  const el = id => document.getElementById(id);
  const env = o => window.chrome?.webview?.postMessage(o);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let C = null;

  function qrSvg(texto) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  }
  function quando(ms) {
    if (!ms) return '';
    const s = (Date.now() - ms) / 1000;
    if (s < 120) return 'agora';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  // (os nomes das aux vêm do computador, junto com o estado: o Mixer pode ainda não ter sido aberto)
  const nAux = () => (C?.auxes || []).length || 10;
  const nomeAux = n => C?.auxes?.[n]?.nome || `Aux ${n + 1}`;
  const ehMatriz = n => !!C?.auxes?.[n]?.matriz;
  const txtPerfil = p => p === 'operador' ? 'Operador' : /^aux:\d+$/.test(p || '') ? `Retorno: ${nomeAux(+p.slice(4))}` : p;

  function render() {
    if (!C) return;
    const bt = el('celLigar');
    bt.textContent = C.ligado ? 'Ligado' : 'Desligado'; bt.classList.toggle('sel', !!C.ligado);
    const p = el('celPainel');
    if (!C.ligado) { p.innerHTML = '<p class="dica" style="margin:0">Desligado: nenhum celular ou tablet consegue mexer na mesa.</p>' + lista(); return; }
    if (!C.porta) { p.innerHTML = `<p class="dica" style="margin:0">Não consegui ligar (${esc(C.erro || 'erro')}).</p>` + lista(); return; }
    const end = (C.enderecos || [])[0];
    const url = end ? `http://${end}:${C.porta}/?c=${C.codigo}` : '';
    const opcoes = ['<option value="operador">Operador (mix principal e todos os retornos)</option>'];
    for (let a = 0; a < nAux(); a++) if (!ehMatriz(a)) opcoes.push(`<option value="aux:${a}">Músico — só o retorno ${esc(nomeAux(a))}</option>`);
    p.innerHTML = `<label class="campo">O próximo aparelho a parear será
        <select id="celPerfil" style="max-width:420px">${opcoes.join('')}</select></label>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px">
        ${url ? `<div style="width:150px;height:150px;background:#fff;border-radius:8px;padding:4px">${qrSvg(url)}</div>` : ''}
        <div style="flex:1;min-width:220px">
          <div class="dica">Aponte a câmera do aparelho para o QR code, ou abra no navegador dele:</div>
          ${(C.enderecos || []).map(a => `<div style="font:600 15px Consolas,monospace;margin:4px 0">http://${esc(a)}:${C.porta}</div>`).join('') || '<div class="dica">Este computador não está em nenhuma rede.</div>'}
          <div class="dica" style="margin-top:6px">Código: <b style="font:700 22px Consolas,monospace;letter-spacing:4px;color:var(--ac)">${esc(C.codigo)}</b>
            <span>· ${esc(txtPerfil(C.perfilCodigo))} · serve para um aparelho só</span></div>
        </div></div>` + lista();
    const sel = el('celPerfil'); sel.value = C.perfilCodigo || 'operador';
    sel.onchange = () => env({ tipo: 'celCodigo', perfil: sel.value });
  }
  function lista() {
    const ap = C.aparelhos || [];
    if (!ap.length) return '<p class="dica" style="margin:10px 0 0">Nenhum aparelho pareado.</p>';
    return '<div class="dica" style="margin:12px 0 4px">Aparelhos pareados</div>' + ap.map(a =>
      `<div class="cel-ap">📱 <b>${esc(a.nome)}</b> <span class="dica">· ${esc(txtPerfil(a.perfil))} · visto ${esc(quando(a.visto))}</span><span class="espaco"></span><button class="peq" data-cel-tirar="${esc(a.id)}">Tirar</button></div>`).join('');
  }

  window.chrome?.webview?.addEventListener('message', e => { if (e.data?.tipo === 'celular') { C = e.data; render(); } });
  el('celLigar').onclick = () => env({ tipo: 'celLigar', on: !C?.ligado });
  el('celPainel').addEventListener('click', e => {
    const b = e.target.closest('[data-cel-tirar]');
    if (b && confirm('Tirar este aparelho? Ele vai precisar parear de novo.')) env({ tipo: 'celTirar', id: b.dataset.celTirar });
  });
  setTimeout(() => env({ tipo: 'celPedir' }), 800);
  // "visto há…" e os endereços (o Wi-Fi pode mudar): de tempos em tempos, com Ajustes aberto
  setInterval(() => { if (el('celPn')?.offsetParent) env({ tipo: 'celPedir' }); }, 20000);
})();
