// Guarda o progresso da Leonor e os testes da escola.
// - Com Supabase: dados online, iguais em qualquer PC onde se entre com a conta.
// - Sem Supabase (modo local): fica só no browser deste PC (localStorage).
// Em ambos os casos o estado vive em memória com a mesma forma; as escritas vão para o destino escolhido.
const Armazenamento = (() => {
  const CHAVE = 'app-estudar-v1';
  // Nomes antigos de livros, de antes da organização por disciplina/livro.
  const ALIAS = { 'hgp-c3': 'hgp-viajantes6' };
  const vazio = () => ({ tempoPorDia: {}, paginas: {}, testes: [], historico: {}, avaliacoes: [] });
  let estado = vazio();
  let db = null;              // cliente Supabase, ou null em modo local
  let tempoPendente = {};     // "dia|livro|pagina" → segundos ainda por enviar

  const hoje = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD
  const livroId = id => ALIAS[id] || id;
  const guardarLocal = () => { if (!db) try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch {} };
  const avisar = erro => { if (erro) console.error('Erro a guardar no Supabase:', erro.message || erro); };

  function infoPagina(livro, pagina) {
    return estado.paginas[`${livroId(livro)}:${pagina}`] ||= { estudada: false, segundos: 0 };
  }

  function contarNoHistorico(teste) {
    for (const r of teste.respostas) {
      if (r.pontuacao === null) continue; // teste real ainda por corrigir
      const h = estado.historico[r.id] ||= { certas: 0, erradas: 0 };
      if (r.certa && !r.ajuda) h.certas++; else h.erradas++;
    }
  }

  const normalizarTeste = t => { t.livro = livroId(t.livro || t.conteudo); return t; };

  async function iniciar(cliente) {
    db = cliente;
    estado = vazio();
    if (!db) {
      try { estado = Object.assign(vazio(), JSON.parse(localStorage.getItem(CHAVE)) || {}); } catch {}
      estado.testes.forEach(normalizarTeste);
      return;
    }
    const [tempo, estudadas, testes, avaliacoes] = await Promise.all([
      db.from('tempo').select('dia, conteudo, pagina, segundos'),
      db.from('paginas_estudadas').select('conteudo, pagina, data'),
      db.from('testes').select('registo').order('data'),
      db.from('avaliacoes').select('*').order('periodo').order('data'),
    ]);
    const erro = [tempo, estudadas, testes, avaliacoes].find(r => r.error);
    if (erro) throw erro.error;

    for (const t of tempo.data) {
      estado.tempoPorDia[t.dia] = (estado.tempoPorDia[t.dia] || 0) + t.segundos;
      if (t.conteudo && t.pagina) infoPagina(t.conteudo, t.pagina).segundos += t.segundos;
    }
    for (const p of estudadas.data) Object.assign(infoPagina(p.conteudo, p.pagina), { estudada: true, data: p.data });
    estado.testes = testes.data.map(r => normalizarTeste(r.registo));
    estado.testes.forEach(contarNoHistorico);
    estado.avaliacoes = avaliacoes.data;

    setInterval(enviarTempo, 30000);
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarTempo(); });
    addEventListener('pagehide', enviarTempo);
  }

  // O tempo é enviado em lotes (de 30 em 30 s, e quando se sai da página) para não fazer pedidos a cada 5 s.
  function enviarTempo() {
    if (!db) return;
    const lote = tempoPendente;
    tempoPendente = {};
    for (const [chave, segundos] of Object.entries(lote)) {
      const [dia, livro, pagina] = chave.split('|');
      db.rpc('somar_tempo', { p_dia: dia, p_conteudo: livro, p_pagina: +pagina, p_segundos: segundos })
        .then(({ error }) => { if (error) { avisar(error); tempoPendente[chave] = (tempoPendente[chave] || 0) + segundos; } });
    }
  }

  return {
    get estado() { return estado; },
    get online() { return !!db; },
    iniciar,
    hoje,
    infoPagina,

    adicionarTempo(segundos, livro, pagina) {
      const d = hoje();
      estado.tempoPorDia[d] = (estado.tempoPorDia[d] || 0) + segundos;
      if (livro && pagina) infoPagina(livro, pagina).segundos += segundos;
      const chave = `${d}|${livro || ''}|${pagina || 0}`;
      tempoPendente[chave] = (tempoPendente[chave] || 0) + segundos;
      guardarLocal();
    },

    marcarEstudada(livro, pagina) {
      const p = infoPagina(livro, pagina);
      if (p.estudada) return;
      p.estudada = true;
      p.data = new Date().toISOString();
      guardarLocal();
      db?.from('paginas_estudadas').upsert({ conteudo: livro, pagina }).then(({ error }) => avisar(error));
    },

    // Cada resposta conta para o histórico da pergunta: as erradas (ou certas com ajuda)
    // voltam a aparecer mais vezes nos testes seguintes.
    registarTeste(teste) {
      estado.testes.push(teste);
      contarNoHistorico(teste);
      guardarLocal();
      db?.from('testes').insert({ registo: teste, data: teste.data }).then(({ error }) => avisar(error));
    },

    // Usado quando chega a correção de um teste real.
    async atualizarTeste(teste) {
      contarNoHistorico(teste);
      guardarLocal();
      if (db) {
        const { error } = await db.from('testes').update({ registo: teste }).eq('registo->>id', String(teste.id));
        if (error) throw error;
      }
    },

    async guardarAvaliacao(a) {
      const dados = { disciplina: a.disciplina, periodo: a.periodo, nome: a.nome, data: a.data || null, livro: a.livro, de: a.de, ate: a.ate };
      let guardada;
      if (db) {
        const pedido = a.id ? db.from('avaliacoes').update(dados).eq('id', a.id) : db.from('avaliacoes').insert(dados);
        const { data, error } = await pedido.select().single();
        if (error) throw error;
        guardada = data;
      } else {
        guardada = { ...dados, id: a.id || Date.now() };
      }
      const i = estado.avaliacoes.findIndex(x => x.id === guardada.id);
      if (i >= 0) estado.avaliacoes[i] = guardada; else estado.avaliacoes.push(guardada);
      guardarLocal();
      return guardada;
    },

    async apagarAvaliacao(id) {
      if (db) {
        const { error } = await db.from('avaliacoes').delete().eq('id', id);
        if (error) throw error;
      }
      estado.avaliacoes = estado.avaliacoes.filter(a => a.id !== id);
      guardarLocal();
    },

    // Recomeçar do zero: apaga páginas estudadas e treinos (e, se pedido, os tempos de estudo).
    // Os testes da escola (avaliações) ficam.
    async apagarProgresso({ tempos = false } = {}) {
      if (db) {
        const pedidos = [db.from('testes').delete().gte('id', 0), db.from('paginas_estudadas').delete().gte('pagina', 0)];
        if (tempos) pedidos.push(db.from('tempo').delete().gte('segundos', 0));
        const erro = (await Promise.all(pedidos)).find(r => r.error);
        if (erro) throw erro.error;
      }
      estado.testes = [];
      estado.historico = {};
      for (const p of Object.values(estado.paginas)) { p.estudada = false; delete p.data; if (tempos) p.segundos = 0; }
      if (tempos) { estado.tempoPorDia = {}; tempoPendente = {}; }
      guardarLocal();
    },

    exportar() {
      const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `progresso-${hoje()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    },

    enviarTempo,
  };
})();
