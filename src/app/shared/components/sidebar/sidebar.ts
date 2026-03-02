import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimesheetService, SidebarMonthItem } from '../../../core/services/timesheet';
import { DateTime } from 'luxon';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent implements OnInit {
  /** Months grouped by year, newest year first */
  groupedHistory: { year: number; months: SidebarMonthItem[] }[] = [];

  selectedMonth: string = '';
  selectedYear: number = 0;
  isLoading = true;

  constructor(
    private timesheetService: TimesheetService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) { }

  ngOnInit() {
    const now = DateTime.now();
    this.selectedMonth = now.toFormat('MMMM');
    this.selectedYear = now.year;

    // Listen for selection changes (submitted month etc.)
    this.timesheetService.selectedMonth$.subscribe(m => {
      if (m) {
        this.zone.run(() => {
          this.selectedMonth = m.month;
          this.selectedYear = m.year;
        });
      }
    });

    // Auto-select current month on startup
    this.timesheetService.selectTimesheet(this.selectedMonth, this.selectedYear);

    // Load full history — runs outside zone so we must re-enter for CD
    this.loadHistory();
  }

  loadHistory() {
    this.isLoading = true;
    this.cdr.markForCheck();

    this.timesheetService.getAllMonths()
      .then(allMonths => {
        // Re-enter Angular zone so change detection fires immediately
        this.zone.run(() => {
          this.groupedHistory = this.groupByYear(allMonths);
          this.isLoading = false;
          this.cdr.markForCheck();
        });
      })
      .catch(err => {
        console.error('[Sidebar] Failed to load history:', err);
        this.zone.run(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        });
      });
  }

  private groupByYear(items: SidebarMonthItem[]): { year: number; months: SidebarMonthItem[] }[] {
    const map = new Map<number, SidebarMonthItem[]>();
    for (const item of items) {
      if (!map.has(item.year)) map.set(item.year, []);
      map.get(item.year)!.push(item);
    }
    // Sort years descending (newest year at top)
    const years = Array.from(map.keys()).sort((a, b) => b - a);
    return years.map(year => ({ year, months: map.get(year)! }));
  }

  selectMonth(item: SidebarMonthItem) {
    this.timesheetService.selectTimesheet(item.month, item.year);
    // Reload history after selection to pick up any status changes
    this.loadHistory();
  }

  isSelected(item: SidebarMonthItem): boolean {
    return this.selectedMonth === item.month && this.selectedYear === item.year;
  }

  /** Short month label e.g. "Mar" */
  shortMonth(month: string): string {
    return month.substring(0, 3);
  }

  statusLabel(item: SidebarMonthItem): string {
    if (item.status === 'active') return 'Current Active Month';
    if (item.status === 'submitted') return 'Submitted';
    return 'Pending Submission';
  }

  statusClass(item: SidebarMonthItem): string {
    if (item.status === 'active') return 'badge-active';
    if (item.status === 'submitted') return 'badge-submitted';
    return 'badge-pending';
  }
}
