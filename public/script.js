const SENHA_MASTER = "106230";
const TEMPO_INATIVIDADE = 120000; 

let idUsuario = localStorage.getItem('id_observador');
let nomeUsuario = localStorage.getItem('nome_observador');

let cronometroInatividade;
let socket = null;
let mediaRecorder = null;
let pedacosAudio = [];
let gravandoAudio = false;
let tempoDigitandoTimeout;
let tempoReconexao;
let mensagensLidasEmEspera = [];
let senhaPendenteLogin = "";
let mensagemCitadaAtiva = null;
let tituloOriginal = document.title;
let intervaloPiscarTitulo = null;

setInterval(() => {
    const relogio = document.getElementById('relogioAtual');
    if (relogio) relogio.innerText = new Date().toLocaleTimeString('pt-BR');
}, 1000);

// --- WEB AUDIO API: SOM SUTIL DE NOTIFICAÇÃO ---
function tocarSomNotificacao() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.log("Áudio bloqueado pelo navegador até haver interação.");
    }
}

// --- ALERTA VISUAL: PISCAR ABA DO NAVEGADOR ---
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        pararAlertaVisual();
        if (mensagensLidasEmEspera.length > 0 && socket && socket.readyState === WebSocket.OPEN) {
            mensagensLidasEmEspera.forEach(id => {
                socket.send(JSON.stringify({ tipoEvent: 'confirmar_leitura', idMensagem: id }));
            });
            mensagensLidasEmEspera = [];
        }
    }
});

function iniciarAlertaVisual(remetenteNome) {
    if (document.visibilityState !== 'visible' && !intervaloPiscarTitulo) {
        let alternar = false;
        intervaloPiscarTitulo = setInterval(() => {
            document.title = alternar ? `💬 Nova mensagem de ${remetenteNome}` : tituloOriginal;
            alternar = !alternar;
        }, 1200);
    }
}

function pararAlertaVisual() {
    if (intervaloPiscarTitulo) {
        clearInterval(intervaloPiscarTitulo);
        intervaloPiscarTitulo = null;
        document.title = tituloOriginal;
    }
}

function validarGatilhoMaster() {
    const campo = document.getElementById('campoBusca');
    if (!campo) return;
    if (campo.value === SENHA_MASTER) {
        campo.value = "";
        document.getElementById('telaJornal').classList.add('oculto');
        document.getElementById('modalSala').classList.remove('oculto');
        document.getElementById('senhaSalaInput').focus();
    } else if (campo.value === "000000") {
        campo.value = "";
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ tipoEvent: 'limpar_historico' }));
            alert("Aviso: Histórico apagado com sucesso.");
        } else {
            alert("Você precisa estar conectado à sala para limpar o servidor.");
        }
    }
}

function validarSenhaSala() {
    const inputSala = document.getElementById('senhaSalaInput');
    if (!inputSala) return;
    senhaPendenteLogin = inputSala.value.trim();

    if (senhaPendenteLogin === "") {
        alert("Digite uma credencial válida.");
        return;
    }

    conectarEAutenticar(senhaPendenteLogin);
}

function conectarEAutenticar(senha) {
    if (socket) {
        socket.onclose = null;
        socket.close();
    }

    const protocolo = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    socket = new WebSocket(protocolo + window.location.host);

    socket.onopen = () => {
        socket.send(JSON.stringify({
            tipoEvent: 'login',
            senha: senha
        }));
    };

    socket.onmessage = (evento) => {
        try {
            const resposta = JSON.parse(evento.data);

            if (resposta.tipo === 'login_sucesso') {
                idUsuario = resposta.id;
                nomeUsuario = resposta.nome;
                localStorage.setItem('id_observador', idUsuario);
                localStorage.setItem('nome_observador', nomeUsuario);

                const inputSala = document.getElementById('senhaSalaInput');
                if (inputSala) inputSala.value = "";

                document.getElementById('modalSala').classList.add('oculto');
                document.getElementById('telaChat').classList.remove('oculto');
                
                const status = document.getElementById('statusConexao');
                status.innerText = "Online";
                status.className = "status-online";

                const area = document.getElementById('areaMensagens');
                area.innerHTML = '';
                resposta.conteudo.forEach(msg => renderizarMensagem(msg, msg.remetente === idUsuario));

                iniciarMonitoramentoInatividade();
                configurarEventosSocket();
            } 
            else if (resposta.tipo === 'login_erro') {
                alert("Credencial de acesso inválida. Use: mario, gal ou amigos.");
                if (socket) socket.close();
            }
            else {
                processarMensagemSocket(resposta);
            }
        } catch (err) {
            console.error("Erro no processamento:", err);
        }
    };

    socket.onerror = () => {
        alert("Erro de conexão com o servidor.");
    };
}

function configurarEventosSocket() {
    socket.onclose = () => {
        const status = document.getElementById('statusConexao');
        status.innerText = "Desconectado";
        status.className = "status-offline";
        clearTimeout(tempoReconexao);
        tempoReconexao = setTimeout(() => { 
            if (senhaPendenteLogin) conectarEAutenticar(senhaPendenteLogin);
        }, 3000);
    };

    socket.onmessage = (evento) => {
        try {
            const resposta = JSON.parse(evento.data);
            processarMensagemSocket(resposta);
        } catch (err) { console.error("Erro nas mensagens:", err); }
    };
}

function processarMensagemSocket(resposta) {
    if (resposta.tipo === 'historico_limpo') {
        document.getElementById('areaMensagens').innerHTML = '';
    }
    else if (resposta.tipo === 'apagar_antigas') {
        resposta.ids.forEach(id => {
            const elem = document.getElementById(`msg-${id}`);
            if (elem) {
                elem.classList.add('saindo');
                setTimeout(() => { if (elem.parentNode) elem.remove(); }, 500);
            }
        });
    }
    else if (resposta.tipo === 'nova_mensagem') {
        const msg = resposta.conteudo;
        renderizarMensagem(msg, msg.remetente === idUsuario);
        
        if (msg.remetente !== idUsuario) {
            tocarSomNotificacao();
            iniciarAlertaVisual(msg.nomeRemetente);

            if (document.visibilityState === 'visible') {
                socket.send(JSON.stringify({ tipoEvent: 'confirmar_leitura', idMensagem: msg.id }));
            } else {
                mensagensLidasEmEspera.push(msg.id);
            }
        }
    }
    else if (resposta.tipo === 'mensagem_lida_confirmada') {
        removerMensagemLida(resposta.idMensagem);
    }
    else if (resposta.tipo === 'atualizar_reacoes') {
        atualizarReacoesNaTela(resposta.idMensagem, resposta.reacoes);
    }
    else if (resposta.tipo === 'usuario_digitando') {
        const elem = document.getElementById('indicadorDigitando');
        elem.innerText = resposta.estado ? `${resposta.remetente} está digitando...` : "";
    }
}

// --- CITAÇÃO (REPLY) ---
function prepararCitacao(idMsg, nomeRemetente, textoResumo) {
    mensagemCitadaAtiva = { id: idMsg, remetente: nomeRemetente, texto: textoResumo };
    document.getElementById('citacaoTextoRemetente').innerText = `Respondendo a ${nomeRemetente}`;
    document.getElementById('citacaoTextoMensagem').innerText = textoResumo;
    document.getElementById('painelCitacao').classList.remove('oculto');
    document.getElementById('mensagemInput').focus();
}

function cancelarCitacao() {
    mensagemCitadaAtiva = null;
    document.getElementById('painelCitacao').classList.add('oculto');
}

// --- REAÇÕES RÁPIDAS ---
function abrirMenuReacoes(event, idMsg) {
    event.stopPropagation();
    fecharMenusFlutuantes();

    const balao = document.getElementById(`msg-${idMsg}`);
    if (!balao) return;

    let menu = balao.querySelector('.menu-reacoes-rapidas');
    if (menu) {
        menu.remove();
        return;
    }

    menu = document.createElement('div');
    menu.className = 'menu-reacoes-rapidas';
    ['👍', '❤️', '🔥', '👀', '😂'].forEach(emoji => {
        const span = document.createElement('span');
        span.innerText = emoji;
        span.onclick = (e) => {
            e.stopPropagation();
            enviarReacao(idMsg, emoji);
            menu.remove();
        };
        menu.appendChild(span);
    });

    balao.appendChild(menu);

    document.addEventListener('click', function fecharMenu(e) {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', fecharMenu);
        }
    }, { once: true });
}

function enviarReacao(idMensagem, emoji) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            tipoEvent: 'adicionar_reacao',
            idMensagem: idMensagem,
            emoji: emoji
        }));
    }
}

function atualizarReacoesNaTela(idMensagem, reacoes) {
    const balao = document.getElementById(`msg-${idMensagem}`);
    if (!balao) return;

    let container = balao.querySelector('.container-reacoes');
    if (!container) {
        container = document.createElement('div');
        container.className = 'container-reacoes';
        balao.appendChild(container);
    }

    container.innerHTML = '';
    for (const [emoji, usuarios] of Object.entries(reacoes)) {
        if (usuarios.length > 0) {
            const badge = document.createElement('span');
            badge.className = 'reacao-badge';
            badge.innerHTML = `${emoji} ${usuarios.length}`;
            container.appendChild(badge);
        }
    }
    if (container.children.length === 0) {
        container.remove();
    }
}

function renderizarMensagem(pacote, eMinha) {
    const area = document.getElementById('areaMensagens');
    if (!area) return;
    if (document.getElementById(`msg-${pacote.id}`)) return;
    
    const balao = document.createElement('div');
    balao.id = `msg-${pacote.id}`;
    balao.classList.add('mensagem', eMinha ? 'mensagem-minha' : 'mensagem-outros');
    balao.onclick = (e) => abrirMenuReacoes(e, pacote.id);

    let conteudoHTML = '';
    if (!eMinha) {
        conteudoHTML += `<div style="font-size: 11px; color: #40b3e0; margin-bottom: 5px; font-weight: bold;">${pacote.nomeRemetente || 'Anônimo'}</div>`;
    }

    if (pacote.citacao) {
        conteudoHTML += `<div class="citacao-balao">
                            <div class="citacao-balao-remetente">${pacote.citacao.remetente}</div>
                            <div class="citacao-balao-texto">${pacote.citacao.texto}</div>
                         </div>`;
    }

    let textoResumoParaCitacao = '';
    if (pacote.tipoMidia === 'texto') {
        conteudoHTML += `<span>${pacote.conteudo}</span>`;
        textoResumoParaCitacao = pacote.conteudo;
    }
    else if (pacote.tipoMidia === 'imagem') {
        conteudoHTML += `<img src="${pacote.conteudo}" alt="Imagem">`;
        textoResumoParaCitacao = '📷 [Imagem]';
    }
    else if (pacote.tipoMidia === 'audio') {
        conteudoHTML += `<audio controls preload="metadata" style="width: 100%; min-width: 200px;">
                            <source src="${pacote.conteudo}" type="audio/webm">
                            <source src="${pacote.conteudo}" type="audio/mp4">
                            Seu navegador não suporta áudio.
                         </audio>`;
        textoResumoParaCitacao = '🎤 [Áudio]';
    }

    conteudoHTML += `<button type="button" onclick="event.stopPropagation(); prepararCitacao('${pacote.id}', '${eMinha ? 'Você' : (pacote.nomeRemetente || 'Anônimo')}', '${textoResumoParaCitacao.replace(/'/g, "\\'")}')" style="background:none; border:none; color:#7b8a97; font-size:11px; cursor:pointer; margin-top:4px; display:block;">↩️ Responder</button>`;

    const iconeBase = pacote.lida ? '✓✓' : '✓';
    const classeBase = pacote.lida ? 'status-check check-lido' : 'status-check check-enviado';
    const statusIcone = eMinha ? `<span class="${classeBase}" id="check-${pacote.id}">${iconeBase}</span>` : '';
    
    balao.innerHTML = conteudoHTML + statusIcone;

    if (pacote.reacoes && Object.keys(pacote.reacoes).length > 0) {
        const container = document.createElement('div');
        container.className = 'container-reacoes';
        for (const [emoji, usuarios] of Object.entries(pacote.reacoes)) {
            if (usuarios.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'reacao-badge';
                badge.innerHTML = `${emoji} ${usuarios.length}`;
                container.appendChild(badge);
            }
        }
        balao.appendChild(container);
    }

    area.appendChild(balao);
    area.scrollTop = area.scrollHeight;
}

function removerMensagemLida(idMensagem) {
    const check = document.getElementById(`check-${idMensagem}`);
    if (check) { check.innerText = '✓✓'; check.className = 'status-check check-lido'; }
}

function enviarComTentativa(pacote) {
    if (mensagemCitadaAtiva) {
        pacote.citacao = mensagemCitadaAtiva;
        cancelarCitacao();
    }

    const pacoteStr = JSON.stringify({ tipoEvent: 'nova_mensagem', conteudo: pacote });
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(pacoteStr);
    } else {
        alert("Conexão perdida. Faça o login novamente.");
    }
}

function botaoPanicoSair() { bloquearPorInatividade(); }

function bloquearPorInatividade() {
    senhaPendenteLogin = "";
    document.getElementById('telaChat').classList.add('oculto');
    document.getElementById('modalSala').classList.add('oculto');
    document.getElementById('telaJornal').classList.remove('oculto');
    pararMonitoramentoInatividade();
    if (socket) socket.close();
}

function reiniciarCronometro() {
    clearTimeout(cronometroInatividade);
    cronometroInatividade = setTimeout(bloquearPorInatividade, TEMPO_INATIVIDADE);
}

function iniciarMonitoramentoInatividade() {
    reiniciarCronometro();
    window.addEventListener('mousemove', reiniciarCronometro);
    window.addEventListener('keypress', reiniciarCronometro);
    window.addEventListener('touchstart', reiniciarCronometro);
}

function pararMonitoramentoInatividade() {
    clearTimeout(cronometroInatividade);
    window.removeEventListener('mousemove', reiniciarCronometro);
    window.removeEventListener('keypress', reiniciarCronometro);
    window.removeEventListener('touchstart', reiniciarCronometro);
}

function fecharMenusFlutuantes() {
    document.getElementById('menuFoto').classList.add('oculto');
    document.getElementById('menuEmoji').classList.add('oculto');
}

function toggleMenuFoto() {
    const menu = document.getElementById('menuFoto');
    menu.classList.toggle('oculto');
    document.getElementById('menuEmoji').classList.add('oculto'); 
}

function toggleMenuEmoji() {
    const menu = document.getElementById('menuEmoji');
    menu.classList.toggle('oculto');
    document.getElementById('menuFoto').classList.add('oculto'); 
}

function addEmoji(emoji) {
    const input = document.getElementById('mensagemInput');
    input.value += emoji;
    input.focus();
    toggleMenuEmoji();
}

function enviarMensagemTexto() {
    const input = document.getElementById('mensagemInput');
    const texto = input.value.trim();
    if (texto === "") return;
    const pacote = { 
        tipoMidia: 'texto', 
        conteudo: texto
    };
    enviarComTentativa(pacote);
    input.value = "";
}

document.getElementById('mensagemInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') enviarMensagemTexto();
});

function processarArquivoImagem(e) {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    if (arquivo.size > 8 * 1024 * 1024) { alert("A imagem deve ter no máximo 8MB."); this.value = ""; return; }
    const leitor = new FileReader();
    leitor.onload = function(evt) {
        const pacote = { 
            tipoMidia: 'imagem', 
            conteudo: evt.target.result
        };
        enviarComTentativa(pacote);
    };
    leitor.readAsDataURL(arquivo);
    this.value = "";
    fecharMenusFlutuantes();
}

document.getElementById('cameraInput').addEventListener('change', processarArquivoImagem);
document.getElementById('galeriaInput').addEventListener('change', processarArquivoImagem);

async function toggleGravacaoAudio() {
    const btnAudio = document.getElementById('btnAudio');
    
    if (!gravandoAudio) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            }

            mediaRecorder = new MediaRecorder(stream, { mimeType });
            pedacosAudio = [];

            mediaRecorder.ondataavailable = (e) => { 
                if (e.data && e.data.size > 0) pedacosAudio.push(e.data); 
            };
            
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                const blobAudio = new Blob(pedacosAudio, { type: mimeType });
                
                if (blobAudio.size === 0) { alert("Áudio vazio."); return; }
                if (blobAudio.size > 8 * 1024 * 1024) { alert("Áudio muito longo."); return; }
                
                const leitor = new FileReader();
                leitor.onload = function(evt) {
                    const pacote = { 
                        tipoMidia: 'audio', 
                        conteudo: evt.target.result
                    };
                    enviarComTentativa(pacote);
                };
                leitor.readAsDataURL(blobAudio);
            };
            
            mediaRecorder.start(500);
            gravandoAudio = true;
            btnAudio.classList.add('gravando');
            btnAudio.innerText = "⏹️";
        } catch (err) { 
            alert("Permissão para microfone negada ou formato não suportado."); 
        }
    } else {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        gravandoAudio = false;
        btnAudio.classList.remove('gravando');
        btnAudio.innerText = "🎤";
    }
}
