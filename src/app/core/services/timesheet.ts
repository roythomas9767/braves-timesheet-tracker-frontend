import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import * as XLSX from 'xlsx';
import { DateTime, Settings } from 'luxon';

// Force English locale for month parsing
Settings.defaultLocale = 'en';

export interface TimesheetEntry {
  day: string;
  date: string;
  timeIn: string;
  timeOut: string;
  hours: number;
  remark: string;
  portalRemark?: string;  // Description sent to the portal
  portalHours?: number;   // Hours sent to the portal (may differ from DB hours, e.g. leave = 8)
  tickets: Array<{ id: string; hrs: number }>;
}

export interface MonthlyTimesheet {
  month: string;
  year: number;
  entries: TimesheetEntry[];
  isSubmitted: boolean;
}

export interface SidebarMonthItem {
  month: string;       // e.g. "February"
  year: number;        // e.g. 2026
  /** 'active' = current real-world month, 'pending' = past + not submitted, 'submitted' */
  status: 'active' | 'pending' | 'submitted';
  submittedDate?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TimesheetService {
  private currentTimesheetSubject = new BehaviorSubject<MonthlyTimesheet | null>(null);
  selectedMonth$ = this.currentTimesheetSubject.asObservable();

  private saveTimer: any = null;
  private isSaving = false;
  private readonly apiUrl = 'http://localhost:3000/api';

  // Real current month/year (never changes at runtime)
  readonly currentMonthName: string = DateTime.now().toFormat('MMMM');
  readonly currentYear: number = DateTime.now().year;

  constructor() { }

  getCurrentValue(): MonthlyTimesheet | null {
    return this.currentTimesheetSubject.value;
  }

  /**
   * Loads all months to show in the sidebar.
   * Algorithm:
   *   1. Fetch metadata from API to get known months + statuses.
   *   2. Uses /api/timesheets/list to read ALL existing docs from MongoDB directly.
   *   3. Fills every month sequentially from the earliest DB entry up to the real current month.
   *   4. Auto-creates current month if missing, + any gap months (skipped months = pending).
   *   5. Label: current real month = 'active', submitted = 'submitted', everything else = 'pending'.
   */
  async getAllMonths(): Promise<SidebarMonthItem[]> {
    // ── 1. Read all timesheet documents from MongoDB via the list endpoint ───
    //    This is the source of truth — reads the timesheets collection directly,
    //    so months like February that exist in DB but not in metadata are found.
    let dbMonths: { key: string; month: string; year: number; status: string; lastModified: string | null }[] = [];
    try {
      const resp = await fetch(`${this.apiUrl}/timesheets/list`);
      if (resp.ok) dbMonths = await resp.json();
    } catch { /* API offline — gracefully degrade */ }

    // Build a fast lookup: "February_2026" → db entry
    const dbMap = new Map(dbMonths.map(m => [m.key, m]));

    // ── 2. Always ensure the current real-world month exists in the DB ───────
    const currentKey = `${this.currentMonthName}_${this.currentYear}`;
    if (!dbMap.has(currentKey)) {
      await this.ensureMonthExists(this.currentMonthName, this.currentYear);
      dbMap.set(currentKey, {
        key: currentKey, month: this.currentMonthName, year: this.currentYear,
        status: 'active', lastModified: null
      });
    }

    // ── 3. Find the earliest month across all known DB docs ──────────────────
    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    let earliestYear = this.currentYear;
    let earliestMonth: number = DateTime.now().month; // 1-based, typed as plain number

    for (const [, entry] of dbMap) {
      const mIdx = MONTH_NAMES.indexOf(entry.month); // 0-based
      if (mIdx === -1 || isNaN(entry.year)) continue;
      const entryMonthNum = mIdx + 1;
      if (entry.year < earliestYear ||
        (entry.year === earliestYear && entryMonthNum < earliestMonth)) {
        earliestYear = entry.year;
        earliestMonth = entryMonthNum;
      }
    }

    // ── 4. Walk every calendar month from earliest → current ─────────────────
    //    Missing months (skipped months) are auto-created and marked pending.
    const result: SidebarMonthItem[] = [];
    let cursor = DateTime.fromObject({ year: earliestYear, month: (earliestMonth as any), day: 1 });
    const endDt = DateTime.fromObject({ year: this.currentYear, month: (DateTime.now().month as any), day: 1 });

    while (cursor <= endDt) {
      const mName = cursor.toFormat('MMMM');
      const yr = cursor.year;
      const key = `${mName}_${yr}`;

      const isCurrentMonth = (mName === this.currentMonthName && yr === this.currentYear);
      const dbEntry = dbMap.get(key);

      // Auto-create any missing gap months in the background
      if (!dbEntry) {
        this.ensureMonthExists(mName, yr);
      }

      const isSubmitted = dbEntry?.status === 'submitted';

      let status: 'active' | 'pending' | 'submitted';
      if (isCurrentMonth) status = 'active';
      else if (isSubmitted) status = 'submitted';
      else status = 'pending';

      const item: SidebarMonthItem = { month: mName, year: yr, status };
      if (isSubmitted && dbEntry?.lastModified) {
        item.submittedDate = DateTime.fromISO(dbEntry.lastModified).toFormat('d MMM yyyy');
      }

      result.push(item);
      cursor = cursor.plus({ months: 1 });
    }

    // Newest first
    return result.reverse();
  }

  /**
   * Ensures a month document exists in MongoDB.
   * If not, generates a blank prefilled timesheet and saves it.
   */
  private async ensureMonthExists(month: string, year: number): Promise<void> {
    try {
      const resp = await fetch(`${this.apiUrl}/timesheet/${month}/${year}`);
      const data = resp.ok ? await resp.json() : null;
      if (!data || this.isDataCorrupt(data)) {
        const fresh = this.generatePrefilledMonth(month, year);
        await fetch(`${this.apiUrl}/timesheet/${month}/${year}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fresh)
        });
      }
    } catch { /* ignore */ }
  }

  async selectTimesheet(month: string, year: number) {
    console.log(`Selecting timesheet for ${month} ${year}`);
    try {
      const resp = await fetch(`${this.apiUrl}/timesheet/${month}/${year}`);
      let data = resp.ok ? await resp.json() : null;

      if (!data || this.isDataCorrupt(data)) {
        console.log(`Data for ${month} ${year} is missing or corrupt. Generating...`);
        data = this.generatePrefilledMonth(month, year);

        // Check metadata for status
        const metaResp = await fetch(`${this.apiUrl}/metadata`);
        const meta = metaResp.ok ? await metaResp.json() : { months: {} };
        const key = `${month}_${year}`;
        if (meta.months && meta.months[key]?.status === 'submitted') {
          data.isSubmitted = true;
        }

        this.currentTimesheetSubject.next(data);
        fetch(`${this.apiUrl}/timesheet/${month}/${year}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }).catch(err => console.error('Failed to save timesheet:', err));

      } else {
        console.log(`Loaded existing data for ${month} ${year}`);
        this.currentTimesheetSubject.next(data);
      }
    } catch (err) {
      console.error('API error in selectTimesheet:', err);
      this.currentTimesheetSubject.next(this.generatePrefilledMonth(month, year));
    }
  }

  private isDataCorrupt(ts: MonthlyTimesheet): boolean {
    if (!ts.entries || ts.entries.length === 0) return true;
    return ts.entries.some(e => e.day.length > 20 || e.day.includes(':'));
  }

  private generatePrefilledMonth(monthName: string, year: number): MonthlyTimesheet {
    const dtBase = DateTime.fromFormat(`${monthName} ${year}`, 'MMMM yyyy', { locale: 'en' });
    if (!dtBase.isValid) {
      console.error('CRITICAL: Invalid month/year for prefill. Month:', monthName, 'Year:', year);
      return { month: monthName, year, entries: [], isSubmitted: false };
    }

    const monthNum = dtBase.month;
    const daysInMonth = dtBase.daysInMonth || 30;
    const entries: TimesheetEntry[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = DateTime.fromObject({ year, month: monthNum, day: d }, { locale: 'en' });
      const isWeekend = dt.weekday === 6 || dt.weekday === 7;

      entries.push({
        day: dt.toFormat('EEEE'),
        date: dt.toFormat('d MMM yy'),
        timeIn: isWeekend ? '-' : '1:00 PM',
        timeOut: isWeekend ? '-' : '9:00 PM',
        hours: isWeekend ? 0 : 8,
        remark: isWeekend ? 'Weekoff' : '',
        tickets: []
      });
    }

    return { month: monthName, year: year, entries, isSubmitted: false };
  }

  saveCurrentTimesheet() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.flushSave(), 800);
  }

  private async flushSave() {
    if (this.isSaving) return;
    const ts = this.currentTimesheetSubject.value;
    if (!ts) return;

    this.isSaving = true;
    try {
      this.processPortalRemarks(ts);
      const resp = await fetch(`${this.apiUrl}/timesheet/${ts.month}/${ts.year}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ts)
      });
      console.log(`[AutoSave] ${ts.month} ${ts.year} →`, resp.ok ? 'OK' : 'FAILED');
      this.currentTimesheetSubject.next({ ...ts });
    } catch (err) {
      console.error('[AutoSave] Error saving timesheet:', err);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Returns a deep copy of the given timesheet with portalRemark and portalHours
   * recomputed fresh for every entry.
   *
   * portalHours rules (automation-only, NEVER saved back to DB/UI):
   *   Leave  → 8  (portal needs a full-day entry even for leave)
   *   Others → e.hours (as-is)
   *
   * Also computes (copy as any).totalPortalHours for the backend verification step.
   */
  public buildCopyWithPortalRemarks(ts: MonthlyTimesheet): MonthlyTimesheet {
    const copy: MonthlyTimesheet = JSON.parse(JSON.stringify(ts));
    this.processPortalRemarks(copy);

    // Set portalHours for every entry
    let total = 0;
    copy.entries.forEach(e => {
      const isLeave = this.isLeaveRemark(e.remark || '');
      e.portalHours = isLeave ? 8 : (e.hours ?? 0);
      total += e.portalHours;
    });

    // Attach total so the backend can verify against the portal's displayed hours
    (copy as any).totalPortalHours = total;

    return copy;
  }

  private processPortalRemarks(ts: MonthlyTimesheet) {
    let fallbackTicket = '';
    const allCVMatches = ts.entries
      .map(e => (e.remark || '').match(/CV-\d+/))
      .filter(m => m !== null);

    if (allCVMatches.length > 0) {
      fallbackTicket = allCVMatches[0]![0];
    } else {
      fallbackTicket = 'CV-2721';
    }

    let lastKnownTicket = fallbackTicket;

    ts.entries.forEach(e => {
      const rawRemark = (e.remark || '');
      const isLeave = this.isLeaveRemark(rawRemark);

      // Keep lastKnownTicket updated from regular (non-leave) entries that contain a CV ticket
      if (!isLeave) {
        const m = rawRemark.match(/CV-\d+/);
        if (m) lastKnownTicket = m[0];
      }

      if (isLeave) {
        // Leave day: portal needs a project entry — use last known ticket with prefix
        e.portalRemark = `Apurva Worked For Sherin on ${lastKnownTicket}`;
      } else {
        // Regular work day (weekoff, normal work, anything else):
        // Use the raw remark EXACTLY as-is — no prefix added.
        e.portalRemark = rawRemark;
      }
      // Hours are NEVER modified here.
    });
  }

  public isLeaveRemark(r: string): boolean {
    if (!r) return false;
    const lower = r.toLowerCase().trim();
    // Explicit week-off exclusion
    if (lower.includes('weekoff') || lower === 'week off') return false;
    // Match known leave keywords — parentheses ensure correct precedence
    return (
      lower.includes('earned leave') ||
      lower.includes('sick leave') ||
      lower.includes('casual leave') ||
      lower.includes('leave') ||
      lower.includes('holiday') ||
      // 'off' only as a standalone word (e.g. "Day Off") — not inside words like 'worked'
      /\boff\b/.test(lower) && !lower.includes('worked on')
    );
  }

  async markAsSubmitted(month: string, year: number) {
    console.log(`Marking ${month} ${year} as submitted`);
    try {
      const metaResp = await fetch(`${this.apiUrl}/metadata`);
      const meta = metaResp.ok ? await metaResp.json() : { months: {} };

      const key = `${month}_${year}`;
      if (!meta.months) meta.months = {};
      meta.months[key] = { ...meta.months[key], status: 'submitted', lastModified: new Date().toISOString() };

      await fetch(`${this.apiUrl}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta)
      });

      const current = this.currentTimesheetSubject.value;
      if (current && current.month === month && current.year === year) {
        current.isSubmitted = true;
        this.currentTimesheetSubject.next({ ...current });
      }

      this.selectNextMonth(month, year);
      return true;
    } catch (err) {
      console.error('Error marking as submitted:', err);
      return false;
    }
  }

  private selectNextMonth(month: string, year: number) {
    const dt = DateTime.fromFormat(`${month} ${year}`, 'MMMM yyyy', { locale: 'en' }).plus({ months: 1 });
    if (dt.isValid) {
      this.selectTimesheet(dt.toFormat('MMMM'), dt.year);
    }
  }

  /**
   * Exports the current timesheet to an XLSX file using the exact same column
   * layout that parseExcelFile() reads:
   *   Row 1-3  : header / metadata rows (skipped on import)
   *   Col A    : Day   (Monday, Tuesday …)
   *   Col B    : Date  (1 Feb 26 …)
   *   Col C    : Time In
   *   Col D    : Time Out
   *   Col E    : Hours (numeric)
   *   Col F    : Remark
   */
  exportToExcel(): void {
    const ts = this.currentTimesheetSubject.value;
    if (!ts) return;

    // ── Build rows ──────────────────────────────────────────────────────────
    // Row 1: Title row
    const titleRow = [`Timesheet - ${ts.month} ${ts.year}`, '', '', '', '', ''];
    // Row 2: Blank spacer
    const spacerRow = ['', '', '', '', '', ''];
    // Row 3: Column headers (mirrors the import reader expectations)
    const headerRow = ['Day', 'Date', 'Time In', 'Time Out', 'Total Worked hours from office', 'Remark'];

    // Data rows
    const dataRows = ts.entries.map(e => [
      e.day || '',
      e.date || '',
      e.timeIn || '',
      e.timeOut || '',
      e.hours ?? 0,
      e.remark || ''
    ]);

    const allRows = [titleRow, spacerRow, headerRow, ...dataRows];

    // ── Write workbook ───────────────────────────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // Column widths for readability
    ws['!cols'] = [
      { wch: 12 },  // A: Day
      { wch: 14 },  // B: Date
      { wch: 12 },  // C: Time In
      { wch: 12 },  // D: Time Out
      { wch: 10 },  // E: Hours
      { wch: 40 },  // F: Remark
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');

    const fileName = `Timesheet_${ts.month}_${ts.year}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }


  parseExcelFile(file: File): Promise<TimesheetEntry[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });
        const entriesMap = new Map<string, TimesheetEntry>();

        jsonData.forEach((row, index) => {
          if (index < 3) return;

          const dateValue = row['B'];
          if (!dateValue || dateValue === 'Date') return;

          const day = row['A'] || '';
          const rawDate = (dateValue instanceof Date)
            ? DateTime.fromJSDate(dateValue).toFormat('d MMM yy')
            : dateValue;

          const timeIn = '1:00 PM';
          const timeOut = '9:00 PM';
          const hours = parseFloat(row['E']) || 8;
          let remark = row['F'] || '';

          if (remark && !remark.toLowerCase().startsWith('worked on') && !remark.toLowerCase().includes('weekoff')) {
            remark = `Worked On ${remark}`;
          }

          if (entriesMap.has(rawDate)) {
            const existing = entriesMap.get(rawDate)!;
            existing.remark += ` , ${remark}`;
            existing.hours += hours;
          } else {
            entriesMap.set(rawDate, {
              day, date: rawDate, timeIn, timeOut, hours, remark, tickets: []
            });
          }
        });
        resolve(Array.from(entriesMap.values()));
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  }

  async getStats() {
    const ts = this.currentTimesheetSubject.value;
    if (!ts) return { totalHours: 0, totalHoursToSubmit: 0, totalLeaves: 0 };

    let totalHours = 0;
    let totalHoursToSubmit = 0;
    let totalLeaves = 0;

    ts.entries.forEach(e => {
      const h = (parseFloat(e.hours as any) || 0);
      totalHours += h;

      const r = (e.remark || '').toLowerCase();
      const isLeave = this.isLeaveRemark(r);
      const isWeekend = e.day === 'Saturday' || e.day === 'Sunday';

      if (isLeave) {
        totalLeaves++;
        totalHoursToSubmit += 8;
      } else if (!isWeekend) {
        totalHoursToSubmit += h;
      }
    });
    return { totalHours, totalHoursToSubmit, totalLeaves };
  }

  addMonthlyTimesheet(month: string, year: number, entries: TimesheetEntry[]) {
    const newTimesheet: MonthlyTimesheet = { month, year, entries, isSubmitted: false };
    this.processPortalRemarks(newTimesheet);
    this.currentTimesheetSubject.next(newTimesheet);
    this.saveCurrentTimesheet();
  }
}
