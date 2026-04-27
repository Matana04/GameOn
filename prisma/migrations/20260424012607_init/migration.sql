/*
  Warnings:

  - The values [AGUARDANDO_APORVACAO] on the enum `Reserva_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- DropForeignKey
ALTER TABLE `Reserva` DROP FOREIGN KEY `Reserva_quadraId_fkey`;

-- DropIndex
DROP INDEX `idx_reserva_datas` ON `Reserva`;

-- DropIndex
DROP INDEX `idx_reserva_quadra_status` ON `Reserva`;

-- DropIndex
DROP INDEX `idx_reserva_status` ON `Reserva`;

-- AlterTable
ALTER TABLE `Quadra` ADD COLUMN `cep` VARCHAR(191) NULL,
    ADD COLUMN `cidade` VARCHAR(191) NULL,
    ADD COLUMN `endereco` VARCHAR(191) NULL,
    ADD COLUMN `estado` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Reserva` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `dataOferta` DATETIME(3) NULL,
    ADD COLUMN `posicaoFila` INTEGER NULL,
    MODIFY `status` ENUM('PENDENTE', 'AGUARDANDO_APROVACAO', 'CANCELADO', 'RESERVADO', 'EM_FILA', 'OFERECIDO_LOCATARIO') NOT NULL DEFAULT 'PENDENTE';

-- AddForeignKey
ALTER TABLE `Reserva` ADD CONSTRAINT `Reserva_quadraId_fkey` FOREIGN KEY (`quadraId`) REFERENCES `Quadra`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
