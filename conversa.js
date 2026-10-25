// Conversa guiada (Inglês): a professora faz uma pergunta (voz britânica gravada), a Leonor responde ao microfone e a
// app verifica a resposta pelas palavras-chave (como nas respostas curtas). Se não estiver certa à 2.ª tentativa,
// ouve a frase modelo e tem de a repetir em voz alta (leitura.js) antes de seguir. Sem IA: tudo está escrito em
// ferramentas/conversas-en6.js, só com a matéria das lições.
const Conversa = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const verLegendas = () => { try { return localStorage.getItem('app-ver-legendas') === '1'; } catch { return false; } };
  const TENTATIVAS = 2;
  const ELOGIOS = ['ok1', 'ok2', 'ok3'];

  // el: onde pôr; conv: { titulo, falas: [{ id, prof, traducao, aceites, modelo, modeloTraducao }] }
  // urlAudio(nome): endereço de audio/conversas/<nome>.mp3; verificar(texto, aceites): true/false;
  // aoAcabar({ certas, total, percent, falas }): chamado no fim.
  function montar(el, conv, { urlAudio, verificar, aoAcabar }) {
    const F = conv.falas, audio = new Audio();
    let k = -1, falas = [];
    const tocar = nome => new Promise(resolve => {
      audio.onended = audio.onerror = () => resolve();
      audio.src = urlAudio(nome);
      (window.Leitura?.acordarSom() || Promise.resolve()).then(() => audio.play().catch(() => resolve()));
    });

    function inicio() {
      el.innerHTML = `
        <div class="conversa">
          <p>${esc(conv.titulo)}</p>
          <p class="muted">The teacher asks, you answer out loud (🎤). ${F.length} questions.</p>
          <button class="btn prim" data-comecar>▶ Start talking</button>
        </div>`;
      el.querySelector('[data-comecar]').onclick = () => { window.Leitura?.acordarSom(); k = -1; falas = []; seguinte(); };
    }

    function seguinte() {
      k++;
      if (k >= F.length) return fim();
      falas[k] = { id: F[k].id, tentativas: 0, certa: false, ouvido: '' };
      desenhar();
      tocar(F[k].id + '-p');
    }

    function desenhar(estado = {}) {
      const f = F[k], r = falas[k];
      const certas = falas.filter(x => x.certa).length;
      el.innerHTML = `
        <div class="conversa">
          <div class="conversa-topo"><span class="muted">${k + 1} / ${F.length}</span><span class="chip ok">⭐ ${certas}</span></div>
          <div class="balao prof">👩‍🏫 ${esc(f.prof)}
            ${verLegendas() && f.traducao ? `<div class="traducao">🇵🇹 ${esc(f.traducao)}</div>` : ''}</div>
          ${r.ouvido ? `<div class="balao eu">🙋 ${esc(r.ouvido)}</div>` : ''}
          ${estado.msg ? `<p class="conversa-msg">${estado.msg}</p>` : ''}
          <div class="conversa-repetir"></div>
          <div class="leitura-botoes">
            <button class="btn" data-ouvir>🔊 Listen again</button>
            ${estado.repetir || estado.certa ? '' : `<button class="btn prim" data-responder>🎤 Answer</button>`}
            ${!window.Leitura?.suportado && !estado.repetir && !estado.certa ? `<input class="conversa-escrever" placeholder="Write your answer"><button class="btn" data-escrevi>OK</button>` : ''}
            ${estado.certa ? '<button class="btn prim" data-seguinte>Next ➜</button>' : ''}
          </div>
        </div>`;
      el.querySelector('[data-ouvir]').onclick = () => tocar(f.id + '-p');
      el.querySelector('[data-seguinte]')?.addEventListener('click', seguinte);
      el.querySelector('[data-responder]')?.addEventListener('click', async ev => {
        const bt = ev.currentTarget; bt.disabled = true; bt.textContent = '🔴 Listening… answer now';
        try { avaliar(await Leitura.ouvir('en-GB')); }
        catch (erro) { desenhar({ msg: '⚠️ ' + esc(erro.message) }); }
      });
      el.querySelector('[data-escrevi]')?.addEventListener('click', () => avaliar([el.querySelector('.conversa-escrever').value]));
      if (estado.repetir) {
        // Errou: ouve a frase modelo e repete-a em voz alta (com avaliação); só depois segue.
        const box = el.querySelector('.conversa-repetir');
        box.innerHTML = '<div></div>';
        Leitura.montar(box.firstChild, {
          titulo: `🔁 Say it like this: <i>${esc(f.modelo)}</i>${verLegendas() && f.modeloTraducao ? ` <span class="muted">(${esc(f.modeloTraducao)})</span>` : ''}`,
          texto: f.modelo.split(' / ')[0], urlAudio: urlAudio(f.id + '-m'), estado: {},
          aoPassar: () => { const b = document.createElement('button'); b.className = 'btn prim'; b.textContent = 'Next ➜'; b.onclick = seguinte; el.querySelector('.leitura-botoes').append(b); },
        });
        tocar(f.id + '-m');
      }
    }

    function avaliar(alternativas) {
      const f = F[k], r = falas[k];
      r.tentativas++;
      const boa = alternativas.find(a => verificar(a, f.aceites));
      r.ouvido = boa || alternativas[0] || '';
      if (boa) {
        r.certa = r.tentativas === 1; // à primeira é que conta como certa
        desenhar({ certa: true, msg: r.certa ? '🌟 Well done!' : '👍 Good! Now you got it.' });
        tocar(ELOGIOS[k % ELOGIOS.length]);
      } else if (r.tentativas < TENTATIVAS) {
        desenhar({ msg: 'Not quite. Listen to the question again (🔊) and try again.' });
      } else {
        desenhar({ repetir: true, msg: 'Let’s learn it! Listen and repeat.' });
      }
    }

    function fim() {
      const certas = falas.filter(x => x.certa).length, percent = Math.round(100 * certas / F.length);
      el.innerHTML = `
        <div class="conversa">
          <h3>${percent >= 80 ? '🌟' : percent >= 50 ? '👍' : '💪'} ${certas} / ${F.length} first time · ${percent}%</h3>
          <p class="muted">${percent >= 80 ? 'Excellent conversation!' : 'Practise again to get them all first time!'}</p>
          <button class="btn prim" data-comecar>🔁 Talk again</button>
        </div>`;
      el.querySelector('[data-comecar]').onclick = () => { k = -1; falas = []; seguinte(); };
      aoAcabar?.({ certas, total: F.length, percent, falas });
    }

    inicio();
  }

  return { montar };
})();
window.Conversa = Conversa;
