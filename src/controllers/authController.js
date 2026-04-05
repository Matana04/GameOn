const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const usuarioModel = require('../models/usuarioModel');

const sanitizeUsuario = (usuario) => {
  if (!usuario) return usuario;
  const { senha, ...rest } = usuario;
  return rest;
};

const loginHandler = async (req, res, expectedTipo) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios.' });
  }

  try {
    const usuario = await usuarioModel.findByEmail(email);
    if (!usuario || usuario.tipo !== expectedTipo) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { id: usuario.id, tipo: usuario.tipo },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({
      mensagem: 'Login realizado com sucesso.',
      usuario: sanitizeUsuario(usuario),
      token,
    });
  } catch (error) {
    return res.status(500).json({ erro: 'Erro ao realizar login.', detalhes: error.message });
  }
};

const authController = {
  loginLocador: (req, res) => loginHandler(req, res, 'LOCADOR'),
  loginLocatario: (req, res) => loginHandler(req, res, 'LOCATARIO'),

  logout: (req, res) => {
    const { id } = req.params;
    res.json({ mensagem: `Logout realizado com sucesso para usuário ${id}.` });
  },
};

module.exports = authController;
