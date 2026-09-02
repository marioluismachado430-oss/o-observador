const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const servidor = http.createServer(app);

// Aumentado para 50MB para suportar imagens de alta qualidade e áudios longos sem desconectar
const wss = new WebSocket.Server({ 
    server: servidor,
    maxPayload: 50 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

const USUARIOS_AUTORIZADOS = {
    "mario": { id: "user_mario", nome: "Mario Luis" },
    "gal": { id: "user_gal", nome: "Gal" },
    "amigos": { id: "user_amigos", nome: "Amigos" }
};

let historicoMensagens = [];

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.usuarioAtual = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (mensagem) => {
        try {
            const dados = JSON.parse(mensagem);

            if (dados.tipoEvent === 'login') {
                const credencial = dados.senha ? dados.senha.toLowerCase().trim() : '';
                if (USUARIOS_AUTORIZADOS[credencial]) {
                    ws.usuarioAtual = USUARIOS_AUTORIZADOS[credencial];
                    
                    ws.send(JSON.stringify({
                        tipo: 'login_sucesso',
                        id: ws.usuarioAtual.id,
                        nome: ws.usuarioAtual.nome,
                        conteudo: historicoMensagens
                    }));
                } else {
                    ws.send(JSON.stringify({ tipo: 'login_erro' }));
                }
            }
            else if (dados.tipoEvent === 'nova_mensagem') {
                if (!ws.usuarioAtual) return;

                const novaMsg = {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    remetente: ws.usuarioAtual.id,
                    nomeRemetente: ws.usuarioAtual.nome,
                    tipoMidia: dados.conteudo.tipoMidia,
                    conteudo: dados.conteudo.conteudo,
                    citacao: dados.conteudo.citacao || null,
                    reacoes: {},
                    lida: false,
                    timestampCriacao: Date.now(),
                    timestampLeitura: null
                };
                
                historicoMensagens.push(novaMsg);

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'nova_mensagem',
                            conteudo: novaMsg
                        }));
                    }
                });
            } 
            else if (dados.tipoEvent === 'adicionar_reacao') {
                if (!ws.usuarioAtual) return;
                const msgAlvo = historicoMensagens.find(m => m.id === dados.idMensagem);
                if (msgAlvo) {
                    const emoji = dados.emoji;
                    if (!msgAlvo.reacoes[emoji]) {
                        msgAlvo.reacoes[emoji] = [];
                    }
                    const index = msgAlvo.reacoes[emoji].indexOf(ws.usuarioAtual.id);
                    if (index > -1) {
                        msgAlvo.reacoes[emoji].splice(index, 1);
                        if (msgAlvo.reacoes[emoji].length === 0) delete msgAlvo.reacoes[emoji];
                    } else {
                        msgAlvo.reacoes[emoji].push(ws.usuarioAtual.id);
                    }

                    wss.clients.forEach((cliente) => {
                        if (cliente.readyState === WebSocket.OPEN) {
                            cliente.send(JSON.stringify({
                                tipo: 'atualizar_reacoes',
                                idMensagem: msgAlvo.id,
                                reacoes: msgAlvo.reacoes
                            }));
                        }
                    });
                }
            }
            else if (dados.tipoEvent === 'confirmar_leitura') {
                const msgAlvo = historicoMensagens.find(m => m.id === dados.idMensagem);
                if (msgAlvo && !msgAlvo.lida) {
                    msgAlvo.lida = true;
                    msgAlvo.timestampLeitura = Date.now();
                }

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'mensagem_lida_confirmada',
                            idMensagem: dados.idMensagem
                        }));
                    }
                });
            }
            else if (dados.tipoEvent === 'digitando') {
                if (!ws.usuarioAtual) return;
                wss.clients.forEach((cliente) => {
                    if (cliente !== ws && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'usuario_digitando',
                            remetente: ws.usuarioAtual.nome,
                            estado: dados.estado
                        }));
                    }
                });
            }
            else if (dados.tipoEvent === 'limpar_historico') {
                historicoMensagens = []; 
                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({ tipo: 'historico_limpo' }));
                    }
                });
            }
        } catch (erro) {
            console.error("Erro ao processar pacote:", erro);
        }
    });

    ws.on('error', (erro) => { console.error("Erro no WebSocket:", erro); });
});

const intervaloMonitor = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 25000);

const UM_DIA = 24 * 60 * 60 * 1000;
const intervaloLimpeza = setInterval(() => {
    const agora = Date.now();
    let idsRemovidos = [];
    
    historicoMensagens = historicoMensagens.filter(m => {
        if (m.lida === true && m.timestampLeitura && (agora - m.timestampLeitura > UM_DIA)) {
            idsRemovidos.push(m.id);
            return false;
        }
        return true;
    });

    if (idsRemovidos.length > 0) {
        wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
                c.send(JSON.stringify({
                    tipo: 'apagar_antigas',
                    ids: idsRemovidos
                }));
            }
        });
    }
}, 60000);

wss.on('close', () => {
    clearInterval(intervaloMonitor);
    clearInterval(intervaloLimpeza);
});

const PORTA = process.env.PORT || 3000;
servidor.listen(PORTA, '0.0.0.0', () => {
    console.log(`[O OBSERVADOR] Servidor rodando na porta ${PORTA}`);
});
