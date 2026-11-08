import pino from 'pino';

/**
 * Erro registrado sem dado pessoal (auditoria 06/11/2026, M-05).
 *
 * A mensagem de um erro do Prisma (PrismaClientValidationError,
 * PrismaClientKnownRequestError...) traz a chamada inteira com os
 * argumentos — `data: { fullName: "...", cpf: "...", phone: "..." }` — e a
 * stack repete a mensagem na primeira linha. O `redact` do Pino não alcança
 * texto livre. Aqui, erro do Prisma (ou com um do Prisma na `cause`) vira só
 * tipo, código, os campos não pessoais do `meta` e as linhas `at ...` da
 * stack. Os demais erros seguem o serializador padrão do Pino.
 *
 * Ligado como serializador `err` do logger: vale para todo `log.x({ err })`.
 */

const SAFE_META_KEYS = ['target', 'modelName', 'field_name', 'constraint', 'column_name'] as const;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  meta?: unknown;
  stack?: unknown;
  cause?: unknown;
  clientVersion?: unknown;
}

function isPrismaError(err: ErrorLike): boolean {
  return (typeof err.name === 'string' && err.name.startsWith('PrismaClient')) || err.clientVersion !== undefined;
}

/** Algum erro da cadeia (`cause`) é do Prisma? Limita a profundidade contra ciclo. */
function involvesPrisma(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (isPrismaError(current as ErrorLike)) return true;
    current = (current as ErrorLike).cause;
  }
  return false;
}

function stackFramesOnly(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frames = stack.split('\n').filter((line) => line.trimStart().startsWith('at '));
  return frames.length > 0 ? frames.join('\n') : undefined;
}

function safeMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_META_KEYS) {
    const value = (meta as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function serializeError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  if (!involvesPrisma(err)) return pino.stdSerializers.err(err as Error);

  const e = err as ErrorLike;
  const cause = e.cause && typeof e.cause === 'object' ? (e.cause as ErrorLike) : undefined;
  const prisma = isPrismaError(e) ? e : (cause ?? e);
  return {
    type: typeof e.name === 'string' ? e.name : 'Error',
    ...(prisma !== e && typeof prisma.name === 'string' ? { causeType: prisma.name } : {}),
    ...(typeof prisma.code === 'string' ? { code: prisma.code } : {}),
    ...(safeMeta(prisma.meta) ? { meta: safeMeta(prisma.meta) } : {}),
    ...(stackFramesOnly(e.stack) ? { stack: stackFramesOnly(e.stack) } : {}),
    redacted: 'mensagem do Prisma omitida (pode conter dado pessoal)',
  };
}

/**
 * Texto curto de erro para guardar fora do log (ex.: coluna de último erro
 * do outbox): a mensagem, menos quando o erro envolve o Prisma.
 */
export function safeErrorMessage(err: unknown): string {
  if (involvesPrisma(err)) {
    const e = err as ErrorLike;
    const code = typeof e.code === 'string' ? ` ${e.code}` : '';
    return `${typeof e.name === 'string' ? e.name : 'Error'}${code} (mensagem omitida)`;
  }
  return err instanceof Error ? err.message : String(err);
}
