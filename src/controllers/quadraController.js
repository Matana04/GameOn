const quadraModel = require('../models/quadraModel');
const prisma = require('../database/prismaClient');

const quadraController = {
  list: async (req, res) => {
    try {
      const quadras = await quadraModel.findAll();
      res.json(quadras);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadras', detalhes: error.message });
    }
  },

  create: async (req, res) => {
    const { nome, esporte, valorPorHora, descricao, locadorId, horarios } = req.body;

    if (!nome || !esporte || !valorPorHora || !locadorId || !horarios || !Array.isArray(horarios)) {
      return res.status(400).json({ erro: 'Campos obrigatórios: nome, esporte, valorPorHora, locadorId, horarios (array)' });
    }

    try {
      const novaQuadra = await prisma.$transaction(async (tx) => {
        const quadra = await tx.quadra.create({
          data: { nome, esporte, valorPorHora: parseFloat(valorPorHora), descricao, locadorId: Number(locadorId) }
        });

        const horariosCriados = await Promise.all(
          horarios.map(h => tx.horario.create({
            data: {
              quadraId: quadra.id,
              diaSemana: Number(h.diaSemana),
              horaAbertura: h.horaAbertura,
              horaFechamento: h.horaFechamento
            }
          }))
        );

        return { ...quadra, horarios: horariosCriados };
      });

      res.status(201).json(novaQuadra);
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao criar quadra', detalhes: error.message });
    }
  },

  getById: async (req, res) => {
    const { id } = req.params;

    try {
      const quadra = await quadraModel.findById(id);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }
      res.json(quadra);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadra', detalhes: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const { nome, esporte, valorPorHora, descricao, locadorId, horarios } = req.body;

    try {
      const quadraExistente = await quadraModel.findById(id);
      if (!quadraExistente) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      const updateData = {};
      if (nome) updateData.nome = nome;
      if (esporte) updateData.esporte = esporte;
      if (valorPorHora) updateData.valorPorHora = parseFloat(valorPorHora);
      if (descricao !== undefined) updateData.descricao = descricao;
      if (locadorId) updateData.locadorId = Number(locadorId);

      let quadraAtualizada;
      if (horarios && Array.isArray(horarios)) {
        quadraAtualizada = await prisma.$transaction(async (tx) => {
          // Deletar horarios antigos
          await tx.horario.deleteMany({ where: { quadraId: Number(id) } });

          // Criar novos horarios
          const novosHorarios = await Promise.all(
            horarios.map(h => tx.horario.create({
              data: {
                quadraId: Number(id),
                diaSemana: Number(h.diaSemana),
                horaAbertura: h.horaAbertura,
                horaFechamento: h.horaFechamento
              }
            }))
          );

          // Atualizar quadra
          const quadra = await tx.quadra.update({
            where: { id: Number(id) },
            data: updateData,
            include: { horarios: true }
          });

          return { ...quadra, horarios: novosHorarios };
        });
      } else {
        quadraAtualizada = await quadraModel.update(id, updateData);
      }

      res.json(quadraAtualizada);
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao atualizar quadra', detalhes: error.message });
    }
  },

  delete: async (req, res) => {
    const { id } = req.params;

    try {
      const quadra = await quadraModel.findById(id);
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      await quadraModel.delete(id);
      res.json({ mensagem: 'Quadra deletada com sucesso' });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao deletar quadra', detalhes: error.message });
    }
  },
};

module.exports = quadraController;