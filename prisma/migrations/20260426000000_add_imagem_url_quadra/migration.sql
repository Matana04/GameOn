-- AlterTable
ALTER TABLE `Quadra`
    ADD COLUMN `imagemBlob` LONGBLOB NULL,
    ADD COLUMN `imagemMimeType` VARCHAR(100) NULL;
