-- CreateTable
CREATE TABLE `BloqueioLocatario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `locadorId` INTEGER NOT NULL,
    `locatarioId` INTEGER NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BloqueioLocatario_locadorId_locatarioId_key`(`locadorId`, `locatarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BloqueioQuadra` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quadraId` INTEGER NOT NULL,
    `dataInicio` DATETIME(6) NOT NULL,
    `dataFim` DATETIME(6) NOT NULL,
    `motivo` VARCHAR(200) NOT NULL,
    `descricao` TEXT NULL,
    `horaInicio` VARCHAR(191) NULL,
    `horaFim` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    INDEX `BloqueioQuadra_quadraId_idx`(`quadraId`),
    INDEX `BloqueioQuadra_dataInicio_idx`(`dataInicio`),
    INDEX `BloqueioQuadra_dataFim_idx`(`dataFim`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BloqueioLocatario` ADD CONSTRAINT `BloqueioLocatario_locadorId_fkey` FOREIGN KEY (`locadorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BloqueioLocatario` ADD CONSTRAINT `BloqueioLocatario_locatarioId_fkey` FOREIGN KEY (`locatarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BloqueioQuadra` ADD CONSTRAINT `BloqueioQuadra_quadraId_fkey` FOREIGN KEY (`quadraId`) REFERENCES `Quadra`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
