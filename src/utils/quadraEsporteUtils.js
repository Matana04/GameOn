function extrairEsportesQuadra(quadra) {
  const relacionados = Array.isArray(quadra?.quadraEsportes) ? quadra.quadraEsportes : [];
  const esportes = relacionados
    .map((relacao) => relacao?.esporte)
    .filter(Boolean)
    .map((esporte) => ({ id: esporte.id, nome: esporte.nome }));

  if (esportes.length > 0) {
    return {
      esporte: esportes.map((esporte) => esporte.nome).join(', '),
      esportes,
      esporteIds: esportes.map((esporte) => esporte.id),
    };
  }

  if (quadra?.esporte) {
    return {
      esporte: quadra.esporte,
      esportes: [],
      esporteIds: [],
    };
  }

  return {
    esporte: null,
    esportes: [],
    esporteIds: [],
  };
}

function normalizarQuadra(quadra) {
  if (!quadra) return quadra;

  const { quadraEsportes, ...rest } = quadra;
  const esportes = extrairEsportesQuadra({ quadraEsportes, esporte: quadra.esporte });

  return {
    ...rest,
    ...esportes,
  };
}

function extrairValoresEsporte(payload) {
  if (Array.isArray(payload?.esporteIds) && payload.esporteIds.length > 0) {
    return payload.esporteIds;
  }

  if (Array.isArray(payload?.esportes) && payload.esportes.length > 0) {
    return payload.esportes;
  }

  if (payload?.esporte !== undefined && payload.esporte !== null && payload.esporte !== '') {
    return [payload.esporte];
  }

  return [];
}

async function resolverEsporteIds(tx, payload) {
  const valores = extrairValoresEsporte(payload);

  if (valores.length === 0) {
    throw new Error('Selecione ao menos um esporte');
  }

  const idsNumericos = [];
  const nomes = [];

  valores.forEach((valor) => {
    if (typeof valor === 'number' || /^\d+$/.test(String(valor))) {
      idsNumericos.push(Number(valor));
      return;
    }

    if (typeof valor === 'object' && valor !== null) {
      if (valor.id !== undefined && valor.id !== null && valor.id !== '') {
        idsNumericos.push(Number(valor.id));
        return;
      }

      if (valor.nome) {
        nomes.push(String(valor.nome).trim());
      }
      return;
    }

    nomes.push(String(valor).trim());
  });

  const encontrados = [];

  if (idsNumericos.length > 0) {
    const porId = await tx.esporte.findMany({
      where: { id: { in: idsNumericos } },
      select: { id: true, nome: true },
    });
    encontrados.push(...porId);
  }

  if (nomes.length > 0) {
    const porNome = await tx.esporte.findMany({
      where: { nome: { in: nomes } },
      select: { id: true, nome: true },
    });
    encontrados.push(...porNome);
  }

  const idsUnicos = Array.from(new Set(encontrados.map((esporte) => esporte.id)));
  const encontradosPorNome = new Set(encontrados.map((esporte) => esporte.nome));

  const faltandoIds = idsNumericos.filter((id) => !idsUnicos.includes(id));
  const faltandoNomes = nomes.filter((nome) => !encontradosPorNome.has(nome));

  if (faltandoIds.length > 0 || faltandoNomes.length > 0) {
    throw new Error('Um ou mais esportes informados não foram encontrados');
  }

  return idsUnicos;
}

module.exports = {
  normalizarQuadra,
  resolverEsporteIds,
};