import { describe, it, expect } from 'vitest';
import { parseCpfCnpj } from './document';

describe('parseCpfCnpj', () => {
  describe('CPF', () => {
    it('aceita com e sem máscara e devolve o formato canônico', () => {
      expect(parseCpfCnpj('529.982.247-25')).toEqual({ kind: 'cpf', formatted: '529.982.247-25' });
      expect(parseCpfCnpj('52998224725')).toEqual({ kind: 'cpf', formatted: '529.982.247-25' });
      expect(parseCpfCnpj(' 529 982 247 25 ')).toEqual({ kind: 'cpf', formatted: '529.982.247-25' });
    });

    it('recusa dígito verificador errado', () => {
      expect(parseCpfCnpj('529.982.247-24')).toBeNull();
      expect(parseCpfCnpj('123.456.789-00')).toBeNull();
    });

    it('recusa sequência repetida, que passa no cálculo mas não existe', () => {
      expect(parseCpfCnpj('111.111.111-11')).toBeNull();
      expect(parseCpfCnpj('000.000.000-00')).toBeNull();
    });

    it('recusa CPF com letra', () => {
      expect(parseCpfCnpj('529.982.24A-25')).toBeNull();
    });
  });

  describe('CNPJ numérico', () => {
    it('aceita com e sem máscara e devolve o formato canônico', () => {
      expect(parseCpfCnpj('11.222.333/0001-81')).toEqual({ kind: 'cnpj', formatted: '11.222.333/0001-81' });
      expect(parseCpfCnpj('11222333000181')).toEqual({ kind: 'cnpj', formatted: '11.222.333/0001-81' });
    });

    it('recusa dígito verificador errado e sequência repetida', () => {
      expect(parseCpfCnpj('11.222.333/0001-82')).toBeNull();
      expect(parseCpfCnpj('00.000.000/0000-00')).toBeNull();
    });
  });

  describe('CNPJ alfanumérico (Receita, jul/2026)', () => {
    it('aceita o exemplo oficial da Receita', () => {
      expect(parseCpfCnpj('12.ABC.345/01DE-35')).toEqual({ kind: 'cnpj', formatted: '12.ABC.345/01DE-35' });
    });

    it('normaliza letras minúsculas e a falta de máscara', () => {
      expect(parseCpfCnpj('12abc34501de35')).toEqual({ kind: 'cnpj', formatted: '12.ABC.345/01DE-35' });
    });

    it('recusa dígito verificador errado', () => {
      expect(parseCpfCnpj('12.ABC.345/01DE-36')).toBeNull();
    });

    it('recusa letra nos dígitos verificadores', () => {
      expect(parseCpfCnpj('12.ABC.345/01DE-3A')).toBeNull();
    });
  });

  it('recusa tamanho que não é de CPF nem de CNPJ', () => {
    expect(parseCpfCnpj('')).toBeNull();
    expect(parseCpfCnpj('1234567890')).toBeNull();
    expect(parseCpfCnpj('123456789012345')).toBeNull();
  });
});
