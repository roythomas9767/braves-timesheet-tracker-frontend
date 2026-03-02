import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimesheetService, MonthlyTimesheet, TimesheetEntry } from '../../../core/services/timesheet';
import { DateTime } from 'luxon';

@Component({
  selector: 'app-excel-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './excel-viewer.html',
  styleUrl: './excel-viewer.scss',
})
export class ExcelViewerComponent implements OnInit {
  currentTimesheet: MonthlyTimesheet | null = null;
  isDragOver = false;
  isEditable = false;
  saveStatus: 'idle' | 'saving' | 'saved' = 'idle';
  private saveStatusTimer: any = null;

  remarkOptions = [
    'Worked On CV-',
    'Earned Leave',
    'Casual + Sick Leave',
    'Compensatory Off',
    'Special Leave',
    'Optional Holidays'
  ];

  constructor(private timesheetService: TimesheetService) { }

  ngOnInit() {
    this.timesheetService.selectedMonth$.subscribe(ts => {
      this.currentTimesheet = ts;
      if (ts) {
        this.isEditable = !ts.isSubmitted;
      }
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;

    if (event.dataTransfer?.files.length) {
      const file = event.dataTransfer.files[0];
      if (file.name.endsWith('.xlsx')) {
        const entries = await this.timesheetService.parseExcelFile(file);

        const now = DateTime.now();
        this.timesheetService.addMonthlyTimesheet(now.toFormat('MMMM'), now.year, entries);
      }
    }
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const entries = await this.timesheetService.parseExcelFile(file);
      const now = DateTime.now();
      this.timesheetService.addMonthlyTimesheet(now.toFormat('MMMM'), now.year, entries);
    }
  }

  onEdit() {
    this.saveStatus = 'saving';
    this.timesheetService.saveCurrentTimesheet();
    // Show 'Saved' confirmation ~1s after the debounce fires (800ms + buffer)
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
    this.saveStatusTimer = setTimeout(() => {
      this.saveStatus = 'saved';
      setTimeout(() => this.saveStatus = 'idle', 2000);
    }, 1200);
  }

  exportExcel(): void {
    this.timesheetService.exportToExcel();
  }

  getRowClass(entry: TimesheetEntry) {
    const r = (entry.remark || '').toLowerCase();
    if (entry.day === 'Saturday' || entry.day === 'Sunday') return 'weekend';
    if (r.includes('leave') || r.includes('holiday')) return 'leave-row';
    if (r.includes('off')) return 'off-row';
    return '';
  }
}
