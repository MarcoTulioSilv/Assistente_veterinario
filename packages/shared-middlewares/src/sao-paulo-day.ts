const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = 'America/Sao_Paulo';

/**
 * "Que dia é" para lembretes e agenda. O dia que conta é o do veterinário,
 * em America/Sao_Paulo — não o do servidor, que roda em UTC: às 22h de São
 * Paulo já é o dia seguinte em UTC.
 *
 * Mora aqui (e não em um serviço) porque MS3 e MS4 fazem a mesma conta.
 */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

/** 'AAAA-MM-DD' no fuso de São Paulo. */
export function saoPauloDay(date: Date): string {
  return dayFormatter.format(date);
}

/** Soma dias a um 'AAAA-MM-DD', respeitando virada de mês e ano. */
export function addDays(day: string, days: number): string {
  // Meio-dia UTC fica no mesmo dia civil em qualquer fuso do Brasil.
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Deslocamento de São Paulo em relação a UTC, em minutos (−180 = UTC−3). */
function offsetMinutes(at: Date): number {
  const name = offsetFormatter.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0; // 'GMT' puro: sem deslocamento
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** Instante em que o dia 'AAAA-MM-DD' começa em São Paulo. */
function startOfSaoPauloDay(day: string): Date {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  // O deslocamento é lido no próprio dia, e não fixado em −3h: o Brasil
  // não tem horário de verão desde 2019, mas a regra pode voltar.
  const offset = offsetMinutes(new Date(midnightUtc + 12 * 60 * 60 * 1000));
  return new Date(midnightUtc - offset * 60 * 1000);
}

/**
 * Intervalo [from, to) do dia 'AAAA-MM-DD' de São Paulo, em instantes UTC —
 * o que a consulta de "eventos de hoje" (RN-011) precisa para filtrar uma
 * coluna TIMESTAMPTZ.
 */
export function saoPauloDayRange(day: string): { from: Date; to: Date } {
  return { from: startOfSaoPauloDay(day), to: startOfSaoPauloDay(addDays(day, 1)) };
}
