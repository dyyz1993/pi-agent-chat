declare module "electrobun/bun" {
  export class BrowserWindow {
    constructor(options: any);
    webview: any;
  }
  export class BrowserView {
    static defineRPC(options: any): any;
  }
  export class Updater {
    static localInfo: {
      channel(): Promise<string>;
    };
  }
  export class ApplicationMenu {
    static setApplicationMenu(menu: any[]): void;
  }
}
