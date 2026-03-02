import { Injectable, signal } from '@angular/core';

@Injectable({
     providedIn: 'root'
})
export class ThemeService {
     private darkTheme = signal<boolean>(true);
     isDark = this.darkTheme.asReadonly();

     constructor() {
          const saved = localStorage.getItem('theme');
          if (saved) {
               this.darkTheme.set(saved === 'dark');
               this.applyTheme();
          }
     }

     toggleTheme() {
          this.darkTheme.update(v => !v);
          localStorage.setItem('theme', this.darkTheme() ? 'dark' : 'light');
          this.applyTheme();
     }

     private applyTheme() {
          if (this.darkTheme()) {
               document.body.classList.remove('light-theme');
               document.body.classList.add('dark-theme');
          } else {
               document.body.classList.remove('dark-theme');
               document.body.classList.add('light-theme');
          }
     }
}
