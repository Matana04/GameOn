const express = require('express');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const swaggerSpec = require('./src/swagger');
const usuarioRoutes = require('./src/routes/usuarioRoutes');
const authRoutes = require('./src/routes/authRoutes');
const quadraRoutes = require('./src/routes/quadraRoutes');
const reservaRoutes = require('./src/routes/reservaRoutes');
const filaRoutes = require('./src/routes/filaRoutes');
const bloqueioRoutes = require('./src/routes/bloqueioRoutes');
const bloqueioQuadraRoutes = require('./src/routes/bloqueioQuadraRoutes');
const esporteRoutes = require('./src/routes/esporteRoutes');
const { iniciarCronJobs } = require('./src/utils/cronJobs');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Força o Node a ignorar certificados "falsos" de redes corporativas
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Configuração do Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/', usuarioRoutes);
app.use('/auth', authRoutes);
app.use('/quadras', quadraRoutes);
app.use('/reservas', reservaRoutes);
app.use('/fila', filaRoutes);
app.use('/bloqueios', bloqueioRoutes);
app.use('/bloqueios-quadra', bloqueioQuadraRoutes);
app.use('/esportes', esporteRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor voando na porta http://localhost:${PORT}`);
  console.log(`🔗 Teste a rota principal em seu navegador!\n`);
  
  // Iniciar cron jobs para processar fila
  iniciarCronJobs();
});