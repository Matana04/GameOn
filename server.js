const express = require('express');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const swaggerSpec = require('./src/swagger');
const usuarioRoutes = require('./src/routes/usuarioRoutes');
const authRoutes = require('./src/routes/authRoutes');
const quadraRoutes = require('./src/routes/quadraRoutes');

const app = express();
app.use(express.json());

// Força o Node a ignorar certificados "falsos" de redes corporativas
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Configuração do Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/', usuarioRoutes);
app.use('/auth', authRoutes);
app.use('/quadras', quadraRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor voando na porta http://localhost:${PORT}`);
  console.log(`🔗 Teste a rota principal em seu navegador!\n`);
});