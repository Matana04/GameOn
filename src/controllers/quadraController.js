const quadraModel = require('../models/quadraModel');
const reservaModel = require('../models/reservaModel');
const prisma = require('../database/prismaClient');

const quadraController = {
  list: async (req, res) => {
    try {
      const { cidade, estado, esporte, valorMin, valorMax } = req.query;
      const where = {};
      
      if (cidade) where.cidade = { contains: cidade };
      if (estado) where.estado = estado;
      if (esporte) where.esporte = { contains: esporte };
      
      if (valorMin || valorMax) {
        where.valorPorHora = {};
        if (valorMin) where.valorPorHora.gte = parseFloat(valorMin);
        if (valorMax) where.valorPorHora.lte = parseFloat(valorMax);
      }

      const quadras = await prisma.quadra.findMany({ where, include: { horarios: true } });
      res.json(quadras);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadras', detalhes: error.message });
    }
  },

  create: async (req, res) => {
    const { nome, esporte, valorPorHora, descricao, endereco, cidade, estado, cep, horarios } = req.body;
    const locadorId = req.user.id;

    if (!nome || !esporte || !valorPorHora || !horarios || !Array.isArray(horarios)) {
      return res.status(400).json({ erro: 'Campos obrigatórios: nome, esporte, valorPorHora, horarios (array)' });
    }

    try {
      const novaQuadra = await prisma.$transaction(async (tx) => {
        const quadra = await tx.quadra.create({
          data: { 
            nome, 
            esporte, 
            valorPorHora: parseFloat(valorPorHora), 
            descricao, 
            endereco,
            cidade,
            estado,
            cep,
            locadorId: Number(locadorId) 
          }
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
      }, { timeout: 10000 });

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
    const { nome, esporte, valorPorHora, descricao, endereco, cidade, estado, cep, horarios } = req.body;

    try {
      const quadraExistente = await quadraModel.findById(id);
      if (!quadraExistente) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      if (quadraExistente.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para atualizar esta quadra' });
      }

      const updateData = {};
      if (nome) updateData.nome = nome;
      if (esporte) updateData.esporte = esporte;
      if (valorPorHora) updateData.valorPorHora = parseFloat(valorPorHora);
      if (descricao !== undefined) updateData.descricao = descricao;
      if (endereco !== undefined) updateData.endereco = endereco;
      if (cidade !== undefined) updateData.cidade = cidade;
      if (estado !== undefined) updateData.estado = estado;
      if (cep !== undefined) updateData.cep = cep;

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

      if (quadra.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para deletar esta quadra' });
      }

      await quadraModel.delete(id);
      res.json({ mensagem: 'Quadra deletada com sucesso' });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao deletar quadra', detalhes: error.message });
    }
  },

  listWithHorarios: async (req, res) => {
    try {
      const quadras = await quadraModel.findAll();
      
      const quadrasFormatadas = quadras.map(quadra => {
        const horariosFormatados = quadra.horarios.map(horario => {
          const nomeDia = obterNomeDia(horario.diaSemana);
          return {
            dia: nomeDia,
            diaSemana: horario.diaSemana,
            abertura: horario.horaAbertura,
            fechamento: horario.horaFechamento,
            descricao: `${quadra.nome} está liberada ${nomeDia} das ${horario.horaAbertura} às ${horario.horaFechamento}`
          };
        });

        return {
          id: quadra.id,
          nome: quadra.nome,
          esporte: quadra.esporte,
          valorPorHora: quadra.valorPorHora,
          descricao: quadra.descricao,
          locador: quadra.locador.nome,
          horarios: horariosFormatados,
          resumo: horariosFormatados.map(h => h.descricao)
        };
      });

      res.json(quadrasFormatadas);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadras', detalhes: error.message });
    }
  },

  // Filtrar quadras por critérios (para locatários)
  filtrar: async (req, res) => {
    const { 
      localizacao, // cidade ou estado
      locadorId,   // ID do locador
      esporte,     // tipo de esporte
      dataInicio,  // para verificar disponibilidade
      dataFim      // para verificar disponibilidade
    } = req.query;

    try {
      // Construir filtros base
      const where = {};

      if (localizacao) {
        where.OR = [
          { cidade: { contains: localizacao, mode: 'insensitive' } },
          { estado: { contains: localizacao, mode: 'insensitive' } },
          { endereco: { contains: localizacao, mode: 'insensitive' } }
        ];
      }

      if (locadorId) {
        where.locadorId = Number(locadorId);
      }

      if (esporte) {
        where.esporte = { contains: esporte, mode: 'insensitive' };
      }

      // Buscar quadras com filtros
      let quadras = await prisma.quadra.findMany({
        where,
        include: { 
          horarios: true, 
          locador: { select: { id: true, nome: true, email: true } },
          reservas: {
            where: {
              status: { in: ['RESERVADO', 'AGUARDANDO_APROVACAO'] }
            }
          }
        }
      });

      // Se dataInicio e dataFim fornecidos, filtrar por disponibilidade
      if (dataInicio && dataFim) {
        const dataInicioObj = new Date(dataInicio);
        const dataFimObj = new Date(dataFim);

        if (isNaN(dataInicioObj.getTime()) || isNaN(dataFimObj.getTime())) {
          return res.status(400).json({ erro: 'Formato de data inválido para dataInicio ou dataFim' });
        }

        // Filtrar quadras disponíveis
        const quadrasDisponiveis = [];
        for (const quadra of quadras) {
          const availability = await reservaModel.findAvailability(quadra.id, dataInicioObj, dataFimObj);
          if (availability.disponivel) {
            quadrasDisponiveis.push({
              ...quadra,
              disponivel: true,
              periodo: {
                dataInicio: dataInicioObj.toISOString(),
                dataFim: dataFimObj.toISOString()
              }
            });
          } else {
            quadrasDisponiveis.push({
              ...quadra,
              disponivel: false,
              periodo: {
                dataInicio: dataInicioObj.toISOString(),
                dataFim: dataFimObj.toISOString()
              },
              conflitos: availability.conflitos.length
            });
          }
        }
        quadras = quadrasDisponiveis;
      } else {
        // Sem período, marcar como não verificado
        quadras = quadras.map(q => ({ ...q, disponivel: null }));
      }

      // Formatar resposta
      const quadrasFormatadas = quadras.map(quadra => ({
        id: quadra.id,
        nome: quadra.nome,
        esporte: quadra.esporte,
        valorPorHora: quadra.valorPorHora,
        descricao: quadra.descricao,
        endereco: quadra.endereco,
        cidade: quadra.cidade,
        estado: quadra.estado,
        cep: quadra.cep,
        locador: quadra.locador,
        horarios: quadra.horarios.map(h => ({
          diaSemana: h.diaSemana,
          horaAbertura: h.horaAbertura,
          horaFechamento: h.horaFechamento,
          nomeDia: obterNomeDia(h.diaSemana)
        })),
        disponivel: quadra.disponivel,
        periodo: quadra.periodo,
        conflitos: quadra.conflitos || 0
      }));

      res.json({
        total: quadrasFormatadas.length,
        filtros: { localizacao, locadorId, esporte, dataInicio, dataFim },
        quadras: quadrasFormatadas
      });
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao filtrar quadras', detalhes: error.message });
    }
  }
};

function obterNomeDia(dia) {
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  return dias[dia];
}

module.exports = quadraController;