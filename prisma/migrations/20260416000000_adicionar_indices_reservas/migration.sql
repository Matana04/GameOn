-- CreateTable Reserva (update)
-- Adiciona índices para melhorar performance de consultas de conflitos

CREATE INDEX idx_reserva_quadra_status ON Reserva(quadraId, status);
CREATE INDEX idx_reserva_locatario ON Reserva(locatarioId);
CREATE INDEX idx_reserva_datas ON Reserva(dataInicio, dataFim);
CREATE INDEX idx_reserva_status ON Reserva(status);
