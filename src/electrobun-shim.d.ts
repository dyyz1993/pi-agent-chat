declare module "electrobun/bun" {
  export interface BrowserViewInstance {
    executeJavascript(js: string): void;
    on(name: string, handler: (event: any) => void): void;
  }

  export class BrowserWindow {
    constructor(options: any);
    webview: BrowserViewInstance;
    getSize(): { width: number; height: number };
    on(name: string, handler: (event: any) => void): void;
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
