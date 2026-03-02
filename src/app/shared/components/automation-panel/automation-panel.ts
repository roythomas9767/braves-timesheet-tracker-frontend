import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { TimesheetService } from '../../../core/services/timesheet';
import { AutomationLogService, LogEntry, AutomationStatus } from '../../../core/services/automation-log.service';

@Component({
  selector: 'app-automation-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './automation-panel.html',
  styleUrl: './automation-panel.scss'
})
export class AutomationPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('logContainer') private logContainer!: ElementRef<HTMLDivElement>;

  logs: LogEntry[] = [];
  status: AutomationStatus = 'idle';
  connected = false;
  isProcessing = false;

  private subs = new Subscription();
  private shouldScrollToBottom = false;

  constructor(
    private timesheetService: TimesheetService,
    public logService: AutomationLogService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.subs.add(
      this.logService.logs$.subscribe(logs => {
        this.logs = logs;
        this.shouldScrollToBottom = true;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.logService.status$.subscribe(status => {
        this.status = status;
        this.isProcessing = (status === 'running');
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.logService.connected$.subscribe(c => {
        this.connected = c;
        this.cdr.detectChanges();
      })
    );
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  private scrollToBottom(): void {
    try {
      const el = this.logContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } catch (_) { }
  }

  async startAutomation(): Promise<void> {
    const ts = this.timesheetService.getCurrentValue();
    if (!ts) {
      this.logService.addLog('No timesheet loaded. Please select a month first.', 'error');
      return;
    }

    this.isProcessing = true;
    this.logService.clearLogs();

    try {
      // Deep-copy the timesheet and recompute portalRemark fresh right now.
      // Do NOT rely on stale portalRemark values stored in MongoDB — they may
      // have been written by an older buggy version of processPortalRemarks.
      const tsCopy = this.timesheetService.buildCopyWithPortalRemarks(ts);

      const response = await fetch('http://localhost:3000/api/run-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tsCopy)
      });

      const data = await response.json();

      // Only mark as Submitted if automation ran to completion with ZERO errors and was NOT aborted.
      // data.success = true only when aborted = false (set by backend).
      // We double-check data.aborted explicitly as a belt-and-suspenders guard.
      const fullySucceeded = data.success === true && data.aborted !== true && data.errorCount === 0;

      if (fullySucceeded) {
        // Full success — mark month as Submitted in DB and move to next month
        const ok = await this.timesheetService.markAsSubmitted(ts.month, ts.year);
        if (ok) {
          setTimeout(() => {
            alert(`✅ Timesheet for ${ts.month} ${ts.year} submitted successfully!\n${data.successCount} entries saved.`);
          }, 500);
        }
      } else if (data.aborted) {
        // Automation was aborted mid-way — do NOT mark as submitted
        const saved = data.successCount ?? 0;
        const failed = data.errorCount ?? 0;
        alert(`🛑 Automation stopped after an error.\n${saved} rows saved, ${failed} failed.\nTimesheet status remains Pending — fix the issue and re-run.`);
      } else if (!response.ok || data.error) {
        alert(`❌ Automation Failed:\n${data.error || 'Check the console output below.'}`);
      } else {
        // Partial success (success=true but errorCount > 0)
        alert(`⚠️ Automation finished with ${data.errorCount} error(s).\n${data.successCount} rows saved.\nTimesheet NOT marked as Submitted — please verify and re-run.`);
      }
    } catch (err: any) {
      alert(`❌ Could not reach backend server.\n${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  clearLogs(): void {
    this.logService.clearLogs();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  getLogTypeClass(type: string): string {
    switch (type) {
      case 'success': return 'log-success';
      case 'error': return 'log-error';
      case 'warn': return 'log-warn';
      case 'step': return 'log-step';
      default: return 'log-info';
    }
  }

  get statusLabel(): string {
    switch (this.status) {
      case 'running': return '⚡ Running';
      case 'success': return '✅ Completed';
      case 'error': return '❌ Failed';
      default: return '⏹ Idle';
    }
  }
}
