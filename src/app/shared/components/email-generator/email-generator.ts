import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimesheetService, MonthlyTimesheet } from '../../../core/services/timesheet';

@Component({
  selector: 'app-email-generator',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './email-generator.html',
  styleUrl: './email-generator.scss'
})
export class EmailGeneratorComponent implements OnInit {
  summary: any = null;
  emailBody: string = '';

  constructor(private timesheetService: TimesheetService) { }

  ngOnInit() {
    this.timesheetService.selectedMonth$.subscribe(ts => {
      if (ts) {
        this.generateSummary(ts);
      }
    });
  }

  generateSummary(ts: MonthlyTimesheet) {
    const totalDays = ts.entries.length;
    const workDays = ts.entries.filter(e => e.day !== 'Saturday' && e.day !== 'Sunday');
    const leaves = workDays.filter(e => this.timesheetService.isLeaveRemark(e.remark));

    // Categorize leaves
    const sickLeaves = leaves.filter(l => l.remark.toLowerCase().includes('sick') || l.remark.toLowerCase().includes('casual'));
    const optionalLeaves = leaves.filter(l => l.remark.toLowerCase().includes('festival') || l.remark.toLowerCase().includes('optional'));
    const earnedLeaves = leaves.filter(l => !sickLeaves.includes(l) && !optionalLeaves.includes(l));

    const formatDates = (items: any[]): string =>
      items.length ? items.map(l => l.date).join(', ') : 'None';

    this.summary = {
      month: ts.month,
      year: ts.year,
      totalWorkingDays: workDays.length,
      totalLeaves: leaves.length,
      optionalLeaves: optionalLeaves.length,
      casualSickLeaves: sickLeaves.length,
      earnedLeaves: earnedLeaves.length,
      actualWorkedDays: workDays.length - leaves.length,
      dates: {
        optional: formatDates(optionalLeaves),
        sick: formatDates(sickLeaves),
        earned: formatDates(earnedLeaves),
        all: formatDates(leaves)
      }
    };

    this.emailBody = `Hello Raj,\nPlease find the below summary details:\n\nTotal working days in ${ts.month} ${ts.year}: ${this.summary.totalWorkingDays},\nTotal number of Leaves taken: ${this.summary.totalLeaves} (${this.summary.dates.all}),\nOptional/Festival leaves taken with dates: ${this.summary.optionalLeaves} (${this.summary.dates.optional}),\nCasual/Sick Leave taken with dates: ${this.summary.casualSickLeaves} (${this.summary.dates.sick}),\nEarned leaves taken with dates: ${this.summary.earnedLeaves} (${this.summary.dates.earned}),\nTotal actual worked days: ${this.summary.actualWorkedDays}.\n\nThanks,\nSherin Roy.`;
  }

  copyToClipboard() {
    navigator.clipboard.writeText(this.emailBody);
    alert('Email content copied to clipboard!');
  }
}
