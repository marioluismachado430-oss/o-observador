const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const admin = require('firebase-admin');

// Inicialização segura do Firebase Admin usando a variável de ambiente do Render
try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("[O OBSERVADOR] Firebase conectado com sucesso.");
    } else {
        console.error("[O OBSERVADOR] ERRO: Variável FIREBASE_SERVICE_ACCOUNT não encontrada!");
    }
} catch (e) {
    console.error("[O OBSERVADOR] Erro ao inicializar o Firebase:", e);
}

const db = admin.apps.length ? admin.firestore() : null;

const app = express();
const servidor = http.createServer(app);

const wss = new WebSocket.Server({ 
    server: servidor,
    maxPayload: 10 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

// Credenciais de acesso individuais
const USUARIOS_AUTORIZADOS = {
    "mario": { id: "user_mario", nome: "Mario Luis" },
    "gal": { id: "user_gal", nome: "Gal" },
    "amigos": { id: "user_amigos", nome: "Amigos" }
};

// Função auxiliar para buscar histórico no Firestore
async function carregarHistorico() {
    if (!db) return [];
    try {
        const snapshot = await db.collection('mensagens').orderBy('timestamp', 'asc').get();
        let mensagens = [];
        snapshot.forEach(doc => {
            mensagens.push(doc.data());
        });
        return mensagens;
    } catch (erro) {
        console.error("Erro ao carregar histórico do Firestore:", erro);
        return [];
    }
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.usuarioAtual = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (mensagem) => {
        try {
            const dados = JSON.parse(mensagem);

            // VALIDAÇÃO DE LOGIN COM SENHA INDIVIDUAL
            if (dados.tipoEvent === 'login') {
                const credencial = dados.senha ? dados.senha.toLowerCase().trim() : '';
                if (USUARIOS_AUTORIZADOS[credencial]) {
                    ws.usuarioAtual = USUARIOS_AUTORIZADOS[credencial];
                    const historicoMensagens = await carregarHistorico();
                    
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
            // NOVA MENSAGEM
            else if (dados.tipoEvent === 'nova_mensagem') {
                if (!ws.usuarioAtual) return;

                const novaMsg = {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    remetente: ws.usuarioAtual.id,
                    nomeRemetente: ws.usuarioAtual.nome,
                    tipoMidia: dados.conteudo.tipoMidia,
                    conteudo: dados.conteudo.conteudo,
                    lida: false,
                    timestamp: Date.now()
                };
                
                // Salva permanentemente no Firestore
                if (db) {
                    await db.collection('mensagens').doc(novaMsg.id).set(novaMsg);
                }

                wss.clients.forEach((cliente) => {
                    if (cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'nova_mensagem',
                            conteudo: novaMsg
                        }));
                    }
                });
            } 
            // CONFIRMAR LEITURA
            else if (dados.tipoEvent === 'confirmar_leitura') {
                if (db) {
                    await db.collection('mensagens').doc(dados.idMensagem).update({ lida: true });
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
            // DIGITANDO
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
            // LIMPAR HISTÓRICO (Comando 000000)
            else if (dados.tipoEvent === 'limpar_historico') {
                if (db) {
                    const snapshot = await db.collection('mensagens').get();
                    const batch = db.batch();
                    snapshot.docs.forEach((doc) => {
                        batch.delete(doc.ref);
                    });
                    await batch.commit();
                }

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

// Lixeiro inteligente (após 24h e apenas se lida)
const UM_DIA = 24 * 60 * 60 * 1000;
const intervaloLimpeza = setInterval(async () => {
    if (!db) return;
    const agora = Date.now();
    try {
        const snapshot = await db.collection('mensagens').get();
        let idsRemovidos = [];
        const batch = db.batch();

        snapshot.forEach(doc => {
            const m = doc.data();
            if (agora - m.timestamp > UM_DIA && m.lida === true) {
                idsRemovidos.push(m.id);
                batch.delete(doc.ref);
            }
        });

        if (idsRemovidos.length > 0) {
            await batch.commit();
            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                    c.send(JSON.stringify({
                        tipo: 'apagar_antigas',
                        ids: idsRemovidos
                    }));
                }
            });
        }
    } catch (err) {
        console.error("Erro na limpeza automática:", err);
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
