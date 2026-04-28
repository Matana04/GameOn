const usuarioModel = require('../models/usuarioModel');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

const sanitizeUsuario = (usuario) => {
  if (!usuario) return usuario;
  const { senha, ...rest } = usuario;
  return rest;
};

const usuarioController = {
  status: (req, res) => {
    res.send('🏟️ API GameOn rodando e conectada ao MySQL da Aiven!');
  },

  list: async (req, res) => {
    try {
      const usuarios = await usuarioModel.findAll();
      res.json(usuarios.map(sanitizeUsuario));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar usuários', detalhes: error.message });
    }
  },

  create: async (req, res) => {
    const { nome, email, senha, tipo } = req.body;

    if (!senha) {
      return res.status(400).json({ erro: 'Senha é obrigatória.' });
    }

    if (senha.length < 10) {
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 10 caracteres.' });
    }

    try {
      const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
      const novoUsuario = await usuarioModel.create({ nome, email, senha: senhaHash, tipo });
      res.status(201).json(sanitizeUsuario(novoUsuario));
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ erro: 'Usuário já cadastrado.' });
      }
      res.status(400).json({ erro: 'Erro ao criar usuário.', detalhes: error.message });
    }
  },

  getById: async (req, res) => {
    const { id } = req.params;

    try {
      const usuario = await usuarioModel.findById(id);
      if (!usuario) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }
      res.json(sanitizeUsuario(usuario));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar usuário', detalhes: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const { nome, email, senha, tipo } = req.body;

    try {
      const usuarioExistente = await usuarioModel.findById(id);
      if (!usuarioExistente) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }

      if (senha && senha.length < 10) {
        return res.status(400).json({ erro: 'A senha deve ter pelo menos 10 caracteres.' });
      }

      const dadosUpdate = {
        ...(nome && { nome }),
        ...(email && { email }),
        ...(senha && { senha: await bcrypt.hash(senha, SALT_ROUNDS) }),
        ...(tipo && { tipo }),
      };

      const usuarioAtualizado = await usuarioModel.update(id, dadosUpdate);
      res.json(sanitizeUsuario(usuarioAtualizado));
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao atualizar usuário', detalhes: error.message });
    }
  },

  remove: async (req, res) => {
    const { id } = req.params;

    try {
      const usuarioExistente = await usuarioModel.findById(id);
      if (!usuarioExistente) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }

      await usuarioModel.delete(id);
      res.json({ mensagem: 'Usuário deletado com sucesso', id: Number(id) });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao deletar usuário', detalhes: error.message });
    }
  },
};

module.exports = usuarioController;
