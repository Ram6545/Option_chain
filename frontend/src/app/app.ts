import { Component, signal, OnInit, OnDestroy, inject, NgZone } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('Option Chain');
  protected readonly currentTime = signal<string>('');
  protected readonly isMarketOpen = signal<boolean>(false);

  private readonly ngZone = inject(NgZone);
  private timerId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.updateClock();
    // Run timer outside Angular zone so tests and whenStable() resolve cleanly
    this.ngZone.runOutsideAngular(() => {
      this.timerId = setInterval(() => {
        this.updateClock();
      }, 1000);
    });
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private updateClock(): void {
    try {
      const now = new Date();
      const istTimeStr = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      this.currentTime.set(`${istTimeStr} IST`);

      // Determine NSE market hours: Mon-Fri 09:15 - 15:30 IST
      const istParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);

      const weekday = istParts.find((p) => p.type === 'weekday')?.value;
      const hour = parseInt(istParts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(istParts.find((p) => p.type === 'minute')?.value || '0', 10);

      const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
      const totalMinutes = hour * 60 + minute;
      const isOpen = isWeekday && totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60 + 30;
      this.isMarketOpen.set(isOpen);
    } catch {
      this.currentTime.set('--:--:-- IST');
      this.isMarketOpen.set(false);
    }
  }
}