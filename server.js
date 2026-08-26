const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const servidor = http.createServer(app);

// Suporta mídia pesada
const wss = new WebSocket.Server({ 
    server: servidor,
    maxPayload: 10 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

let historicoMensagens = [];

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.send(JSON.stringify({
        tipo: 'historico',
        conteudo: historicoMensagens
    }));

    ws.on('message', (mensagem) => {
        try {
            const dados = JSON.parse(mensagem);

            if (dados.tipoEvent === 'nova_mensagem') {
                // Garante que a mensagem tenha uma etiqueta de tempo caso não venha
                if (!dados.conteudo.timestamp) {
                    dados.conteudo.timestamp = Date.now();
                }
                
                historicoMensagens.push(dados.conteudo);

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'nova_mensagem',
                            conteudo: dados.conteudo
                        }));
                    }
                });
            } 
            else if (dados.tipoEvent === 'confirmar_leitura') {
                const msgAlvo = historicoMensagens.find(m => m.id === dados.idMensagem);
                if (msgAlvo) msgAlvo.lida = true;

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
                wss.clients.forEach((cliente) => {
                    if (cliente !== ws && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'usuario_digitando',
                            remetente: dados.remetente,
                            estado: dados.estado
                        }));
                    }
                });
            }
            else if (dados.tipoEvent === 'limpar_historico') {
                historicoMensagens = []; 
                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'historico_limpo' 
                        }));
                    }
                });
            }
        } catch (erro) {
            console.error("Erro ao processar pacote recebido:", erro);
        }
    });

    ws.on('error', (erro) => { console.error("Erro na conexão WebSocket:", erro); });
});

// MONITOR DE CONEXÃO
const intervaloMonitor = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 25000);

// LIXEIRO INTELIGENTE DE 24 HORAS (Verifica o banco a cada 1 minuto)
const UM_DIA = 24 * 60 * 60 * 1000;
const intervaloLimpeza = setInterval(() => {
    const agora = Date.now();
    let idsRemovidos = [];
    
    // Filtra deixando só as que têm menos de 24 horas
    historicoMensagens = historicoMensagens.filter(m => {
        if (agora - m.timestamp > UM_DIA) {
            idsRemovidos.push(m.id);
            return false; // Joga fora
        }
        return true; // Mantém
    });

    // Se ele achou coisas velhas pra jogar fora, avisa a tela de todo mundo pra apagar
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
