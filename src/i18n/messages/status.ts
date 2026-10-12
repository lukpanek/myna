import { defineMessages } from '../define';

/** Startup splash and the fatal error screen. */
export default defineMessages({
  cs: {
    errorTitle: 'Myna se nepodařilo spustit',
    errorDescription:
      'Při připojování nastala chyba. Zkus aplikaci načíst znovu. Pokud problém přetrvá, odhlas se a přihlas znovu.',
    reload: 'Načíst znovu',
    logout: 'Odhlásit se',
    details: 'Podrobnosti chyby',
    copyDetails: 'Kopírovat podrobnosti',
  },
  sk: {
    errorTitle: 'Mynu sa nepodarilo spustiť',
    errorDescription:
      'Pri pripájaní nastala chyba. Skús aplikáciu načítať znova. Ak problém pretrváva, odhlás sa a prihlás sa znova.',
    reload: 'Načítať znova',
    logout: 'Odhlásiť sa',
    details: 'Podrobnosti chyby',
    copyDetails: 'Kopírovať podrobnosti',
  },
  en: {
    errorTitle: 'Myna could not start',
    errorDescription:
      'Something went wrong while connecting. Try reloading the app. If the problem persists, log out and sign in again.',
    reload: 'Reload',
    logout: 'Log out',
    details: 'Error details',
    copyDetails: 'Copy details',
  },
});
