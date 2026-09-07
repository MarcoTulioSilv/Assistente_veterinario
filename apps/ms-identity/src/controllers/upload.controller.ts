import { Router } from 'express';
import multer from 'multer';
import { AppError } from '@vetequine/shared-middlewares';
import { LocalStorageAdapter } from '../adapters/local-storage-adapter';

/**
 * Camada HTTP — Dev 2 é o dono.
 * Rota protegida (montada depois de authMiddleware em app.ts) — mas os
 * arquivos ficam servidos estaticamente em /uploads ANTES do authMiddleware
 * (ver app.ts), sem autenticação: uma <img src> não consegue mandar
 * Authorization, mesmo padrão de qualquer object storage público.
 */
export const uploadRouter = Router();

const storage = new LocalStorageAdapter();

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
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

    // 'general' por ora — sem sub-recurso específico (animal ainda nem
    // existe no momento do upload, no fluxo de cadastro). Pode virar
    // parâmetro (?folder=animals) se surgir necessidade de organizar mais.
    storage
      .upload(req.ctx.tenantId, 'general', {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
      })
      .then((url) => res.status(201).json({ url }))
      .catch(next);
  });
});
