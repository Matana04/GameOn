const jwt = require('jsonwebtoken');
const usuarioModel = require('../models/usuarioModel');

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token JWT ausente ou inválido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const usuario = await usuarioModel.findById(payload.id);
    if (!usuario) {
      return res.status(401).json({ erro: 'Usuário não encontrado para o token fornecido' });
    }

    req.user = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ erro: 'Token inválido ou expirado', detalhes: error.message });
  }
};

const requireLocador = (req, res, next) => {
  if (!req.user || req.user.tipo !== 'LOCADOR') {
    return res.status(403).json({ erro: 'Acesso permitido apenas para locadores' });
  }
  next();
};

module.exports = { requireAuth, requireLocador };