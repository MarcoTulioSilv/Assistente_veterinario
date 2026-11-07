import bcrypt from 'bcryptjs';

/**
 * Hash/compare de senha centralizados — usado por AuthService (login,
 * hash do segredo do refresh token) e TenantService (senha do admin
 * no cadastro). Evita duas cópias divergentes da política de rounds.
 */
export function bcryptRounds(): number {
  return parseInt(process.env['BCRYPT_ROUNDS'] ?? '12', 10);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptRounds());
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash bcrypt de uma senha fixa e inexistente, gerado uma única vez.
 * Usado como alvo de comparação quando o e-mail não existe, para que
 * AuthService.login gaste tempo parecido tanto em "senha errada" quanto
 * em "e-mail não existe" — evita enumerar contas por timing.
 */
export const DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy-password-timing-safety', bcryptRounds());
