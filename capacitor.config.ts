import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.piagent.chat",
  appName: "Pi Agent Chat",
  webDir: "dist",
  server: {
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
    androidScheme: "http",
  },
  plugins: {
    // SplashScreen disabled for HarmonyOS compatibility
    // SplashScreen: {
    //   launchShowDuration: 0,
    //   launchAutoHide: true,
    //   backgroundColor: '#ffffff',
    //   showSpinner: false,
    // },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#030712",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#4F46E5",
    },
    Camera: {
      presentationStyle: "fullscreen",
    },
  },
  android: {
    backgroundColor: "#030712",
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
  ios: {
    backgroundColor: "#030712",
  },
};

export default config;
