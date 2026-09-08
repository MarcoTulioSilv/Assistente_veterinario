import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_IMAGE_EXTENSIONS, UPLOAD_MAX_FILE_SIZE_BYTES } from '@vetequine/shared-types';
import { AppError } from '@vetequine/shared-middlewares';
import { LocalStorageAdapter } from '../adapters/local-storage-adapter';
import { sniffImageMimeType } from '../lib/image-sniff';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Rota protegida (montada depois de authMiddleware em app.ts) — mas os
 * arquivos ficam servidos estaticamente em /uploads ANTES do authMiddleware
 * (ver app.ts), sem autenticação: uma <img src> não consegue mandar
 * Authorization, mesmo padrão de qualquer object storage público.
 */
export const uploadRouter = Router();

const storage = new LocalStorageAdapter();

const ALLOWED_MIME_TYPES = new Set(Object.keys(UPLOAD_IMAGE_EXTENSIONS));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Só um fast-fail de UX (rejeita cedo, antes de ler o corpo inteiro).
    // Content-Type do multipart é declarado pelo cliente -- não prova nada
    // sozinho. A validação que importa de verdade é sniffImageMimeType()
    // abaixo, nos bytes reais, depois que o arquivo já está em memória.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

uploadRouter.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        AppError.validation('Falha no upload', [
          { field: 'file', message: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 5MB' : err.message },
        ]),
      );
      return;
    }
    if (err instanceof Error && err.message === 'INVALID_FILE_TYPE') {
      next(
        AppError.validation('Falha no upload', [
          { field: 'file', message: 'Tipo de arquivo não suportado — envie JPEG, PNG ou WebP' },
        ]),
      );
      return;
    }
    if (err) {
      next(err);
      return;
    }

    if (!req.file) {
      next(AppError.validation('Falha no upload', [{ field: 'file', message: 'Nenhum arquivo enviado' }]));
      return;
    }

    // Fonte de verdade: os bytes, não o Content-Type que o cliente mandou
    // (renomear um arquivo qualquer pra .png com o Content-Type certo
    // passaria direto pelo fileFilter acima). Usa o tipo sniffado daqui
    // pra frente, inclusive na extensão salva em disco.
    const sniffedMimeType = sniffImageMimeType(req.file.buffer);
    if (!sniffedMimeType || !ALLOWED_MIME_TYPES.has(sniffedMimeType)) {
      next(
        AppError.validation('Falha no upload', [
          { field: 'file', message: 'O conteúdo do arquivo não é uma imagem JPEG, PNG ou WebP válida' },
        ]),
      );
      return;
    }

    // 'general' por ora — sem sub-recurso específico (animal ainda nem
    // existe no momento do upload, no fluxo de cadastro). Pode virar
    // parâmetro (?folder=animals) se surgir necessidade de organizar mais.
    storage
      .upload(req.ctx.tenantId, 'general', {
        buffer: req.file.buffer,
        mimeType: sniffedMimeType,
        originalName: req.file.originalname,
      })
      .then((url) => res.status(201).json({ url }))
      .catch(next);
  });
});
