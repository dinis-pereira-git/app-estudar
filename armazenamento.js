// Guarda o progresso da Leonor.
// - Com Supabase: dados online, iguais em qualquer PC onde se entre com a conta.
// - Sem Supabase (modo local): fica só no browser deste PC (localStorage).
// Em ambos os casos o estado vive em memória com a mesma forma; as escritas vão para o destino escolhido.
const Armazenamento = (() => {
  const CHAVE = 'app-estudar-v1';
  const vazio = () => ({ tempoPorDia: {}, paginas: {}, testes: [], historico: {}, planos: {} });
  let estado = vazio();
  let db = null;              // cliente Supabase, ou null em modo local
  let tempoPendente = {};     // "dia|conteudo|pagina" → segundos ainda por enviar

  const hoje = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD
  const guardarLocal = () => { if (!db) try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch {} };
  const avisar = erro => { if (erro) console.error('Erro a guardar no Supabase:', erro.message || erro); };

  function infoPagina(conteudo, pagina) {
    return estado.paginas[`${conteudo}:${pagina}`] ||= { estudada: false, segundos: 0 };
  }

  function contarNoHistorico(teste) {
    for (const r of teste.respostas) {
      const h = estado.historico[r.id] ||= { certas: 0, erradas: 0 };
      if (r.certa && !r.ajuda) h.certas++; else h.erradas++;
    }
  }

  async function iniciar(cliente) {
    db = cliente;
    estado = vazio();
    if (!db) {
      try { estado = Object.assign(vazio(), JSON.parse(localStorage.getItem(CHAVE)) || {}); } catch {}
      return;
    }
    const [tempo, estudadas, testes, planos] = await Promise.all([
      db.from('tempo').select('dia, conteudo, pagina, segundos'),
      db.from('paginas_estudadas').select('conteudo, pagina, data'),
      db.from('testes').select('registo').order('data'),
      db.from('planos').select('conteudo, de, ate'),
    ]);
    const erro = [tempo, estudadas, testes, planos].find(r => r.error);
    if (erro) throw erro.error;

    for (const t of tempo.data) {
      estado.tempoPorDia[t.dia] = (estado.tempoPorDia[t.dia] || 0) + t.segundos;
      if (t.conteudo && t.pagina) infoPagina(t.conteudo, t.pagina).segundos += t.segundos;
    }
    for (const p of estudadas.data) Object.assign(infoPagina(p.conteudo, p.pagina), { estudada: true, data: p.data });
    estado.testes = testes.data.map(r => r.registo);
    estado.testes.forEach(contarNoHistorico);
    for (const p of planos.data) estado.planos[p.conteudo] = { de: p.de, ate: p.ate };

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
      const [dia, conteudo, pagina] = chave.split('|');
      db.rpc('somar_tempo', { p_dia: dia, p_conteudo: conteudo, p_pagina: +pagina, p_segundos: segundos })
        .then(({ error }) => { if (error) { avisar(error); tempoPendente[chave] = (tempoPendente[chave] || 0) + segundos; } });
    }
  }

  return {
    get estado() { return estado; },
    get online() { return !!db; },
    iniciar,
    hoje,
    infoPagina,

    adicionarTempo(segundos, conteudo, pagina) {
      const d = hoje();
      estado.tempoPorDia[d] = (estado.tempoPorDia[d] || 0) + segundos;
      if (conteudo && pagina) infoPagina(conteudo, pagina).segundos += segundos;
      const chave = `${d}|${conteudo || ''}|${pagina || 0}`;
      tempoPendente[chave] = (tempoPendente[chave] || 0) + segundos;
      guardarLocal();
    },

    marcarEstudada(conteudo, pagina) {
      const p = infoPagina(conteudo, pagina);
      if (p.estudada) return;
      p.estudada = true;
      p.data = new Date().toISOString();
      guardarLocal();
      db?.from('paginas_estudadas').upsert({ conteudo, pagina }).then(({ error }) => avisar(error));
    },

    // Cada resposta conta para o histórico da pergunta: as erradas (ou certas com ajuda)
    // voltam a aparecer mais vezes nos testes seguintes.
    registarTeste(teste) {
      estado.testes.push(teste);
      contarNoHistorico(teste);
      guardarLocal();
      db?.from('testes').insert({ registo: teste, data: teste.data }).then(({ error }) => avisar(error));
    },

    plano(conteudo, paginas) {
      return estado.planos[conteudo] || { de: paginas[0], ate: paginas[paginas.length - 1] };
    },

    definirPlano(conteudo, de, ate) {
      estado.planos[conteudo] = { de: Math.min(de, ate), ate: Math.max(de, ate) };
      guardarLocal();
      db?.from('planos').upsert({ conteudo, ...estado.planos[conteudo] }).then(({ error }) => avisar(error));
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
