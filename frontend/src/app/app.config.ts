import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './services/auth.service';

export const appConfig: ApplicationConfig = {
  // authInterceptor adds the login token to every request to our backend
  providers: [provideHttpClient(withInterceptors([authInterceptor]))],
};
