import { Injectable } from '@angular/core';

const STORAGE_KEY = 'fantasyx.deviceId';

@Injectable({ providedIn: 'root' })
export class DeviceIdService {
  private readonly deviceId: string;

  constructor() {
    this.deviceId = this.loadOrCreate();
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (private browsing, etc.) - nothing to clear.
    }
  }

  private loadOrCreate(): string {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        return existing;
      }
      const created = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, created);
      return created;
    } catch {
      // localStorage unavailable - fall back to an in-memory id for this session only.
      return crypto.randomUUID();
    }
  }
}
