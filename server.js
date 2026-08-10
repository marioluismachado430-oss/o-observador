// --- BACKEND DO SERVIDOR (server.js) ---
const express = require('express');
const path = require('path');
const app = express();

// Define que todos os arquivos de interface estarão dentro da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Quando a página for acessada, envia o arquivo index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configuração corrigida para evitar desconexões no Render (0.0.0.0)
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[COPILOTO DE OPERAÇÕES] Servidor rodando na porta ${PORT}`);
});
