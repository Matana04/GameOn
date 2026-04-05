const swaggerJsdoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'GameOn API',
    version: '1.0.0',
    description: 'API para sistema de reserva de quadras esportivas GameOn',
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3000}`,
      description: 'Servidor de desenvolvimento',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Usuario: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'ID único do usuário',
          },
          nome: {
            type: 'string',
            description: 'Nome do usuário',
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'Email do usuário',
          },
          tipo: {
            type: 'string',
            enum: ['LOCADOR', 'LOCATARIO'],
            description: 'Tipo do usuário',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Data de criação do usuário',
          },
        },
      },
      Quadra: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'ID único da quadra',
          },
          nome: {
            type: 'string',
            description: 'Nome da quadra',
          },
          esporte: {
            type: 'string',
            description: 'Esporte praticado na quadra',
          },
          valorPorHora: {
            type: 'number',
            format: 'decimal',
            description: 'Valor por hora da quadra',
          },
          descricao: {
            type: 'string',
            description: 'Descrição da quadra',
          },
          locadorId: {
            type: 'integer',
            description: 'ID do locador proprietário',
          },
          horarios: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Horario'
            },
            description: 'Horários de funcionamento da quadra',
          },
        },
      },
      Horario: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'ID único do horário',
          },
          quadraId: {
            type: 'integer',
            description: 'ID da quadra',
          },
          diaSemana: {
            type: 'integer',
            minimum: 0,
            maximum: 6,
            description: 'Dia da semana (0=domingo, 6=sábado)',
          },
          horaAbertura: {
            type: 'string',
            description: 'Hora de abertura (HH:MM)',
          },
          horaFechamento: {
            type: 'string',
            description: 'Hora de fechamento (HH:MM)',
          },
        },
      },
      Reserva: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'ID único da reserva',
          },
          quadraId: {
            type: 'integer',
            description: 'ID da quadra reservada',
          },
          locatarioId: {
            type: 'integer',
            description: 'ID do locatário',
          },
          dataInicio: {
            type: 'string',
            format: 'date-time',
            description: 'Data e hora de início da reserva',
          },
          dataFim: {
            type: 'string',
            format: 'date-time',
            description: 'Data e hora de fim da reserva',
          },
          valorTotal: {
            type: 'number',
            format: 'decimal',
            description: 'Valor total da reserva',
          },
          status: {
            type: 'string',
            enum: ['PENDENTE', 'AGUARDANDO_APROVACAO', 'CANCELADO', 'RESERVADO'],
            description: 'Status da reserva',
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

const options = {
  definition: swaggerDefinition,
  apis: ['./src/routes/*.js'], // Caminhos para os arquivos com anotações Swagger
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;