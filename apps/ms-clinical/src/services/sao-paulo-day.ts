const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Que dia é" para os lembretes do MS3 (exame, re-vacinação). O dia que
 * conta é o do veterinário, em America/Sao_Paulo — não o do servidor, que
 * roda em UTC: às 22h de São Paulo já é o dia seguinte em UTC.
 */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
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
