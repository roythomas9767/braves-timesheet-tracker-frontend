import { Injectable, OnDestroy, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export type LogType = 'info' | 'success' | 'warn' | 'error' | 'step';
export type AutomationStatus = 'idle' | 'running' | 'success' | 'error';

export interface LogEntry {
     message: string;
     type: LogType;
     timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class AutomationLogService implements OnDestroy {
     private socket: Socket;

     /** All accumulated log entries */
     readonly logs$ = new BehaviorSubject<LogEntry[]>([]);
     /** Current automation status */
     readonly status$ = new BehaviorSubject<AutomationStatus>('idle');
     /** Socket connection state */
     readonly connected$ = new BehaviorSubject<boolean>(false);

     constructor(private zone: NgZone) {
          this.socket = io('http://localhost:3000', { transports: ['websocket', 'polling'] });

          this.socket.on('connect', () => {
               this.zone.run(() => {
                    this.connected$.next(true);
                    this.addLog('🔌 Connected to backend server', 'success');
               });
          });

          this.socket.on('disconnect', () => {
               this.zone.run(() => {
                    this.connected$.next(false);
                    this.addLog('🔌 Disconnected from backend server', 'warn');
               });
          });

          this.socket.on('connect_error', (err: Error) => {
               this.zone.run(() => {
                    this.connected$.next(false);
                    this.addLog(`Socket error: ${err.message}`, 'error');
               });
          });

          this.socket.on('automation-log', (entry: LogEntry) => {
               this.zone.run(() => {
                    this.addLog(entry.message, entry.type, entry.timestamp);
               });
          });

          this.socket.on('automation-status', (payload: { status: AutomationStatus }) => {
               this.zone.run(() => {
                    this.status$.next(payload.status);
               });
          });
     }

     addLog(message: string, type: LogType = 'info', timestamp?: string): void {
          const ts = timestamp ?? new Date().toLocaleTimeString('en-IN', { hour12: false });
          const entry: LogEntry = { message, type, timestamp: ts };
          this.logs$.next([...this.logs$.value, entry]);
     }

     clearLogs(): void {
          this.logs$.next([]);
     }

     ngOnDestroy(): void {
          this.socket.disconnect();
     }
}
