/**
 * Historical Date Manager
 *
 * Handles Indian Stock Market (NSE / BSE) calendar rules:
 * - Saturday & Sunday: Non-trading weekends
 * - Official Exchange Holidays: Fixed national days and festival dates
 * - Auto-resolution to nearest valid trading day
 * - Prevents fake data generation for non-trading days
 */

export interface TradingDayValidation {
  isValid: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  reason?: string;
  holidayName?: string;
  nearestValidDate?: string;
}

/**
 * Known NSE / Indian Market Holidays (YYYY-MM-DD)
 * Covers recurring national holidays and yearly calendar gazetted dates.
 */
export const NSE_MARKET_HOLIDAYS: Record<string, string> = {
  // Fixed Annual National Holidays
  '01-26': 'Republic Day',
  '05-01': 'Maharashtra Day',
  '08-15': 'Independence Day',
  '10-02': 'Mahatma Gandhi Jayanti',
  '12-25': 'Christmas',

  // 2024 Holidays
  '2024-01-22': 'Special Holiday (Ayodhya Pran Pratishtha)',
  '2024-01-26': 'Republic Day',
  '2024-03-08': 'Mahashivratri',
  '2024-03-25': 'Holi',
  '2024-03-29': 'Good Friday',
  '2024-04-11': 'Id-Ul-Fitr (Ramzan Id)',
  '2024-04-17': 'Ram Navami',
  '2024-05-01': 'Maharashtra Day',
  '2024-05-20': 'General Elections (Mumbai)',
  '2024-06-17': 'Bakri Id / Eid ul-Adha',
  '2024-07-17': 'Muharram',
  '2024-08-15': 'Independence Day',
  '2024-10-02': 'Mahatma Gandhi Jayanti',
  '2024-11-01': 'Diwali Laxmi Pujan',
  '2024-11-15': 'Guru Nanak Jayanti',
  '2024-11-20': 'Maharashtra Assembly Elections',
  '2024-12-25': 'Christmas',

  // 2025 Holidays
  '2025-01-26': 'Republic Day (Sunday)',
  '2025-02-26': 'Mahashivratri',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-Ul-Fitr',
  '2025-04-10': 'Mahavir Jayanti',
  '2025-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Maharashtra Day',
  '2025-06-07': 'Bakri Id (Saturday)',
  '2025-07-06': 'Muharram (Sunday)',
  '2025-08-15': 'Independence Day',
  '2025-08-27': 'Ganesh Chaturthi',
  '2025-10-02': 'Mahatma Gandhi Jayanti / Dussehra',
  '2025-10-21': 'Diwali Laxmi Pujan',
  '2025-10-22': 'Diwali Balipratipada',
  '2025-11-05': 'Guru Nanak Jayanti',
  '2025-12-25': 'Christmas',

  // 2026 Holidays
  '2026-01-26': 'Republic Day',
  '2026-02-17': 'Mahashivratri',
  '2026-03-04': 'Holi',
  '2026-03-20': 'Id-Ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-27': 'Bakri Id',
  '2026-06-25': 'Muharram',
  '2026-08-15': 'Independence Day (Saturday)',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-09': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
};

/**
 * Format a Date or date string to 'YYYY-MM-DD'.
 */
export function toISODateString(dateInput: Date | string): string {
  if (!dateInput) return '';
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Handle "DD-MM-YYYY"
  const dmy = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }

  // Handle "DD-MMM-YYYY" (e.g. 15-Sep-2025)
  const dmyNamed = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmyNamed) {
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const m = monthMap[dmyNamed[2].toLowerCase()];
    if (m) {
      return `${dmyNamed[3]}-${m}-${String(dmyNamed[1]).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

/**
 * Parse an ISO date string to Date object in local timezone.
 */
export function parseISODate(isoStr: string): Date {
  const [y, m, d] = isoStr.split('-').map((v) => parseInt(v, 10));
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Check if a date falls on a weekend (Saturday = 6, Sunday = 0).
 */
export function isWeekend(dateInput: Date | string): boolean {
  const iso = toISODateString(dateInput);
  if (!iso) return false;
  const d = parseISODate(iso);
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a recognized NSE / Indian Market Holiday.
 */
export function isMarketHoliday(dateInput: Date | string): { isHoliday: boolean; holidayName?: string } {
  const iso = toISODateString(dateInput);
  if (!iso) return { isHoliday: false };

  // Check exact full date (e.g. "2025-08-15")
  if (NSE_MARKET_HOLIDAYS[iso]) {
    return { isHoliday: true, holidayName: NSE_MARKET_HOLIDAYS[iso] };
  }

  // Check annual recurring month-day (e.g. "08-15")
  const mmdd = iso.slice(5);
  if (NSE_MARKET_HOLIDAYS[mmdd]) {
    return { isHoliday: true, holidayName: NSE_MARKET_HOLIDAYS[mmdd] };
  }

  return { isHoliday: false };
}

/**
 * Determine if a date is a valid Indian market trading session.
 */
export function validateTradingDay(dateInput: Date | string): TradingDayValidation {
  const iso = toISODateString(dateInput);
  if (!iso) {
    return {
      isValid: false,
      isWeekend: false,
      isHoliday: false,
      reason: 'Invalid date provided',
    };
  }

  const weekend = isWeekend(iso);
  if (weekend) {
    const d = parseISODate(iso);
    const dayName = d.getDay() === 0 ? 'Sunday' : 'Saturday';
    const nearest = getNearestValidTradingDate(iso, 'backward');
    return {
      isValid: false,
      isWeekend: true,
      isHoliday: false,
      reason: `${iso} is a ${dayName} (Weekend - Market Closed)`,
      nearestValidDate: nearest,
    };
  }

  const holiday = isMarketHoliday(iso);
  if (holiday.isHoliday) {
    const nearest = getNearestValidTradingDate(iso, 'backward');
    return {
      isValid: false,
      isWeekend: false,
      isHoliday: true,
      holidayName: holiday.holidayName,
      reason: `${iso} is an NSE Market Holiday: ${holiday.holidayName}`,
      nearestValidDate: nearest,
    };
  }

  return {
    isValid: true,
    isWeekend: false,
    isHoliday: false,
  };
}

/**
 * Find the nearest valid trading date (skipping weekends and market holidays).
 * Default direction: 'backward' (past trading day).
 */
export function getNearestValidTradingDate(
  dateInput: Date | string,
  direction: 'backward' | 'forward' = 'backward'
): string {
  const iso = toISODateString(dateInput);
  if (!iso) return '';

  const step = direction === 'forward' ? 1 : -1;
  const current = parseISODate(iso);

  // If already valid and not forcing a shift, check it
  const initial = validateTradingDay(current);
  if (initial.isValid) {
    return iso;
  }

  // Step day by day up to 14 days to find the nearest valid trading day
  for (let i = 1; i <= 14; i++) {
    current.setDate(current.getDate() + step);
    const checkISO = toISODateString(current);
    const check = validateTradingDay(checkISO);
    if (check.isValid) {
      return checkISO;
    }
  }

  return iso;
}

/**
 * Format ISO date "2025-09-15" to readable display format "15 Sep 2025".
 */
export function formatDisplayDate(dateInput: Date | string): string {
  const iso = toISODateString(dateInput);
  if (!iso) return '';
  const d = parseISODate(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
