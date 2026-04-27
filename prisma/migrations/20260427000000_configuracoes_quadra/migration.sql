-- AlterTable: adicionar configurações de cancelamento e aprovação na Quadra
ALTER TABLE `Quadra`
  ADD COLUMN `horasAntecedenciaCancelamento` INT NOT NULL DEFAULT 6,
  ADD COLUMN `requerAprovacao` TINYINT(1) NOT NULL DEFAULT 1;
