import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AdminStore } from './admin-store';
import { AuthService } from './auth.service';

/** Only a signed-in person can open the console; anyone else goes to the sign-in page and comes back after. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.signedIn()) {
    // The console follows the signed-in person, including after a refresh.
    const store = inject(AdminStore);
    if (store.currentUser().name !== store.staffUsers().find((u) => u.id === auth.userId())?.name) store.signInAs(auth.userId());
    return true;
  }
  const returnUrl = state.url && state.url !== '/' ? state.url : null;
  return inject(Router).createUrlTree(['/sign-in'], returnUrl ? { queryParams: { returnUrl } } : {});
};
