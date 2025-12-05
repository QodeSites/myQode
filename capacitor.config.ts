import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qodeinvest.myqode',
  appName: 'Qode Invest',
  webDir: 'public',
  server: {
    url: 'https://myqode.qodeinvest.com',
    cleartext: true
  }
};

export default config;
