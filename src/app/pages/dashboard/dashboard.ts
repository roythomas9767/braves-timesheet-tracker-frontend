import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar';
import { ExcelViewerComponent } from '../../shared/components/excel-viewer/excel-viewer';
import { AutomationPanelComponent } from '../../shared/components/automation-panel/automation-panel';
import { EmailGeneratorComponent } from '../../shared/components/email-generator/email-generator';
import { ThemeService } from '../../core/services/theme.service';
import { TimesheetService } from '../../core/services/timesheet';
import { DateTime } from 'luxon';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    SidebarComponent,
    ExcelViewerComponent,
    AutomationPanelComponent,
    EmailGeneratorComponent
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit {
  now = new Date();
  stats = { totalHours: 0, totalHoursToSubmit: 0, totalLeaves: 0 };

  constructor(
    public themeService: ThemeService,
    private timesheetService: TimesheetService
  ) { }

  async ngOnInit() {
    this.timesheetService.selectedMonth$.subscribe(ts => {
      if (ts) {
        this.updateStats();
      }
    });

    // Sidebar handles initial auto-selection of the active month.
    // Dashboard just ensures stats are ready.
  }

  async updateStats() {
    this.stats = await this.timesheetService.getStats();
  }

  toggleTheme() {
    this.themeService.toggleTheme();
  }
}
