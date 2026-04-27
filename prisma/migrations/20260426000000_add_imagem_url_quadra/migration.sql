-- AlterTable
ALTER TABLE `quadra`
    ADD COLUMN `imagemBlob` LONGBLOB NULL,
    ADD COLUMN `imagemMimeType` VARCHAR(100) NULL;
