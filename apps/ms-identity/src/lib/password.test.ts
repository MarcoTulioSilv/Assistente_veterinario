import bcrypt from 'bcryptjs';
import { CURRENT_SCRYPT, dummyPasswordHash, hashPassword, verifyPassword } from './password';

describe('password (scrypt, auditoria M-04)', () => {
  it('gera hash autodescrito com os parâmetros atuais e sal aleatório', async () => {
    const a = await hashPassword('segredo');
    const b = await hashPassword('segredo');
    expect(a).toMatch(new RegExp(`^scrypt\\$${CURRENT_SCRYPT.N}\\$${CURRENT_SCRYPT.r}\\$${CURRENT_SCRYPT.p}\\$`));
    expect(a).not.toBe(b);
  });

  it('confere a senha certa sem pedir re-hash e recusa a errada', async () => {
    const hash = await hashPassword('segredo');
    await expect(verifyPassword('segredo', hash)).resolves.toEqual({ ok: true, needsRehash: false });
    await expect(verifyPassword('outro', hash)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it('hash scrypt com parâmetros antigos: confere e pede re-hash', async () => {
    const hash = await hashPassword('segredo', { N: 2 ** 10, r: 8, p: 1 });
    await expect(verifyPassword('segredo', hash)).resolves.toEqual({ ok: true, needsRehash: true });
  });

  it('bcrypt legado: confere e pede re-hash só se a senha estiver certa', async () => {
    const hash = bcrypt.hashSync('segredo', 4);
    await expect(verifyPassword('segredo', hash)).resolves.toEqual({ ok: true, needsRehash: true });
    await expect(verifyPassword('outro', hash)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it('hash malformado ou com parâmetros absurdos é recusado sem calcular nada', async () => {
    const valid = await hashPassword('segredo');
    const [, , , , salt, key] = valid.split('$');
    for (const bad of [
      '',
      'texto-qualquer',
      `scrypt$${2 ** 24}$8$1$${salt}$${key}`, // pediria gigabytes
      `scrypt$1000$8$1$${salt}$${key}`, // N não é potência de 2
      `scrypt$16384$64$1$${salt}$${key}`,
      `scrypt$16384$8$1$${salt}$curta`,
    ]) {
      await expect(verifyPassword('segredo', bad)).resolves.toEqual({ ok: false, needsRehash: false });
    }
  });

  it('o hash fictício (e-mail inexistente) é estável e não confere com nada óbvio', async () => {
    const a = await dummyPasswordHash();
    expect(a).toBe(await dummyPasswordHash());
    await expect(verifyPassword('', a)).resolves.toMatchObject({ ok: false });
  });
});
