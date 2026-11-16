import { PrivacyService } from '@core/privacy/privacyService';
import { getPlatform } from '@platform/index';
import type { SecureStore } from '@platform/interfaces';

const services = new WeakMap<SecureStore, PrivacyService>();
export function getPrivacyService(): PrivacyService {
  const secure = getPlatform().secure;
  let service = services.get(secure); if (!service) { service = new PrivacyService(secure); services.set(secure, service); }
  return service;
}
