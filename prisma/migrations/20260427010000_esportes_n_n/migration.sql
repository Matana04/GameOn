-- Criar tabela de esportes
CREATE TABLE `Esporte` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Esporte_nome_key` (`nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Criar tabela de relacionamento N-N entre quadras e esportes
CREATE TABLE `QuadraEsporte` (
  `quadraId` INT NOT NULL,
  `esporteId` INT NOT NULL,
  PRIMARY KEY (`quadraId`, `esporteId`),
  CONSTRAINT `QuadraEsporte_quadraId_fkey`
    FOREIGN KEY (`quadraId`) REFERENCES `Quadra` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `QuadraEsporte_esporteId_fkey`
    FOREIGN KEY (`esporteId`) REFERENCES `Esporte` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Popular catálogo inicial com os valores já existentes e opções padrão do app
INSERT IGNORE INTO `Esporte` (`nome`) VALUES
  ('Futebol'),
  ('Vôlei'),
  ('Basquete'),
  ('Futsal'),
  ('Tênis'),
  ('Beach Tênis'),
  ('Handebol'),
  ('Outros');

INSERT IGNORE INTO `Esporte` (`nome`)
SELECT DISTINCT `esporte`
FROM `Quadra`
WHERE `esporte` IS NOT NULL AND `esporte` <> '';

-- Migrar os esportes existentes das quadras para a tabela de relacionamento
INSERT IGNORE INTO `QuadraEsporte` (`quadraId`, `esporteId`)
SELECT q.`id`, e.`id`
FROM `Quadra` q
JOIN `Esporte` e ON e.`nome` = q.`esporte`;

-- Remover a coluna legada depois da migração dos dados
ALTER TABLE `Quadra` DROP COLUMN `esporte`;