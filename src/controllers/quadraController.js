const quadraModel = require('../models/quadraModel');
const reservaModel = require('../models/reservaModel');
const prisma = require('../database/prismaClient');
const { normalizarQuadra, resolverEsporteIds } = require('../utils/quadraEsporteUtils');

function mapQuadraResponse(quadra) {
  if (!quadra) return quadra;

  const { imagemBlob, imagemMimeType, ...rest } = quadra;
  const quadraNormalizada = normalizarQuadra(rest);

  return {
    ...quadraNormalizada,
    imagem: imagemBlob ? `/quadras/${quadra.id}/imagem` : null,
  };
}

function decodeBase64Image(base64Value) {
  if (base64Value === undefined) return undefined;
  if (base64Value === null || base64Value === '') return null;

  try {
    return Buffer.from(String(base64Value), 'base64');
  } catch (_error) {
    return 'INVALID_BASE64';
  }
}

function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  }

  return Boolean(value);
}

const quadraController = {
  list: async (req, res) => {
    try {
      const { cidade, estado, esporte, valorMin, valorMax } = req.query;
      const where = {};
      
      if (cidade) where.cidade = { contains: cidade };
      if (estado) where.estado = estado;
      if (esporte) {
        where.quadraEsportes = {
          some: {
            esporte: {
              nome: { contains: esporte, mode: 'insensitive' },
            },
          },
        };
      }
      
      if (valorMin || valorMax) {
        where.valorPorHora = {};
        if (valorMin) where.valorPorHora.gte = parseFloat(valorMin);
        if (valorMax) where.valorPorHora.lte = parseFloat(valorMax);
      }

      const quadras = await prisma.quadra.findMany({
        where,
        include: { horarios: true, quadraEsportes: { include: { esporte: true } } },
      });
      res.json(quadras.map(mapQuadraResponse));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadras', detalhes: error.message });
    }
  },

  create: async (req, res) => {
    const {
      nome,
      esporte,
      esporteIds,
      esportes,
      valorPorHora,
      descricao,
      endereco,
      cidade,
      estado,
      cep,
      latitude,
      longitude,
      horarios,
      imagemBlob,
      imagemMimeType,
      horasAntecedenciaCancelamento,
      requerAprovacao,
    } = req.body;
    const locadorId = req.user.id;

    if (!nome || (!Array.isArray(esporteIds) && !Array.isArray(esportes) && !esporte) || !valorPorHora || !Array.isArray(horarios)) {
      return res.status(400).json({ erro: 'Campos obrigatórios: nome, esportes, valorPorHora, horarios (array)' });
    }

    let imagemBuffer = decodeBase64Image(imagemBlob);
    if (imagemBuffer === 'INVALID_BASE64') {
      imagemBuffer = null;
    }

    try {
      const novaQuadra = await prisma.$transaction(async (tx) => {
        const esporteIdsResolvidos = await resolverEsporteIds(tx, { esporteIds, esportes, esporte });

        const quadra = await tx.quadra.create({
          data: {
            nome,
            valorPorHora: parseFloat(valorPorHora),
            descricao,
            imagemBlob: imagemBuffer === undefined ? null : imagemBuffer,
            imagemMimeType: imagemBuffer ? (imagemMimeType || 'application/octet-stream') : null,
            endereco,
            cidade,
            estado,
            cep,
            latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
            longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null,
            horasAntecedenciaCancelamento: horasAntecedenciaCancelamento !== undefined ? Number(horasAntecedenciaCancelamento) : 6,
            requerAprovacao: requerAprovacao !== undefined ? parseBooleanValue(requerAprovacao, true) : true,
            locadorId: Number(locadorId)
          }
        });

        await tx.quadraEsporte.createMany({
          data: esporteIdsResolvidos.map((esporteId) => ({
            quadraId: quadra.id,
            esporteId,
          })),
        });

        const horariosCriados = horarios.length > 0
          ? await Promise.all(
              horarios.map(h => tx.horario.create({
                data: {
                  quadraId: quadra.id,
                  diaSemana: Number(h.diaSemana),
                  horaAbertura: h.horaAbertura,
                  horaFechamento: h.horaFechamento
                }
              }))
            )
          : [];

        return tx.quadra.findUnique({
          where: { id: quadra.id },
          include: {
            horarios: true,
            quadraEsportes: { include: { esporte: true } },
          },
        });
      }, { timeout: 10000 });

      res.status(201).json(mapQuadraResponse(novaQuadra));
    } catch (error) {
      res.status(400).json({ erro: 'Erro ao criar quadra', detalhes: error.message });
    }
  },

  getById: async (req, res) => {
    const { id } = req.params;

    try {
      const quadra = await quadraModel.findById(id);
      console.log(quadra)
      if (!quadra) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }
      res.json(mapQuadraResponse(quadra));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar quadra', detalhes: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const {
      nome,
      esporte,
      esporteIds,
      esportes,
      valorPorHora,
      descricao,
      endereco,
      cidade,
      estado,
      cep,
      latitude,
      longitude,
      horarios,
      imagemBlob,
      imagemMimeType,
      horasAntecedenciaCancelamento,
      requerAprovacao,
    } = req.body;

    try {
      const quadraExistente = await quadraModel.findById(id);
      if (!quadraExistente) {
        return res.status(404).json({ erro: 'Quadra não encontrada' });
      }

      if (quadraExistente.locadorId !== req.user.id) {
        return res.status(403).json({ erro: 'Você não tem permissão para atualizar esta quadra' });
      }

      const requerAprovacaoNovo = requerAprovacao !== undefined
        ? parseBooleanValue(requerAprovacao, quadraExistente.requerAprovacao)
        : quadraExistente.requerAprovacao;

      if (requerAprovacao !== undefined && requerAprovacaoNovo !== quadraExistente.requerAprovacao) {
        const pendentesAprovacao = await prisma.reserva.count({
          where: {
            quadraId: Number(id),
            status: 'AGUARDANDO_APROVACAO',
          },
        });

        if (pendentesAprovacao > 0) {
          return res.status(400).json({
            erro: 'Não é possível alterar a regra de aprovação enquanto existirem agendamentos aguardando aprovação para esta quadra',
          });
        }
      }

      const updateData = {};
      if (nome) updateData.nome = nome;
      if (valorPorHora) updateData.valorPorHora = parseFloat(valorPorHora);
      if (descricao !== undefined) updateData.descricao = descricao;
      if (endereco !== undefined) updateData.endereco = endereco;
      if (cidade !== undefined) updateData.cidade = cidade;
      if (estado !== undefined) updateData.estado = estado;
      if (cep !== undefined) updateData.cep = cep;
      if (latitude !== undefined) updateData.latitude = latitude !== null ? parseFloat(latitude) : null;
      if (longitude !== undefined) updateData.longitude = longitude !== null ? parseFloat(longitude) : null;
      if (horasAntecedenciaCancelamento !== undefined) updateData.horasAntecedenciaCancelamento = Number(horasAntecedenciaCancelamento);
      if (requerAprovacao !== undefined) updateData.requerAprovacao = requerAprovacaoNovo;

      const temEsportesNoPayload = Array.isArray(esporteIds) || Array.isArray(esportes) || esporte;

      let imagemBuffer = decodeBase64Image(imagemBlob);
      if (imagemBuffer === 'INVALID_BASE64') {
        imagemBuffer = null;
      }

      if (imagemBuffer !== undefined) {
        updateData.imagemBlob = imagemBuffer;
        updateData.imagemMimeType = imagemBuffer ? (imagemMimeType || 'application/octet-stream') : null;
      }

      let quadraAtualizada;
      if ((horarios && Array.isArray(horarios)) || temEsportesNoPayload) {
        quadraAtualizada = await prisma.$transaction(async (tx) => {
          if (horarios && Array.isArray(horarios)) {
            await tx.horario.deleteMany({ where: { quadraId: Number(id) } });

            await tx.horario.createMany({
              data: horarios.map(h => ({
                quadraId: Number(id),
                diaSemana: Number(h.diaSemana),
                horaAbertura: h.horaAbertura,
                horaFechamento: h.horaFechamento,
              })),
            });
          }

          if (temEsportesNoPayload) {
            const esporteIdsResolvidos = await resolverEsporteIds(tx, { esporteIds, esportes, esporte });
            await tx.quadraEsporte.deleteMany({ where: { quadraId: Number(id) } });
            await tx.quadraEsporte.createMany({
              data: esporteIdsResolvidos.map((esporteId) => ({
                quadraId: Number(id),
                esporteId,
              })),
            });
          }

          return tx.quadra.update({
            where: { id: Number(id) },
            data: updateData,
            include: { horarios: true, quadraEsportes: { include: { esporte: true } } },
          });
        }, { timeout: 15000 });
      } else {
        quadraAtualizada = await quadraModel.update(id, updateData);
      }

      res.json(mapQuadraResponse(quadraAtualizada));
    } catch (error) {
      console.log(error)
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

  getImagem: async (req, res) => {
    const { id } = req.params;
    try {
      const quadra = await prisma.quadra.findUnique({
        where: { id: Number(id) },
        select: { imagemBlob: true, imagemMimeType: true },
      });

      if (!quadra || !quadra.imagemBlob) {
        return res.status(404).json({ erro: 'Imagem não encontrada' });
      }

      res.set('Content-Type', quadra.imagemMimeType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(quadra.imagemBlob));
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar imagem', detalhes: error.message });
    }
  },

  listWithHorarios: async (req, res) => {
    const { data, quadraId } = req.query;

    if (!data) {
      return res.status(400).json({ erro: 'Parâmetro obrigatório: data (formato YYYY-MM-DD)' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ erro: 'Formato de data inválido. Use YYYY-MM-DD' });
    }

    try {
      const [year, month, day] = data.split('-').map(Number);

      // Dia da semana para a data local (0=domingo, 6=sábado)
      const diaSemana = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

      // Limites do dia em UTC (UTC-3 → UTC: +3h)
      const inicioDiaUTC = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
      const fimDiaUTC = new Date(Date.UTC(year, month - 1, day + 1, 3, 0, 0));

      const where = {};
      if (quadraId) where.id = Number(quadraId);

      const quadras = await prisma.quadra.findMany({
        where,
        include: {
          horarios: true,
          locador: { select: { id: true, nome: true } },
          quadraEsportes: { include: { esporte: true } },
          reservas: {
            where: {
              status: { in: ['RESERVADO', 'AGUARDANDO_APROVACAO'] },
              dataInicio: { lt: fimDiaUTC },
              dataFim: { gt: inicioDiaUTC }
            }
          },
          bloqueios: {
            where: {
              dataInicio: { lt: fimDiaUTC },
              dataFim: { gt: inicioDiaUTC }
            }
          }
        }
      });

      const resultado = quadras.map(quadra => {
        const quadraBase = mapQuadraResponse(quadra);
        const horarioDia = quadra.horarios.find(h => h.diaSemana === diaSemana);
        const retornoBase = {
          id: quadraBase.id,
          nome: quadraBase.nome,
          esporte: quadraBase.esporte,
          esportes: quadraBase.esportes,
          esporteIds: quadraBase.esporteIds,
          valorPorHora: quadraBase.valorPorHora,
          imagem: quadraBase.imagem,
          latitude: quadraBase.latitude ?? null,
          longitude: quadraBase.longitude ?? null,
          locador: quadra.locador.nome,
          data,
          diaSemana: obterNomeDia(diaSemana),
        };

        if (!horarioDia) {
          return {
            ...retornoBase,
            aberto: false,
            horariosDisponiveis: []
          };
        }

        const slots = gerarSlots(horarioDia.horaAbertura, horarioDia.horaFechamento);

        const horariosDisponiveis = slots.filter(slot => {
          const [siH, siM] = slot.inicio.split(':').map(Number);
          const [sfH, sfM] = slot.fim.split(':').map(Number);
          const slotInicioUTC = new Date(Date.UTC(year, month - 1, day, siH + 3, siM, 0));
          const slotFimUTC = new Date(Date.UTC(year, month - 1, day, sfH + 3, sfM, 0));
          const reservaConflito = quadra.reservas.some(r => r.dataInicio < slotFimUTC && r.dataFim > slotInicioUTC);
          const bloqueioConflito = quadra.bloqueios.some(b => b.dataInicio < slotFimUTC && b.dataFim > slotInicioUTC);
          return !reservaConflito && !bloqueioConflito;
        });

        return {
          ...retornoBase,
          aberto: true,
          horaAbertura: horarioDia.horaAbertura,
          horaFechamento: horarioDia.horaFechamento,
          horariosDisponiveis
        };
      });

      res.json(resultado);
    } catch (error) {
      res.status(500).json({ erro: 'Erro ao buscar horários disponíveis', detalhes: error.message });
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
        where.quadraEsportes = {
          some: {
            esporte: { nome: { contains: esporte, mode: 'insensitive' } }
          }
        };
      }

      // Buscar quadras com filtros
      let quadras = await prisma.quadra.findMany({
        where,
        include: { 
          horarios: true, 
          locador: { select: { id: true, nome: true, email: true } },
          quadraEsportes: { include: { esporte: true } },
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
      const quadrasFormatadas = quadras.map(quadra => {
        const quadraBase = mapQuadraResponse(quadra);

        return {
          id: quadraBase.id,
          nome: quadraBase.nome,
          esporte: quadraBase.esporte,
          esportes: quadraBase.esportes,
          esporteIds: quadraBase.esporteIds,
          valorPorHora: quadraBase.valorPorHora,
          descricao: quadraBase.descricao,
          imagem: quadraBase.imagem,
          endereco: quadraBase.endereco,
          cidade: quadraBase.cidade,
          estado: quadraBase.estado,
          cep: quadraBase.cep,
          latitude: quadraBase.latitude ?? null,
          longitude: quadraBase.longitude ?? null,
          horasAntecedenciaCancelamento: quadraBase.horasAntecedenciaCancelamento,
          requerAprovacao: quadraBase.requerAprovacao,
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
        };
      });

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

function gerarSlots(horaAbertura, horaFechamento) {
  const [abH, abM] = horaAbertura.split(':').map(Number);
  const [fhH, fhM] = horaFechamento.split(':').map(Number);
  const slots = [];
  let h = abH, m = abM;

  while (true) {
    const nextH = h + 1;
    const nextM = m;
    if (nextH > fhH || (nextH === fhH && nextM > fhM)) break;
    slots.push({
      inicio: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      fim: `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`
    });
    h = nextH;
    m = nextM;
  }

  return slots;
}

module.exports = quadraController;