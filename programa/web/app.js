'use strict';
// MiguelAngelus Mesa — tela. Conversa com o programa por window.chrome.webview (JSON {tipo: ...}).
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mandar = o => window.chrome?.webview?.postMessage(o);

const E = { mesa: null, bib: null, exports: [], cmp: null, sel: null, querPendrive: false };

// ---------- abas ----------
function aba(nome) {
  $$('.navb').forEach(b => b.classList.toggle('sel', b.dataset.aba === nome));
  $$('main > section').forEach(s => s.hidden = s.dataset.aba !== nome);
  if (nome === 'biblioteca') mandar({ tipo: 'biblioteca' });
  mandar({ tipo: 'mixer', aberto: nome === 'mixer' });   // (0.0.2) medidores só com o mixer à vista
}
$$('.navb').forEach(b => b.onclick = () => aba(b.dataset.aba));

// ---------- (0.0.14) Sobre: clique no logotipo/nome ----------
$('#marca').onclick = () => { const d = $('#dlgSobre'); if (!d.open) d.showModal(); };
$$('#dlgSobre [data-link]').forEach(b => b.onclick = () => mandar({ tipo: 'abrirLink', url: b.dataset.link }));
$('#dlgSobre').onclick = e => { if (e.target === e.currentTarget) e.currentTarget.close(); };   // clique fora fecha

let toastT;
function toast(t, ms = 5000) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }

// ---------- (0.0.12) tela de abertura: fica enquanto coleta os dados da mesa ----------
const SPLASH = { ini: Date.now(), fechada: false, timer: 0 };
function fecharSplash(espera = 0) {
  if (SPLASH.fechada) return;
  clearTimeout(SPLASH.timer);
  SPLASH.timer = setTimeout(() => {
    if (SPLASH.fechada) return;
    SPLASH.fechada = true;
    $('#splash').classList.add('saindo');
    setTimeout(() => $('#splash')?.remove(), 400);
  }, Math.max(0, espera));
}
function splashMesa(m) {
  if (SPLASH.fechada) return;
  const passou = Date.now() - SPLASH.ini, st = $('#splashStatus');
  if (!m.ip) { st.textContent = 'Nenhuma mesa escolhida — veja em Ajustes'; fecharSplash(3000 - passou); }
  else if (m.pronta) { st.textContent = `${nomeModelo(m.modelo)} pronta · ${m.parametros.toLocaleString('pt-BR')} parâmetros`; fecharSplash(Math.max(1200, 3000 - passou)); }
  else if (m.conectada) st.textContent = 'Recebendo o estado da mesa…';
  else { st.textContent = 'Procurando a mesa na rede…'; if (passou > 12000) { st.textContent = 'A mesa não respondeu — seguindo sem ela'; fecharSplash(1500); } }
}
setTimeout(() => { if (!SPLASH.fechada) { $('#splashStatus').textContent = 'Seguindo — a mesa ainda está respondendo'; fecharSplash(1200); } }, 20000);
$('#splash')?.addEventListener('click', () => fecharSplash());   // pressa: um clique fecha

// ---------- mesa ----------
function renderMesa() {
  const m = E.mesa; if (!m) return;
  splashMesa(m);
  const dot = $('#dotMesa');
  dot.className = 'dot ' + (m.pronta ? 'ok' : m.conectada ? 'av' : m.ip ? 'erro' : '');
  $('#txtMesa').textContent = !m.ip ? 'Sem mesa' : m.pronta ? `${nomeModelo(m.modelo)} · ${m.ip}` : m.conectada ? 'Recebendo o estado da mesa…' : `Procurando a mesa em ${m.ip}…`;
  $('#pillMesa').title = m.erro ? 'Último erro: ' + m.erro : '';
  $('#semMesa').hidden = m.pronta; $('#comMesa').hidden = !m.pronta;
  $('#mShow').textContent = m.show || '—'; $('#mSnap').textContent = m.snapshot || '—'; $('#mCue').textContent = m.cue || '—';
  $('#mModelo').textContent = m.pronta ? `${nomeModelo(m.modelo)} · firmware ${m.firmware} · ${m.parametros.toLocaleString('pt-BR')} parâmetros` : '';
  $('#bkAcoes').hidden = !m.pronta;
  if (!E.trazendo) { $('#btnTrazer').disabled = !m.pronta; if (!E.trazerFim) $('#trazerInfo').textContent = m.pronta ? '' : 'Conecte a mesa primeiro.'; }
  renderBackup();
  if (E.querPendrive && m.pendrives?.length) {
    E.querPendrive = false;
    mandar({ tipo: 'exportarPendrive', pendrive: m.pendrives[0], show: m.show });
    toast(`Pedindo à mesa para gravar o show "${m.show}" no pendrive "${m.pendrives[0]}"…`);
  }
}
const nomeModelo = m => ({ ui24: 'Ui24R', ui16: 'Ui16', ui12: 'Ui12' }[m] || m || 'Mesa');

// o que está na mesa × o que está guardado
function renderBackup() {
  const m = E.mesa, b = E.bib, el = $('#listaBackup');
  if (!m?.pronta || !m.shows?.length) { $('#resumoBackup').textContent = ''; return; }
  const guardados = new Map((b?.shows || []).map(s => [s.nome, new Set(s.snapshots.map(x => x.nome))]));
  let total = 0, ok = 0;
  el.innerHTML = m.shows.filter(s => s.snapshots.length || s.cues.length).map(s => {
    const g = guardados.get(s.nome) || new Set();
    const itens = s.snapshots.map(n => { total++; const tem = g.has(n); if (tem) ok++;
      return `<span class="bk ${tem ? 'ok' : 'falta'} ${s.nome === m.show && n === m.snapshot ? 'atual' : ''}" title="${tem ? 'Guardado no programa' : 'Ainda NÃO está guardado no programa'}">${tem ? '✓' : '!'} ${esc(n)}</span>`; }).join('');
    const cues = s.cues.length ? `<div class="dica" style="margin-top:4px">${s.cues.length} cue(s): ${esc(s.cues.join(', '))}</div>` : '';
    return `<div class="bk-show"><b>${esc(s.nome)}</b><div class="bk-itens">${itens || '<span class="dica">sem snapshots</span>'}</div>${cues}</div>`;
  }).join('') || '<span class="dica">A mesa não tem shows gravados.</span>';
  $('#resumoBackup').textContent = total ? (ok === total ? `✓ tudo guardado (${total} snapshots)` : `${ok} de ${total} snapshots guardados`) : '';
}

$('#btnGuardarAtual').onclick = () => {
  const m = E.mesa; if (!m?.pronta) return;
  if (!m.show || !m.snapshot) return toast('A mesa não está em nenhum snapshot agora.');
  mandar({ tipo: 'guardarDaMesa', show: m.show, snapshot: m.snapshot });
};
// (0.0.12) trazer tudo da mesa pela rede
$('#btnTrazer').onclick = () => {
  const m = E.mesa; if (!m?.pronta) return;
  const n = (m.shows || []).reduce((a, s) => a + s.snapshots.length + s.cues.length, 0);
  if (!confirm(`Trazer e atualizar TUDO o que está gravado na mesa?\n\n` +
    `São ${n} snapshot(s)/cue(s) em ${(m.shows || []).length} show(s), mais os presets do usuário.\n\n` +
    `⚠ A mesa vai carregar um por um: O SOM MUDA várias vezes durante a cópia (cerca de 3 s cada). Use fora das celebrações, com as caixas baixas ou desligadas.\n\n` +
    `No fim a mesa volta ao show e ao som exatos de agora (o som de agora também fica guardado na Biblioteca, em "⟲ Antes de carregar").\n` +
    `Canais protegidos (safe) não mudam ao carregar: neles fica guardado o valor do momento.`)) return;
  mandar({ tipo: 'trazerTudo' });
};
$('#btnPararTrazer').onclick = () => mandar({ tipo: 'pararTrazer' });
function trazer(m) {
  const info = $('#trazerInfo');
  E.trazendo = !m.fim; E.trazerFim = !!m.fim;
  $('#btnTrazer').disabled = !m.fim; $('#btnPararTrazer').hidden = !!m.fim;
  if (!m.fim) { info.textContent = m.total ? `${m.feito} de ${m.total} — ${m.item}` : m.item; return; }
  const quando = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  info.innerHTML = m.erro ? 'Parou: ' + esc(m.erro)
    : `${quando}: ${m.ok} de ${m.total} — <b>${m.novos} novo(s), ${m.mudados} atualizado(s)</b>, ${m.iguais} já iguais` +
      (m.presets ? `; presets: ${m.presets} (${m.prNovos} novo(s), ${m.prMudados} atualizado(s))` : '') +
      (m.falhas?.length ? `; <b>não vieram:</b> ${esc(m.falhas.join(', '))}` : '') + (m.parou ? ' (parado por você)' : '') +
      (m.aDevolver != null ? ` · mesa devolvida (${m.devolvidos}/${m.aDevolver})` : '') + (m.safes ? ` · ${m.safes} canal(is) safe (guardado o valor do momento)` : '') +
      (m.mudadosNomes?.length ? `<br>Atualizados: ${esc(m.mudadosNomes.join(', '))}` : '');
}
$('#btnCompararAtual').onclick = () => {
  const m = E.mesa; if (!m?.pronta) return;
  aba('biblioteca'); comparar(m.show, m.snapshot);
};
$('#btnPendrive').onclick = () => { E.querPendrive = true; mandar({ tipo: 'pendrives' }); setTimeout(() => { if (E.querPendrive) { E.querPendrive = false; toast('A mesa não encontrou nenhum pendrive. Ele precisa estar em FAT32 (até 32 GB).'); } }, 4000); };

// ---------- biblioteca ----------
function renderBiblioteca() {
  const b = E.bib; if (!b) return;
  $('#bibPasta').textContent = '';
  $('#exports').innerHTML = E.exports.length
    ? E.exports.map(p => `<div class="linha" style="margin:4px 0"><span>📀 Pendrive com arquivos da mesa: <b>${esc(p)}</b></span><button class="peq prim" data-imp="${esc(p)}">Guardar no programa</button></div>`).join('')
    : 'Nenhum pendrive com arquivos da mesa ligado agora.';
  $$('[data-imp]').forEach(x => x.onclick = () => mandar({ tipo: 'importar', pasta: x.dataset.imp }));
  $('#bibShows').innerHTML = b.shows.length ? b.shows.map(s => `
    <div class="show"><h4>${esc(s.nome)} <span class="dica">${s.snapshots.length} snapshot(s)${s.cues.length ? ' · ' + s.cues.length + ' cue(s)' : ''}</span>
      ${s.temShow || s.snapshots.some(x => x.origem === 'pendrive') ? `<button class="peq" data-pen="${esc(s.nome)}" title="Para recriar este show na mesa (mesa com a memória perdida, ou outra mesa): copia para um pendrive; depois a mesa importa">📀 Copiar para o pendrive</button>` : ''}</h4>
      ${s.snapshots.map(x => `<button class="snap ${E.sel && E.sel.show === s.nome && E.sel.snap === x.nome ? 'sel' : ''}" data-show="${esc(s.nome)}" data-snap="${esc(x.nome)}">
        <span>${esc(x.nome)}</span><span class="s">${x.origem === 'pendrive' ? '📀 do pendrive' : x.origem === 'mesa' ? '🎛️ direto da mesa' : ''} · ${esc(x.quando)}</span></button>`).join('')}
    </div>`).join('') : 'Nada guardado ainda. Importe a pasta Exports do pendrive ou guarde o snapshot atual da mesa.';
  $$('.snap').forEach(x => x.onclick = () => comparar(x.dataset.show, x.dataset.snap));
  $$('[data-pen]').forEach(x => x.onclick = () => window.Shows?.copiarParaPendrive(x.dataset.pen));
  if (b.presets?.length) $('#bibShows').insertAdjacentHTML('beforeend', `<div class="dica" style="margin-top:8px">Presets: ${b.presets.map(p => `${esc(p.tipo)} (${p.nomes.map(esc).join(', ')})`).join(' · ')}</div>`);
  if (b.global) $('#bibShows').insertAdjacentHTML('beforeend', `<div class="dica" style="margin-top:4px">Anti-microfonia (AFS) e ajustes gerais guardados em ${esc(b.global.replace('_', ' '))}.</div>`);
  renderBackup();
}

function comparar(show, snap) {
  E.sel = { show, snap }; E.cmp = null;
  $('#cmpTitulo').textContent = `${snap} · ${show}`;
  $('#cmp').innerHTML = '<span class="dica">Comparando com a mesa…</span>';
  $('#cmpAcoes').hidden = true; $('#btnRecomparar').hidden = false;
  $$('.snap').forEach(x => x.classList.toggle('sel', x.dataset.show === show && x.dataset.snap === snap));
  mandar({ tipo: 'comparar', show, snapshot: snap });
}
$('#btnRecomparar').onclick = () => E.sel && comparar(E.sel.show, E.sel.snap);

function renderComparacao(c) {
  if (!E.sel || c.show !== E.sel.show || c.snapshot !== E.sel.snap) return;
  E.cmp = c;
  if (c.erro) { $('#cmp').innerHTML = `<span class="dica">${esc(c.erro)}</span>`; $('#cmpAcoes').hidden = true; return; }
  const d = c.diferencas;
  if (!d.length) { $('#cmp').innerHTML = '<p>✓ A mesa está <b>igual</b> a este snapshot guardado.</p>'; $('#cmpAcoes').hidden = true; return; }
  const grupos = new Map();
  d.forEach(x => { if (!grupos.has(x.grupo)) grupos.set(x.grupo, []); grupos.get(x.grupo).push(x); });
  $('#cmp').innerHTML = `<p class="dica">Diferenças entre o snapshot guardado e a mesa agora. Marque o que quer mandar (canais "safe" na mesa ficam de fora, como a mesa faz).</p>` +
    [...grupos].map(([g, itens], gi) => `
    <details class="grupo" ${grupos.size <= 4 ? 'open' : ''}><summary><input type="checkbox" data-g="${gi}" checked> <b>${esc(g)}</b><span class="n">${itens.length} diferença(s)</span></summary>
      <table class="dif"><tr><th></th><th>Ajuste</th><th>Guardado</th><th>Na mesa agora</th></tr>
      ${itens.map(x => `<tr class="${x.protegido ? 'prot' : ''}"><td><input type="checkbox" data-k="${esc(x.chave)}" data-gi="${gi}" ${x.protegido ? 'disabled title="Canal marcado como safe na mesa"' : 'checked'}></td>
        <td title="${esc(x.chave)}">${esc(x.rotulo)}${x.protegido ? ' 🔒' : ''}</td><td class="v">${esc(x.noArquivo)}</td><td class="v">${esc(x.naMesa)}</td></tr>`).join('')}
      </table></details>`).join('');
  $$('[data-g]').forEach(cb => {
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => { $$(`[data-gi="${cb.dataset.g}"]:not(:disabled)`).forEach(x => x.checked = cb.checked); contar(); };
  });
  $$('[data-k]').forEach(cb => cb.onchange = contar);
  $('#cmpAcoes').hidden = false; contar();
}
function marcadas() { return $$('[data-k]:checked').map(x => x.dataset.k); }
function contar() { const n = marcadas().length; $('#cmpConta').textContent = `${n} ajuste(s) marcado(s) de ${E.cmp?.diferencas.length || 0}`; $('#btnMandar').disabled = n === 0; }

$('#btnMandar').onclick = () => {
  const k = marcadas(); if (!k.length || !E.sel) return;
  $('#dlgMandarTxt').innerHTML = `Mandar <b>${k.length}</b> ajuste(s) do snapshot <b>${esc(E.sel.snap)}</b> (show ${esc(E.sel.show)}) para a mesa agora.`;
  const dlg = $('#dlgMandar');
  dlg.returnValue = ''; dlg.showModal();
  dlg.onclose = () => { if (dlg.returnValue === 'sim') { $('#barra').hidden = false; $('#barraI').style.width = '0'; mandar({ tipo: 'mandar', show: E.sel.show, snapshot: E.sel.snap, chaves: k }); } };
};

$('#btnImportar').onclick = () => mandar({ tipo: 'importar' });
$('#btnAbrirPasta').onclick = () => mandar({ tipo: 'abrirPasta' });

// ---------- ajustes ----------
$('#btnConectar').onclick = () => mandar({ tipo: 'conectar', ip: $('#ajIp').value.trim() });
$('#ajIp').onkeydown = e => { if (e.key === 'Enter') $('#btnConectar').click(); };
$('#ajInicio').onchange = e => mandar({ tipo: 'ajustes', iniciarComWindows: e.target.checked });
$('#ajClaro').onchange = e => { $('#app').classList.toggle('claro', e.target.checked); mandar({ tipo: 'ajustes', claro: e.target.checked }); };

// ---------- mensagens do programa ----------
window.chrome?.webview?.addEventListener('message', ev => {
  const m = ev.data;
  switch (m.tipo) {
    case 'inicio':
      $('#versao').textContent = 'v' + m.versao; $('#splashVersao').textContent = 'Versão ' + m.versao; $('#sobreVersao').textContent = 'versão ' + m.versao;
      $('#faixaTeste').hidden = !m.teste;
      $('#ajIp').value = m.ajustes.MesaIp || '';
      $('#ajInicio').checked = !!m.ajustes.IniciarComWindows; $('#ajInicio').disabled = m.teste;
      $('#ajClaro').checked = !!m.ajustes.Claro; $('#app').classList.toggle('claro', !!m.ajustes.Claro);
      $('#ajPasta').textContent = m.remoto ? '' : 'Os dados ficam em ' + m.pastaDados;
      if (window.Mixer) window.Mixer.vistas = m.ajustes.Vistas || [];   // (0.0.6)
      if (!m.ajustes.MesaIp && !m.remoto) aba('ajustes');
      break;
    case 'mesa': E.mesa = m; renderMesa(); window.Shows?.render(); break;
    case 'pendrivesPc': window.Shows?.pendrivesPc(m); break;   // (0.0.4)
    case 'biblioteca': E.bib = m.dados; E.exports = m.exports || []; renderBiblioteca(); window.Shows?.render(true); break;
    case 'comparacao': renderComparacao(m); break;
    case 'progresso':
      $('#barraI').style.width = Math.round(100 * m.feito / Math.max(1, m.total)) + '%';
      if (m.fim) setTimeout(() => { $('#barra').hidden = true; if (E.sel) comparar(E.sel.show, E.sel.snap); }, 800);
      break;
    case 'aviso': toast(m.texto, 7000); break;
    case 'trazer': trazer(m); break;   // (0.0.12)
    case 'mixerEstado': case 'valores': case 'vu': window.Mixer?.mensagem(m); break;
    case 'presets': window.Canal?.presets(m); break;   // (0.0.3)
    case 'presetsMesa': window.Canal?.presetsMesa(m); break;   // (0.0.7) presets guardados na mesa
    case 'presetMesa': window.Canal?.presetMesa(m); break;
    case 'rta': window.Canal?.rta(m); break;   // (0.0.9) analisador
  }
  if (m.tipo === 'mesa') window.Mixer?.mesa(m);
});
// pendrive espetado depois de abrir: confere de tempos em tempos enquanto a Biblioteca está aberta
setInterval(() => { if (!$('section[data-aba="biblioteca"]').hidden) mandar({ tipo: 'biblioteca' }); }, 5000);
// (0.0.13) tablet do operador: voltar à tela simples ou esquecer o pareamento
if (window.MESA_REMOTO) {
  const lsPor = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) { } };
  $('#btnEnxuta').onclick = () => { lsPor('mesa.celular.enxuta', '1'); location.href = '/'; };
  $('#btnEsquecer').onclick = () => { if (confirm('Esquecer este aparelho? Para usar de novo, vai precisar de um código novo do computador.')) { lsPor('mesa.celular.token', ''); location.href = '/'; } };
}
mandar({ tipo: 'pronto' });
