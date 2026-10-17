// Ecrãs da app: matéria, estudar, escolher dificuldade, teste, resultado e painel.
const App = (() => {
  const $app = document.getElementById('app');
  const $relogio = document.getElementById('relogio');
  const $ampliar = document.getElementById('ampliar');
  const $sair = document.getElementById('sair');
  const A = Armazenamento;
  const { SUPABASE_URL, SUPABASE_KEY, BUCKET } = window.CONFIG;
  const db = SUPABASE_URL ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  const conteudos = {};      // id → { id, base, banco, url(ficheiro) }
  let contexto = null;       // { conteudo, pagina } enquanto estuda uma página (conta tempo por página)
  let teste = null;          // teste em curso
  let pronto = false;        // matéria e progresso carregados

  const DIFICULDADES = {
    facil:   { nome: 'Fácil',   desc: 'Sobretudo o que está destacado no livro', estrelas: '★' },
    medio:   { nome: 'Médio',   desc: 'Perceber e relacionar ideias',             estrelas: '★★' },
    dificil: { nome: 'Difícil', desc: 'Deduzir o que não está escrito',            estrelas: '★★★' },
    misto:   { nome: 'Misto',   desc: 'Um pouco de tudo',                          estrelas: '★ ★★ ★★★' },
  };
  const NIVEL = { 1: '★', 2: '★★', 3: '★★★' };

  // ---------- utilitários ----------
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = seg => {
    const m = Math.round(seg / 60);
    if (seg < 60) return seg > 0 ? '<1 min' : '0 min';
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  };
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const dataCurta = iso => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const render = html => { $app.innerHTML = html; window.scrollTo(0, 0); };
  const banco = id => conteudos[id].banco;
  const img = (id, pg) => conteudos[id].url(pg.imagem);
  const pagina = (id, n) => banco(id).paginas.find(p => p.numero === n);

  function paginasDoPlano(id) {
    const todas = banco(id).paginas.map(p => p.numero);
    const { de, ate } = A.plano(id, todas);
    return todas.filter(n => n >= de && n <= ate);
  }

  function melhorNota(id, n) {
    const ts = A.estado.testes.filter(t => t.conteudo === id && t.tipo === 'pagina' && t.pagina === n);
    return ts.length ? Math.max(...ts.map(t => t.percent)) : null;
  }

  function ampliar(src) {
    $ampliar.innerHTML = `<img src="${src}" alt="Página ampliada"><button class="fechar" aria-label="Fechar">✕</button>`;
    $ampliar.hidden = false;
  }
  $ampliar.addEventListener('click', () => { $ampliar.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $ampliar.hidden = true; });
  $app.addEventListener('click', e => { const z = e.target.closest('[data-ampliar]'); if (z) ampliar(z.dataset.ampliar); });

  // ---------- tempo de estudo ativo ----------
  // Só conta quando a janela está visível e houve interação no último minuto.
  let ultimaInteracao = Date.now();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    addEventListener(ev, () => { ultimaInteracao = Date.now(); }, { passive: true }));
  const atualizarRelogio = () => { $relogio.textContent = `⏱ Hoje: ${fmt(A.estado.tempoPorDia[A.hoje()] || 0)}`; };
  // O painel não conta (o pai pode estar só a consultar).
  setInterval(() => {
    if (pronto && !location.hash.startsWith('#/painel') && document.visibilityState === 'visible' && Date.now() - ultimaInteracao < 60000) {
      A.adicionarTempo(5, contexto?.conteudo, contexto?.pagina);
      atualizarRelogio();
    }
  }, 5000);

  // ---------- rotas ----------
  function rota() {
    const [, ecra, id, n] = (location.hash || '#/').split('/');
    contexto = null;
    document.querySelectorAll('.barra nav a').forEach(a => a.classList.toggle('ativo', a.getAttribute('href') === `#/${ecra || ''}`));
    if (ecra === 'estudar') return ecraEstudar(id, +n);
    if (ecra === 'testar') return ecraDificuldade(id, n === 'global' ? null : +n);
    if (ecra === 'teste' && teste) return ecraPergunta();
    if (ecra === 'resultado' && teste) return ecraResultado();
    if (ecra === 'painel') return ecraPainel();
    ecraInicio();
  }

  // ---------- matéria ----------
  function ecraInicio() {
    render(Object.keys(conteudos).map(id => {
      const b = banco(id);
      const todas = b.paginas.map(p => p.numero);
      const plano = A.plano(id, todas);
      const noPlano = paginasDoPlano(id);
      const estudadas = noPlano.filter(n => A.infoPagina(id, n).estudada).length;
      const opcoes = sel => todas.map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

      const linhas = b.paginas.map(pg => {
        const dentro = noPlano.includes(pg.numero);
        const info = A.infoPagina(id, pg.numero);
        const nota = melhorNota(id, pg.numero);
        const nPerg = b.perguntas.filter(q => q.pagina === pg.numero).length;
        return `
          <li class="pag-linha ${dentro ? '' : 'fora'}">
            <img src="${img(id, pg)}" alt="" class="mini" data-ampliar="${img(id, pg)}">
            <div class="pag-info">
              <b>Página ${pg.numero}</b> <span class="muted">· ${esc(pg.titulo)}</span>
              <div class="estado">
                ${info.estudada ? '<span class="chip ok">✓ Estudada</span>' : '<span class="chip">Por estudar</span>'}
                ${nota != null ? `<span class="chip ${nota >= 70 ? 'ok' : 'aviso'}">Melhor nota: ${nota}%</span>` : ''}
                <span class="muted">${nPerg} perguntas</span>
              </div>
            </div>
            <div class="acoes">
              <a class="btn" href="#/estudar/${id}/${pg.numero}">📖 Estudar</a>
              ${dentro ? `<a class="btn prim" href="#/testar/${id}/${pg.numero}">✏️ Testar</a>` : ''}
            </div>
          </li>`;
      }).join('');

      return `
        <section class="cartao">
          <h1>${esc(b.disciplina)} · ${esc(b.capitulo)}</h1>
          <p class="muted">${esc(b.fonte)}</p>
          <div class="plano">
            <label>Matéria para o teste: da página <select id="de-${id}">${opcoes(plano.de)}</select></label>
            <label>à página <select id="ate-${id}">${opcoes(plano.ate)}</select></label>
            <span class="muted">${estudadas} de ${noPlano.length} páginas estudadas</span>
          </div>
          <div class="progresso"><div style="width:${pct(estudadas, noPlano.length)}%"></div></div>
          <ol class="pag-lista">${linhas}</ol>
          <div class="global">
            <div><b>Teste global</b><br><span class="muted">Todas as páginas da matéria (${plano.de} a ${plano.ate}), com perguntas de vários níveis.</span></div>
            <a class="btn prim grande" href="#/testar/${id}/global">🏁 Fazer teste global</a>
          </div>
        </section>`;
    }).join(''));

    Object.keys(conteudos).forEach(id => {
      const mudar = () => { A.definirPlano(id, +document.getElementById(`de-${id}`).value, +document.getElementById(`ate-${id}`).value); ecraInicio(); };
      document.getElementById(`de-${id}`).onchange = mudar;
      document.getElementById(`ate-${id}`).onchange = mudar;
    });
  }

  // ---------- estudar uma página ----------
  function ecraEstudar(id, n) {
    const b = banco(id), pg = pagina(id, n);
    if (!pg) return ecraInicio();
    contexto = { conteudo: id, pagina: n };
    const i = b.paginas.indexOf(pg);
    const ant = b.paginas[i - 1], seg = b.paginas[i + 1];
    const info = A.infoPagina(id, n);
    const dentro = paginasDoPlano(id).includes(n);

    render(`
      <section class="estudar">
        <div class="estudar-topo">
          <a href="#/" class="voltar">← Matéria</a>
          <h1>Página ${n} · ${esc(pg.titulo)}</h1>
        </div>
        <div class="estudar-corpo">
          <figure class="pagina-grande">
            <img src="${img(id, pg)}" alt="Página ${n} do livro" data-ampliar="${img(id, pg)}">
            <figcaption class="muted">Clica na página para a ver em grande.</figcaption>
          </figure>
          <aside class="lado">
            <div class="cartao">
              <h2>🎬 Vídeo-resumo</h2>
              ${pg.video
                ? `<video controls src="${conteudos[id].url(pg.video)}"></video>`
                : '<p class="muted">Ainda não há vídeo para esta página.</p>'}
            </div>
            <div class="cartao">
              <h2>Quando acabares de ler</h2>
              <button class="btn ${info.estudada ? '' : 'prim'}" id="estudei" ${info.estudada ? 'disabled' : ''}>${info.estudada ? '✓ Já estudaste esta página' : '✓ Já estudei esta página'}</button>
              ${dentro ? `<a class="btn prim" href="#/testar/${id}/${n}">✏️ Testar esta página</a>` : ''}
              <p class="muted">Tempo nesta página: ${fmt(info.segundos)}</p>
            </div>
            <div class="navegar">
              ${ant ? `<a class="btn" href="#/estudar/${id}/${ant.numero}">← Pág. ${ant.numero}</a>` : '<span></span>'}
              ${seg ? `<a class="btn" href="#/estudar/${id}/${seg.numero}">Pág. ${seg.numero} →</a>` : ''}
            </div>
          </aside>
        </div>
      </section>`);
    document.getElementById('estudei').onclick = () => { A.marcarEstudada(id, n); ecraEstudar(id, n); };
  }

  // ---------- escolher dificuldade ----------
  function ecraDificuldade(id, alvo) {
    const paginas = paginasDoPlano(id);
    const anteriores = alvo == null ? [] : paginas.filter(p => p < alvo);
    const titulo = alvo == null ? `Teste global · páginas ${paginas[0]} a ${paginas[paginas.length - 1]}` : `Teste da página ${alvo}`;
    const explica = alvo == null
      ? 'Perguntas de todas as páginas da matéria.'
      : anteriores.length
        ? `A maior parte das perguntas é da página ${alvo}, e algumas são das páginas anteriores (${anteriores.join(', ')}) para não te esqueceres.`
        : `Todas as perguntas são da página ${alvo}.`;

    render(`
      <section class="cartao centro">
        <a href="#/" class="voltar">← Matéria</a>
        <h1>${titulo}</h1>
        <p>${explica}</p>
        <h2>Escolhe a dificuldade</h2>
        <div class="dificuldades">
          ${Object.entries(DIFICULDADES).map(([k, d]) => `
            <button class="dif" data-dif="${k}">
              <span class="estrelas">${d.estrelas}</span>
              <b>${d.nome}</b>
              <span class="muted">${d.desc}</span>
            </button>`).join('')}
        </div>
      </section>`);

    $app.querySelectorAll('[data-dif]').forEach(bt => bt.onclick = () => {
      if (alvo != null) A.marcarEstudada(id, alvo);
      const dificuldade = bt.dataset.dif;
      teste = {
        conteudo: id, alvo, paginas, dificuldade, inicio: new Date().toISOString(),
        perguntas: Motor.gerar({ perguntas: banco(id).perguntas, historico: A.estado.historico, paginas, alvo, dificuldade }),
        indice: 0, respostas: [], ajuda: false, respondida: null,
      };
      location.hash = '#/teste';
    });
  }

  // ---------- pergunta ----------
  function ecraPergunta() {
    const q = teste.perguntas[teste.indice];
    const pg = pagina(teste.conteudo, q.pagina);
    const r = teste.respondida;
    const total = teste.perguntas.length;

    const opcoes = q.opcoes.map((o, i) => {
      let cls = '';
      if (r != null) cls = i === q.correta ? 'certa' : i === r ? 'errada' : 'apagada';
      return `<button class="opcao ${cls}" data-op="${i}" ${r != null ? 'disabled' : ''}><span class="letra">${'abcd'[i]})</span> ${esc(o)}</button>`;
    }).join('');

    const blocoPagina = `
      <div class="ajuda-pagina">
        <img src="${img(teste.conteudo, pg)}" alt="Página ${q.pagina}" data-ampliar="${img(teste.conteudo, pg)}">
        <div><b>📍 Procura na página ${q.pagina}:</b><br>${esc(q.onde)}<br><span class="muted">Clica na página para a ver em grande.</span></div>
      </div>`;

    let feedback = '';
    if (r != null) {
      const certa = r === q.correta;
      feedback = `
        <div class="feedback ${certa ? 'bom' : 'mau'}">
          <h3>${certa ? (teste.ajuda ? '👍 Certo, com ajuda!' : '🎉 Muito bem!') : '💪 Não faz mal, vamos ver onde está.'}</h3>
          ${certa ? '' : `<p><b>Resposta certa:</b> ${esc(q.opcoes[q.correta])}</p>`}
          <p>${esc(q.explicacao)}</p>
          ${certa ? '' : blocoPagina}
          <button class="btn prim grande" id="seguinte">${teste.indice + 1 < total ? 'Seguinte →' : 'Ver resultado 🏁'}</button>
        </div>`;
    } else if (teste.ajuda) {
      feedback = `<div class="feedback ajuda">${blocoPagina}</div>`;
    }

    render(`
      <section class="cartao teste">
        <div class="teste-topo">
          <span>Pergunta ${teste.indice + 1} de ${total}</span>
          <span class="nivel n${q.nivel}" title="Nível de dificuldade">${NIVEL[q.nivel]}</span>
        </div>
        <div class="progresso"><div style="width:${pct(teste.indice, total)}%"></div></div>
        <h2 class="enunciado">${esc(q.pergunta)}</h2>
        <div class="opcoes">${opcoes}</div>
        ${r == null && !teste.ajuda ? '<button class="btn ajuda-btn" id="ajuda">💡 Preciso de ajuda</button>' : ''}
        ${feedback}
      </section>`);

    $app.querySelectorAll('[data-op]').forEach(bt => bt.onclick = () => responder(+bt.dataset.op));
    document.getElementById('ajuda')?.addEventListener('click', () => { teste.ajuda = true; ecraPergunta(); });
    document.getElementById('seguinte')?.addEventListener('click', seguinte);
  }

  function responder(i) {
    const q = teste.perguntas[teste.indice];
    teste.respondida = i;
    teste.respostas.push({ id: q.id, pagina: q.pagina, nivel: q.nivel, certa: i === q.correta, ajuda: teste.ajuda });
    ecraPergunta();
  }

  function seguinte() {
    if (teste.registo) return; // evita gravar o mesmo teste duas vezes (duplo clique)
    teste.indice++;
    teste.ajuda = false;
    teste.respondida = null;
    if (teste.indice < teste.perguntas.length) return ecraPergunta();

    // Certa sem ajuda = 1 ponto; certa com ajuda = meio ponto.
    const pontos = teste.respostas.reduce((s, r) => s + (r.certa ? (r.ajuda ? 0.5 : 1) : 0), 0);
    const porNivel = {};
    teste.respostas.forEach(r => { const n = porNivel[r.nivel] ||= { certas: 0, total: 0 }; n.total++; if (r.certa && !r.ajuda) n.certas++; });
    teste.registo = {
      data: new Date().toISOString(), conteudo: teste.conteudo,
      tipo: teste.alvo == null ? 'global' : 'pagina', pagina: teste.alvo,
      paginas: [teste.paginas[0], teste.paginas[teste.paginas.length - 1]],
      dificuldade: teste.dificuldade, total: teste.respostas.length, pontos,
      percent: pct(pontos, teste.respostas.length), porNivel, respostas: teste.respostas,
    };
    A.registarTeste(teste.registo);
    location.hash = '#/resultado';
  }

  // ---------- resultado ----------
  function ecraResultado() {
    const t = teste.registo;
    const mensagem = t.percent >= 90 ? '🌟 Excelente!' : t.percent >= 70 ? '😀 Muito bem!' : t.percent >= 50 ? '🙂 Estás quase lá!' : '💪 Vale a pena rever esta matéria.';
    const erradas = teste.perguntas.filter((q, i) => !teste.respostas[i].certa || teste.respostas[i].ajuda);

    render(`
      <section class="cartao centro">
        <h1>${mensagem}</h1>
        <div class="nota ${t.percent >= 70 ? 'bom' : t.percent >= 50 ? 'medio' : 'mau'}">${t.percent}%</div>
        <p>${t.pontos} pontos em ${t.total} perguntas · Dificuldade: ${DIFICULDADES[t.dificuldade].nome}</p>
        <div class="niveis">
          ${[1, 2, 3].filter(n => t.porNivel[n]).map(n => `<span class="chip">${NIVEL[n]} ${t.porNivel[n].certas}/${t.porNivel[n].total}</span>`).join('')}
        </div>
        ${erradas.length ? `
          <h2>Para rever</h2>
          <ul class="rever">
            ${erradas.map(q => `<li><b>${esc(q.pergunta)}</b><br>✔ ${esc(q.opcoes[q.correta])}<br><span class="muted">📍 Página ${q.pagina}: ${esc(q.onde)}</span></li>`).join('')}
          </ul>` : '<p>Acertaste tudo sem ajuda! 🎉</p>'}
        <div class="linha-botoes">
          <a class="btn prim" href="#/testar/${t.conteudo}/${t.pagina ?? 'global'}">🔁 Repetir</a>
          ${t.pagina ? `<a class="btn" href="#/estudar/${t.conteudo}/${t.pagina}">📖 Rever a página</a>` : ''}
          <a class="btn" href="#/">Voltar à matéria</a>
        </div>
      </section>`);
  }

  // ---------- painel ----------
  function ecraPainel() {
    const e = A.estado;
    const hoje = A.hoje();
    const dias = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toLocaleDateString('sv'); });
    const tempoSemana = dias.reduce((s, d) => s + (e.tempoPorDia[d] || 0), 0);
    const tempoTotal = Object.values(e.tempoPorDia).reduce((s, v) => s + v, 0);
    const maxDia = Math.max(60, ...dias.map(d => e.tempoPorDia[d] || 0));
    const media = e.testes.length ? Math.round(e.testes.reduce((s, t) => s + t.percent, 0) / e.testes.length) : null;

    const porNivel = { 1: { c: 0, t: 0 }, 2: { c: 0, t: 0 }, 3: { c: 0, t: 0 } };
    e.testes.forEach(t => t.respostas.forEach(r => { porNivel[r.nivel].t++; if (r.certa && !r.ajuda) porNivel[r.nivel].c++; }));

    const todasPerguntas = Object.keys(conteudos).flatMap(id => banco(id).perguntas);
    const dificeis = Object.entries(e.historico).filter(([, h]) => h.erradas > 0)
      .sort((a, b) => (b[1].erradas - b[1].certas) - (a[1].erradas - a[1].certas)).slice(0, 5)
      .map(([qid, h]) => ({ q: todasPerguntas.find(q => q.id === qid), h })).filter(x => x.q);

    const tabelasPaginas = Object.keys(conteudos).map(id => `
      <h3>${esc(banco(id).disciplina)} · ${esc(banco(id).capitulo)}</h3>
      <table>
        <thead><tr><th>Página</th><th>Estudada</th><th>Tempo</th><th>Testes</th><th>Melhor nota</th></tr></thead>
        <tbody>${banco(id).paginas.map(pg => {
          const info = A.infoPagina(id, pg.numero);
          const nTestes = e.testes.filter(t => t.conteudo === id && t.pagina === pg.numero).length;
          const nota = melhorNota(id, pg.numero);
          return `<tr><td>${pg.numero} · ${esc(pg.titulo)}</td><td>${info.estudada ? '✓' : '—'}</td><td>${fmt(info.segundos)}</td><td>${nTestes}</td><td>${nota != null ? nota + '%' : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table>`).join('');

    render(`
      <section class="cartao">
        <h1>Painel de estudo</h1>
        <div class="kpis">
          <div class="kpi"><span>Hoje</span><b>${fmt(e.tempoPorDia[hoje] || 0)}</b></div>
          <div class="kpi"><span>Últimos 7 dias</span><b>${fmt(tempoSemana)}</b></div>
          <div class="kpi"><span>Total</span><b>${fmt(tempoTotal)}</b></div>
          <div class="kpi"><span>Testes feitos</span><b>${e.testes.length}</b></div>
          <div class="kpi"><span>Média dos testes</span><b>${media != null ? media + '%' : '—'}</b></div>
        </div>

        <h2>Tempo de estudo (últimos 7 dias)</h2>
        <div class="barras">
          ${dias.map(d => `<div class="barra-dia"><div class="b" style="height:${pct(e.tempoPorDia[d] || 0, maxDia)}%" title="${fmt(e.tempoPorDia[d] || 0)}"></div>
            <span>${new Date(d + 'T12:00').toLocaleDateString('pt-PT', { weekday: 'short' })}</span><small>${fmt(e.tempoPorDia[d] || 0)}</small></div>`).join('')}
        </div>

        <h2>Acertos por nível</h2>
        <div class="niveis">
          ${[1, 2, 3].map(n => `<span class="chip">${NIVEL[n]} ${porNivel[n].t ? pct(porNivel[n].c, porNivel[n].t) + '%' : '—'} <small class="muted">(${porNivel[n].c}/${porNivel[n].t})</small></span>`).join('')}
        </div>

        <h2>Páginas</h2>
        ${tabelasPaginas}

        <h2>Últimos testes</h2>
        ${e.testes.length ? `<table>
          <thead><tr><th>Data</th><th>Teste</th><th>Dificuldade</th><th>Nota</th></tr></thead>
          <tbody>${[...e.testes].reverse().slice(0, 15).map(t => `<tr><td>${dataCurta(t.data)}</td>
            <td>${t.tipo === 'global' ? `Global (págs. ${t.paginas[0]}–${t.paginas[1]})` : `Página ${t.pagina}`}</td>
            <td>${DIFICULDADES[t.dificuldade].nome}</td><td><b>${t.percent}%</b> <small class="muted">(${t.pontos}/${t.total})</small></td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Ainda não há testes.</p>'}

        <h2>Perguntas que custam mais</h2>
        ${dificeis.length ? `<ul class="rever">${dificeis.map(({ q, h }) => `<li><b>${esc(q.pergunta)}</b><br><span class="muted">Página ${q.pagina} · ${NIVEL[q.nivel]} · ${h.erradas} vez(es) errada ou com ajuda, ${h.certas} certa(s)</span></li>`).join('')}</ul>` : '<p class="muted">Ainda não há dados.</p>'}

        <p><button class="btn" id="exportar">⬇️ Guardar cópia do progresso</button></p>
      </section>`);
    document.getElementById('exportar').onclick = A.exportar;
  }

  // ---------- entrar ----------
  function ecraLogin(mensagem = '') {
    render(`
      <section class="cartao centro login">
        <h1>👋 Olá!</h1>
        <p>Entra com a tua conta para estudar.</p>
        <form id="login">
          <label>Email<input type="email" id="email" autocomplete="username" required></label>
          <label>Palavra-passe<input type="password" id="pass" autocomplete="current-password" required></label>
          ${mensagem ? `<p class="erro">${esc(mensagem)}</p>` : ''}
          <button class="btn prim grande">Entrar</button>
        </form>
      </section>`);
    document.getElementById('login').onsubmit = async e => {
      e.preventDefault();
      const { error } = await db.auth.signInWithPassword({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('pass').value,
      });
      if (error) return ecraLogin('Email ou palavra-passe errados.');
      location.hash = '#/';
      iniciar();
    };
  }

  $sair.onclick = async () => { A.enviarTempo(); await db.auth.signOut(); location.reload(); };

  // ---------- arranque ----------
  // Com Supabase: a matéria vem do espaço privado, com links temporários para as imagens.
  // Em modo local: vem das pastas ao lado da app.
  async function carregarConteudo(c) {
    if (!db) {
      const banco = await (await fetch('../' + c.banco)).json();
      return { ...c, banco, url: f => '../' + c.base + f };
    }
    const { data, error } = await db.storage.from(BUCKET).download(c.banco);
    if (error) throw error;
    const banco = JSON.parse(await data.text());
    const caminhos = banco.paginas.flatMap(p => [p.imagem, p.video].filter(Boolean)).map(f => c.base + f);
    const assinados = await db.storage.from(BUCKET).createSignedUrls(caminhos, 60 * 60 * 12);
    if (assinados.error) throw assinados.error;
    const urls = Object.fromEntries(assinados.data.map(s => [s.path, s.signedUrl]));
    return { ...c, banco, url: f => urls[c.base + f] };
  }

  async function iniciar() {
    if (db) {
      const { data } = await db.auth.getSession();
      if (!data.session) return ecraLogin();
      $sair.hidden = false;
    }
    try {
      await A.iniciar(db);
      const catalogo = await (await fetch('catalogo.json')).json();
      for (const c of catalogo) conteudos[c.id] = await carregarConteudo(c);
    } catch (erro) {
      render(`<section class="cartao"><h1>Não consegui carregar a matéria</h1><p class="muted">${esc(erro.message)}</p></section>`);
      return;
    }
    pronto = true;
    addEventListener('hashchange', rota);
    atualizarRelogio();
    rota();
  }

  iniciar();
})();
