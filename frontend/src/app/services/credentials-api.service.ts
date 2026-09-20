import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SaveCredentialsRequest, SavedCredentials } from '../models/team.model';

@Injectable({ providedIn: 'root' })
export class CredentialsApiService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/credentials`;

  constructor(private readonly http: HttpClient) {}

  get(deviceId: string): Observable<SavedCredentials> {
    return this.http.get<SavedCredentials>(`${this.baseUrl}/${deviceId}`);
  }

  save(deviceId: string, request: SaveCredentialsRequest): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/${deviceId}`, request);
  }

  delete(deviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${deviceId}`);
  }
}
