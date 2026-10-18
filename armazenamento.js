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

  // Testes que não se conseguiram gravar online ficam guardados neste computador e são reenviados
  // (ao abrir a app e de minuto a minuto), para nunca se perder um teste. A app mostra um aviso enquanto houver.
  const CHAVE_PENDENTES = 'app-estudar-testes-por-enviar';
  const lerPendentes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_PENDENTES)) || []; } catch { return []; } };
  const escreverPendentes = l => { try { localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(l)); } catch {} };
  let aoMudarPendentes = () => {};
  async function enviarTestePendente(teste) {
    const { error } = await db.from('testes').insert({ registo: teste, data: teste.data });
    if (error) throw error;
    escreverPendentes(lerPendentes().filter(t => t.id !== teste.id));
  }
  async function reenviarPendentes() {
    if (!db) return;
    for (const t of lerPendentes()) {
      try { await enviarTestePendente(t); } catch (erro) { avisar(erro); break; }
    }
    aoMudarPendentes(lerPendentes().length);
  }

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
    // Testes deste computador que ainda não chegaram ao servidor: mostram-se já e tenta-se enviá-los.
    const ids = new Set(estado.testes.map(t => String(t.id)));
    const pendentes = lerPendentes().filter(t => !ids.has(String(t.id)));
    escreverPendentes(pendentes);
    estado.testes.push(...pendentes.map(normalizarTeste));
    estado.testes.sort((a, b) => String(a.data).localeCompare(String(b.data)));
    estado.testes.forEach(contarNoHistorico);
    estado.avaliacoes = avaliacoes.data;

    reenviarPendentes();
    setInterval(reenviarPendentes, 60000);
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

    // Para desfazer um "Já estudei" carregado sem querer, ou para repetir a página.
    desmarcarEstudada(livro, pagina) {
      const p = infoPagina(livro, pagina);
      if (!p.estudada) return;
      p.estudada = false;
      delete p.data;
      guardarLocal();
      db?.from('paginas_estudadas').delete().eq('conteudo', livroId(livro)).eq('pagina', pagina).then(({ error }) => avisar(error));
    },

    // Cada resposta conta para o histórico da pergunta: as erradas (ou certas com ajuda)
    // voltam a aparecer mais vezes nos testes seguintes.
    registarTeste(teste) {
      estado.testes.push(teste);
      contarNoHistorico(teste);
      guardarLocal();
      if (!db) return;
      // Primeiro guarda-se neste computador; só sai da lista depois de o servidor confirmar.
      escreverPendentes([...lerPendentes().filter(t => t.id !== teste.id), teste]);
      enviarTestePendente(teste).then(() => aoMudarPendentes(lerPendentes().length))
        .catch(erro => { avisar(erro); aoMudarPendentes(lerPendentes().length); });
    },

    // Quantos testes estão por enviar, e aviso quando isso muda (para a app mostrar um alerta).
    get testesPorEnviar() { return lerPendentes().length; },
    set aoMudarPendentes(f) { aoMudarPendentes = f; },
    reenviarPendentes,

    // Usado quando chega a correção de um teste real.
    async atualizarTeste(teste) {
      contarNoHistorico(teste);
      guardarLocal();
      if (db) {
        const { error } = await db.from('testes').update({ registo: teste }).eq('registo->>id', String(teste.id));
        if (error) throw error;
      }
    },

    // Grava alterações a um teste já registado sem voltar a contar as respostas no histórico
    // (usado na revisão das autoavaliações pelo pai).
    async guardarRegisto(teste) {
      guardarLocal();
      if (db) {
        // Se o teste ainda está por enviar, atualiza-se a cópia local (vai com as alterações quando for enviado).
        const pend = lerPendentes();
        if (pend.some(t => t.id === teste.id)) { escreverPendentes(pend.map(t => t.id === teste.id ? teste : t)); return; }
        const { error } = await db.from('testes').update({ registo: teste }).eq('registo->>id', String(teste.id));
        if (error) throw error;
      }
    },

    // Juntar testes de uma cópia de progresso (exportar) que não estejam no servidor.
    async importarTestes(lista) {
      const ids = new Set(estado.testes.map(t => String(t.id)));
      const novos = lista.filter(t => !ids.has(String(t.id)));
      for (const t of novos) {
        estado.testes.push(normalizarTeste(t));
        contarNoHistorico(t);
        if (db) { escreverPendentes([...lerPendentes(), t]); await enviarTestePendente(t); }
      }
      guardarLocal();
      return novos.length;
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

    // Vai buscar outra vez os testes ao servidor (para ver testes feitos noutro computador e correções novas,
    // sem ser preciso F5). Devolve true se alguma coisa mudou.
    async atualizarTestes() {
      if (!db) return false;
      const { data, error } = await db.from('testes').select('registo').order('data');
      if (error) { avisar(error); return false; }
      const servidor = data.map(r => normalizarTeste(r.registo));
      const ids = new Set(servidor.map(t => String(t.id)));
      const locais = lerPendentes().filter(t => !ids.has(String(t.id)));
      const novos = [...servidor, ...locais].sort((a, b) => String(a.data).localeCompare(String(b.data)));
      const assinatura = l => JSON.stringify(l.map(t => [t.id, t.estado, t.percent, t.respostas.map(r => [r.pontuacao, r.reacao?.concorda ?? null, r.respostaRevisao || ''])]));
      if (assinatura(novos) === assinatura(estado.testes)) return false;
      estado.testes = novos;
      estado.historico = {};
      estado.testes.forEach(contarNoHistorico);
      return true;
    },
  };
})();
